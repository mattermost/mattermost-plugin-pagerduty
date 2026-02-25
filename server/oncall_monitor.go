package main

import (
	"fmt"
	"time"
)

const (
	onCallPollInterval   = 60 * time.Second
	shiftReminderWindow  = 35 * time.Minute // Check for shifts starting within 35 min
	shiftReminderMinimum = 5 * time.Minute  // Don't remind if less than 5 min away
	reminderCleanupAge   = 2 * time.Hour    // Clean up old reminder records
)

// OnCallMonitor periodically polls PagerDuty for on-call changes and sends notifications.
type OnCallMonitor struct {
	plugin   *Plugin
	stopCh   chan struct{}
	interval time.Duration
}

// NewOnCallMonitor creates a new on-call monitor.
func NewOnCallMonitor(plugin *Plugin) *OnCallMonitor {
	return &OnCallMonitor{
		plugin:   plugin,
		stopCh:   make(chan struct{}),
		interval: onCallPollInterval,
	}
}

// Start begins the background polling loop.
func (m *OnCallMonitor) Start() {
	m.plugin.client.Log.Info("Starting on-call monitor", "interval", m.interval.String())
	go m.run()
}

// Stop signals the polling loop to exit.
func (m *OnCallMonitor) Stop() {
	m.plugin.client.Log.Info("Stopping on-call monitor")
	close(m.stopCh)
}

func (m *OnCallMonitor) run() {
	// Initial delay to let the plugin fully activate
	timer := time.NewTimer(10 * time.Second)
	select {
	case <-timer.C:
	case <-m.stopCh:
		timer.Stop()
		return
	}

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	// Do an initial poll
	m.poll()

	for {
		select {
		case <-ticker.C:
			m.poll()
		case <-m.stopCh:
			return
		}
	}
}

func (m *OnCallMonitor) poll() {
	// Get a connected admin user's PD client for polling
	adminUserID, err := m.plugin.getConnectedAdminUserID()
	if err != nil {
		m.plugin.client.Log.Debug("No connected admin for on-call monitoring", "error", err.Error())
		return
	}

	pdClient, err := m.plugin.getPagerDutyClientForUser(adminUserID)
	if err != nil {
		m.plugin.client.Log.Debug("Failed to get PagerDuty client for on-call monitor", "error", err.Error())
		return
	}

	// Fetch current on-calls
	oncalls, err := pdClient.GetCurrentOnCalls()
	if err != nil {
		m.plugin.client.Log.Error("On-call monitor: failed to fetch current on-calls", "error", err.Error())
		return
	}

	// Build the current snapshot
	current := &OnCallSnapshot{
		UpdatedAt: time.Now(),
	}
	for _, oc := range oncalls.OnCalls {
		current.Entries = append(current.Entries, OnCallEntry{
			UserID:       oc.User.ID,
			UserName:     oc.User.Name,
			UserEmail:    oc.User.Email,
			ScheduleID:   oc.Schedule.ID,
			ScheduleName: oc.Schedule.Name,
			Start:        oc.Start,
			End:          oc.End,
		})
	}

	// Load previous snapshot
	previous, err := m.plugin.kvstore.GetOnCallSnapshot()
	if err != nil {
		m.plugin.client.Log.Error("On-call monitor: failed to get previous snapshot", "error", err.Error())
		previous = &OnCallSnapshot{}
	}

	// Detect changes and send notifications
	if len(previous.Entries) > 0 {
		m.detectAndNotifyChanges(previous, current)
	}

	// Check for upcoming shift reminders
	m.checkShiftReminders(current)

	// Save the new snapshot
	if err := m.plugin.kvstore.SetOnCallSnapshot(current); err != nil {
		m.plugin.client.Log.Error("On-call monitor: failed to save snapshot", "error", err.Error())
	}
}

// detectAndNotifyChanges compares two snapshots and sends notifications for changes.
func (m *OnCallMonitor) detectAndNotifyChanges(previous, current *OnCallSnapshot) {
	// Build maps keyed by "scheduleID:userID" for quick lookup
	prevMap := make(map[string]OnCallEntry)
	for _, e := range previous.Entries {
		key := e.ScheduleID + ":" + e.UserID
		prevMap[key] = e
	}

	currMap := make(map[string]OnCallEntry)
	for _, e := range current.Entries {
		key := e.ScheduleID + ":" + e.UserID
		currMap[key] = e
	}

	// Group changes by schedule
	type scheduleChanges struct {
		newEntries     []OnCallEntry
		removedEntries []OnCallEntry
	}
	changes := make(map[string]*scheduleChanges) // keyed by scheduleID

	// Find new on-call entries (in current but not previous)
	for key, entry := range currMap {
		if _, existed := prevMap[key]; !existed {
			sc, ok := changes[entry.ScheduleID]
			if !ok {
				sc = &scheduleChanges{}
				changes[entry.ScheduleID] = sc
			}
			sc.newEntries = append(sc.newEntries, entry)
		}
	}

	// Find removed on-call entries (in previous but not current)
	for key, entry := range prevMap {
		if _, exists := currMap[key]; !exists {
			sc, ok := changes[entry.ScheduleID]
			if !ok {
				sc = &scheduleChanges{}
				changes[entry.ScheduleID] = sc
			}
			sc.removedEntries = append(sc.removedEntries, entry)
		}
	}

	if len(changes) == 0 {
		return
	}

	// Process each schedule's changes
	for scheduleID, sc := range changes {
		scheduleName := ""
		if len(sc.newEntries) > 0 {
			scheduleName = sc.newEntries[0].ScheduleName
		} else if len(sc.removedEntries) > 0 {
			scheduleName = sc.removedEntries[0].ScheduleName
		}

		// Send channel notifications
		channelMessage := m.plugin.formatOnCallChangeChannel(scheduleName, sc.newEntries, sc.removedEntries)
		m.plugin.routeToSubscribedChannels(EventOnCallChange, scheduleID, channelMessage)

		// Send DM notifications
		m.sendOnCallDMNotifications(sc.newEntries, sc.removedEntries, scheduleName)
	}
}

