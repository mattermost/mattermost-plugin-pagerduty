// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"fmt"
	"time"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
)

const (
	onCallPollInterval   = 60 * time.Second
	shiftReminderWindow  = 35 * time.Minute // Check for shifts starting within 35 min
	shiftReminderMinimum = 5 * time.Minute  // Don't remind if less than 5 min away
	reminderCleanupAge   = 2 * time.Hour    // Clean up old reminder records
	serviceCacheTTL      = 5 * time.Minute  // Refresh EP→service cache every 5 min
)

// scheduleChanges groups on-call entries that changed for a single schedule.
type scheduleChanges struct {
	newEntries     []OnCallEntry
	removedEntries []OnCallEntry
}

// OnCallMonitor periodically polls PagerDuty for on-call changes and sends notifications.
type OnCallMonitor struct {
	plugin          *Plugin
	stopCh          chan struct{}
	interval        time.Duration
	epToServices    map[string][]string // escalation policy ID → []service ID
	serviceCacheAge time.Time
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
		epID := ""
		if oc.EscalationPolicy != nil {
			epID = oc.EscalationPolicy.ID
		}
		current.Entries = append(current.Entries, OnCallEntry{
			UserID:             oc.User.ID,
			UserName:           oc.User.Name,
			UserEmail:          oc.User.Email,
			ScheduleID:         oc.Schedule.ID,
			ScheduleName:       oc.Schedule.Name,
			EscalationPolicyID: epID,
			Start:              oc.Start,
			End:                oc.End,
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
		m.detectAndNotifyChanges(previous, current, pdClient)
	}

	// Check for upcoming shift reminders
	m.checkShiftReminders(current)

	// Save the new snapshot
	if err := m.plugin.kvstore.SetOnCallSnapshot(current); err != nil {
		m.plugin.client.Log.Error("On-call monitor: failed to save snapshot", "error", err.Error())
	}
}

// detectAndNotifyChanges compares two snapshots and sends notifications for changes.
func (m *OnCallMonitor) detectAndNotifyChanges(previous, current *OnCallSnapshot, pdClient *pagerduty.Client) {
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

	// Build the EP→service mapping (cached, refreshes every 5 min)
	epServiceMap := m.getEPServiceMap(pdClient)

	// Process each schedule's changes
	for _, sc := range changes {
		scheduleName := ""
		if len(sc.newEntries) > 0 {
			scheduleName = sc.newEntries[0].ScheduleName
		} else if len(sc.removedEntries) > 0 {
			scheduleName = sc.removedEntries[0].ScheduleName
		}

		// Resolve service IDs for this schedule via escalation policy
		serviceIDs := m.resolveServiceIDs(sc, epServiceMap)

		// Send channel notifications
		channelMessage := m.plugin.formatOnCallChangeChannel(scheduleName, sc.newEntries, sc.removedEntries)
		m.plugin.routeToSubscribedChannels(EventOnCallChange, serviceIDs, channelMessage)

		// Send DM notifications
		m.sendOnCallDMNotifications(sc.newEntries, sc.removedEntries, scheduleName)
	}
}

// getEPServiceMap returns a cached mapping of escalation policy IDs to service IDs.
// The cache is refreshed when it is older than serviceCacheTTL.
func (m *OnCallMonitor) getEPServiceMap(pdClient *pagerduty.Client) map[string][]string {
	if m.epToServices != nil && time.Since(m.serviceCacheAge) < serviceCacheTTL {
		return m.epToServices
	}

	epMap := make(map[string][]string)
	offset := 0
	limit := 100
	for {
		resp, err := pdClient.GetServices(limit, offset)
		if err != nil {
			m.plugin.client.Log.Error("Failed to fetch services for EP mapping", "error", err.Error())
			if m.epToServices != nil {
				return m.epToServices // Return stale cache on error
			}
			return epMap
		}

		for _, svc := range resp.Services {
			if svc.EscalationPolicy != nil {
				epMap[svc.EscalationPolicy.ID] = append(epMap[svc.EscalationPolicy.ID], svc.ID)
			}
		}

		if !resp.More {
			break
		}
		offset += limit
	}

	m.epToServices = epMap
	m.serviceCacheAge = time.Now()
	m.plugin.client.Log.Debug("Refreshed EP-to-service cache", "ep_count", len(epMap))
	return epMap
}

// resolveServiceIDs finds the service IDs associated with a schedule change
// by looking up the escalation policy from the on-call entries.
func (m *OnCallMonitor) resolveServiceIDs(sc *scheduleChanges, epServiceMap map[string][]string) []string {
	// Collect unique EP IDs from the change entries
	epIDs := make(map[string]bool)
	for _, entry := range sc.newEntries {
		if entry.EscalationPolicyID != "" {
			epIDs[entry.EscalationPolicyID] = true
		}
	}
	for _, entry := range sc.removedEntries {
		if entry.EscalationPolicyID != "" {
			epIDs[entry.EscalationPolicyID] = true
		}
	}

	// Look up service IDs for each EP
	serviceIDSet := make(map[string]bool)
	for epID := range epIDs {
		for _, svcID := range epServiceMap[epID] {
			serviceIDSet[svcID] = true
		}
	}

	serviceIDs := make([]string, 0, len(serviceIDSet))
	for svcID := range serviceIDSet {
		serviceIDs = append(serviceIDs, svcID)
	}

	return serviceIDs
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