// sendOnCallDMNotifications sends DM notifications to users who went on or off call.
func (m *OnCallMonitor) sendOnCallDMNotifications(newEntries, removedEntries []OnCallEntry, scheduleName string) {
	// Notify users who went on-call
	for _, entry := range newEntries {
		mmUser := m.plugin.getMattermostUserByEmail(entry.UserEmail)
		if mmUser == nil {
			continue
		}

		prefs, err := m.plugin.kvstore.GetUserNotificationPrefs(mmUser.Id)
		if err != nil || !prefs.Enabled || !prefs.OnCallStart {
			continue
		}

		msg := formatOnCallStartDM(scheduleName, entry.End)
		if dmErr := m.plugin.dmUser(mmUser.Id, msg); dmErr != nil {
			m.plugin.client.Log.Error("Failed to send on-call start DM", "user_id", mmUser.Id, "error", dmErr.Error())
		}
	}

	// Notify users who went off-call
	for _, entry := range removedEntries {
		mmUser := m.plugin.getMattermostUserByEmail(entry.UserEmail)
		if mmUser == nil {
			continue
		}

		prefs, err := m.plugin.kvstore.GetUserNotificationPrefs(mmUser.Id)
		if err != nil || !prefs.Enabled || !prefs.OnCallEnd {
			continue
		}

		// Find who replaced them
		newUserName := ""
		for _, newEntry := range newEntries {
			if newEntry.ScheduleID == entry.ScheduleID {
				newUserName = newEntry.UserName
				break
			}
		}

		msg := formatOnCallEndDM(scheduleName, newUserName)
		if dmErr := m.plugin.dmUser(mmUser.Id, msg); dmErr != nil {
			m.plugin.client.Log.Error("Failed to send on-call end DM", "user_id", mmUser.Id, "error", dmErr.Error())
		}
	}
}

// checkShiftReminders checks for upcoming on-call shifts and sends reminder DMs.
func (m *OnCallMonitor) checkShiftReminders(snapshot *OnCallSnapshot) {
	now := time.Now()
	record, err := m.plugin.kvstore.GetReminderRecord()
	if err != nil {
		record = &ReminderRecord{SentReminders: make(map[string]time.Time)}
	}

	changed := false

	for _, entry := range snapshot.Entries {
		startTime, parseErr := time.Parse(time.RFC3339, entry.Start)
		if parseErr != nil {
			continue
		}

		until := time.Until(startTime)
		if until < shiftReminderMinimum || until > shiftReminderWindow {
			continue
		}

		reminderKey := fmt.Sprintf("%s:%s:%s", entry.ScheduleID, entry.UserID, entry.Start)
		if _, alreadySent := record.SentReminders[reminderKey]; alreadySent {
			continue
		}

		mmUser := m.plugin.getMattermostUserByEmail(entry.UserEmail)
		if mmUser == nil {
			continue
		}

		prefs, prefsErr := m.plugin.kvstore.GetUserNotificationPrefs(mmUser.Id)
		if prefsErr != nil || !prefs.Enabled || !prefs.ShiftReminder {
			continue
		}

		msg := formatShiftReminderDM(entry.ScheduleName, startTime)
		if dmErr := m.plugin.dmUser(mmUser.Id, msg); dmErr != nil {
			m.plugin.client.Log.Error("Failed to send shift reminder DM", "user_id", mmUser.Id, "error", dmErr.Error())
			continue
		}

		record.SentReminders[reminderKey] = now
		changed = true
	}

	// Clean up old reminder records
	for key, sentAt := range record.SentReminders {
		if now.Sub(sentAt) > reminderCleanupAge {
			delete(record.SentReminders, key)
			changed = true
		}
	}

	if changed {
		if err := m.plugin.kvstore.SetReminderRecord(record); err != nil {
			m.plugin.client.Log.Error("Failed to save reminder record", "error", err.Error())
		}
	}
}
