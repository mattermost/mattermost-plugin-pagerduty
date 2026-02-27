package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
)

// processWebhookEvent routes a PagerDuty webhook event to all matching channel subscriptions.
func (p *Plugin) processWebhookEvent(event *pagerduty.WebhookEvent) {
	// Parse the incident data from the event
	var incidentData pagerduty.WebhookIncidentData
	if err := json.Unmarshal(event.Data, &incidentData); err != nil {
		p.client.Log.Error("Failed to parse webhook event data", "error", err.Error(), "event_type", event.EventType)
		return
	}

	// Format the notification message
	message := p.formatIncidentNotification(event.EventType, &incidentData)
	if message == "" {
		p.client.Log.Debug("No notification format for event type", "event_type", event.EventType)
		return
	}

	// Get all channel subscriptions and post to matching ones
	p.routeToSubscribedChannels(event.EventType, incidentData.Service.ID, message)
}

// routeToSubscribedChannels sends a notification to all channels that are subscribed
// to the given event type and (optionally) filtered by service ID.
func (p *Plugin) routeToSubscribedChannels(eventType, serviceID, message string) {
	index, err := p.kvstore.GetSubscriptionIndex()
	if err != nil {
		p.client.Log.Error("Failed to get subscription index", "error", err.Error())
		return
	}

	for _, channelID := range index {
		sub, subErr := p.kvstore.GetChannelSubscription(channelID)
		if subErr != nil || sub == nil {
			continue
		}

		if !p.subscriptionMatchesEvent(sub, eventType, serviceID) {
			continue
		}

		if postErr := p.postToChannel(channelID, message); postErr != nil {
			p.client.Log.Error("Failed to post notification to channel",
				"channel_id", channelID,
				"error", postErr.Error(),
			)
		}
	}
}

// subscriptionMatchesEvent checks whether a channel subscription matches an event.
func (p *Plugin) subscriptionMatchesEvent(sub *ChannelSubscription, eventType, serviceID string) bool {
	// Check event type match
	typeMatch := false
	for _, et := range sub.EventTypes {
		if et == eventType {
			typeMatch = true
			break
		}
	}
	if !typeMatch {
		return false
	}

	// Check service filter (empty means all services)
	if len(sub.ServiceIDs) == 0 {
		return true
	}

	for _, sid := range sub.ServiceIDs {
		if sid == serviceID {
			return true
		}
	}

	return false
}

// formatIncidentNotification creates a Mattermost markdown message for an incident event.
func (p *Plugin) formatIncidentNotification(eventType string, data *pagerduty.WebhookIncidentData) string {
	switch eventType {
	case EventIncidentTriggered:
		return p.formatIncidentTriggered(data)
	case EventIncidentAcknowledged:
		return p.formatIncidentAcknowledged(data)
	case EventIncidentResolved:
		return p.formatIncidentResolved(data)
	case EventIncidentEscalated:
		return p.formatIncidentEscalated(data)
	case EventIncidentReassigned:
		return p.formatIncidentReassigned(data)
	default:
		return ""
	}
}

func (p *Plugin) formatIncidentTriggered(data *pagerduty.WebhookIncidentData) string {
	assignees := formatAssignees(data.Assignees)
	msg := fmt.Sprintf("#### :rotating_light: Incident Triggered\n**[%s](%s)**\n**Service:** %s",
		data.Title, data.HTMLURL, data.Service.Summary)
	if data.Urgency != "" {
		msg += fmt.Sprintf("\n**Urgency:** %s", data.Urgency)
	}
	if assignees != "" {
		msg += fmt.Sprintf("\n**Assigned to:** %s", assignees)
	}
	if data.Description != "" {
		msg += fmt.Sprintf("\n> %s", data.Description)
	}
	return msg
}

func (p *Plugin) formatIncidentAcknowledged(data *pagerduty.WebhookIncidentData) string {
	assignees := formatAssignees(data.Assignees)
	msg := fmt.Sprintf("#### :white_check_mark: Incident Acknowledged\n**[%s](%s)**\n**Service:** %s",
		data.Title, data.HTMLURL, data.Service.Summary)
	if assignees != "" {
		msg += fmt.Sprintf("\n**Acknowledged by:** %s", assignees)
	}
	return msg
}

func (p *Plugin) formatIncidentResolved(data *pagerduty.WebhookIncidentData) string {
	return fmt.Sprintf("#### :heavy_check_mark: Incident Resolved\n**[%s](%s)**\n**Service:** %s",
		data.Title, data.HTMLURL, data.Service.Summary)
}

func (p *Plugin) formatIncidentEscalated(data *pagerduty.WebhookIncidentData) string {
	assignees := formatAssignees(data.Assignees)
	msg := fmt.Sprintf("#### :arrow_up: Incident Escalated\n**[%s](%s)**\n**Service:** %s",
		data.Title, data.HTMLURL, data.Service.Summary)
	if assignees != "" {
		msg += fmt.Sprintf("\n**Escalated to:** %s", assignees)
	}
	return msg
}

func (p *Plugin) formatIncidentReassigned(data *pagerduty.WebhookIncidentData) string {
	assignees := formatAssignees(data.Assignees)
	msg := fmt.Sprintf("#### :arrows_counterclockwise: Incident Reassigned\n**[%s](%s)**\n**Service:** %s",
		data.Title, data.HTMLURL, data.Service.Summary)
	if assignees != "" {
		msg += fmt.Sprintf("\n**Reassigned to:** %s", assignees)
	}
	return msg
}

func formatAssignees(assignees []pagerduty.UserReference) string {
	if len(assignees) == 0 {
		return ""
	}
	names := make([]string, len(assignees))
	for i, a := range assignees {
		if a.Summary != "" {
			names[i] = a.Summary
		} else {
			names[i] = a.ID
		}
	}
	return strings.Join(names, ", ")
}

// --- On-Call Change Notification Formatting ---

// formatOnCallChangeChannel creates a channel notification for an on-call change.
func (p *Plugin) formatOnCallChangeChannel(scheduleName string, newEntries, removedEntries []OnCallEntry) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("#### On-Call Change: %s\n", scheduleName))

	for _, entry := range newEntries {
		endTime := formatTimeShort(entry.End)
		b.WriteString(fmt.Sprintf(":large_green_circle: **%s** is now on-call (until %s)\n", entry.UserName, endTime))
	}
	for _, entry := range removedEntries {
		b.WriteString(fmt.Sprintf(":red_circle: **%s** is no longer on-call\n", entry.UserName))
	}

	return b.String()
}

// formatOnCallStartDM creates a DM notification for a user going on-call.
func formatOnCallStartDM(scheduleName, endTime string) string {
	return fmt.Sprintf("You are now on-call for **%s** until %s.", scheduleName, formatTimeShort(endTime))
}

// formatOnCallEndDM creates a DM notification for a user going off-call.
func formatOnCallEndDM(scheduleName, newUserName string) string {
	if newUserName != "" {
		return fmt.Sprintf("Your on-call shift for **%s** has ended. **%s** is now on-call.", scheduleName, newUserName)
	}
	return fmt.Sprintf("Your on-call shift for **%s** has ended.", scheduleName)
}

// formatShiftReminderDM creates a DM notification for an upcoming shift.
func formatShiftReminderDM(scheduleName string, startTime time.Time) string {
	remaining := time.Until(startTime)
	return fmt.Sprintf(":bell: Heads up! Your on-call shift for **%s** starts in %s.", scheduleName, formatDuration(remaining))
}

// formatShiftTakenDM creates a DM notification when someone takes your shift via override.
func formatShiftTakenDM(overrideUserName, scheduleName, start, end string) string {
	return fmt.Sprintf("**%s** has taken your on-call shift for **%s** (override from %s to %s).",
		overrideUserName, scheduleName, formatTimeShort(start), formatTimeShort(end))
}

// formatTimeShort parses an ISO 8601 timestamp and returns a short human-readable format.
func formatTimeShort(isoTime string) string {
	t, err := time.Parse(time.RFC3339, isoTime)
	if err != nil {
		return isoTime
	}
	return t.Format("Jan 2, 3:04 PM MST")
}

// formatDuration formats a duration as a human-readable string.
func formatDuration(d time.Duration) string {
	if d < 0 {
		return "now"
	}
	hours := int(d.Hours())
	minutes := int(d.Minutes()) % 60

	if hours > 24 {
		days := hours / 24
		hours %= 24
		return fmt.Sprintf("%dd %dh", days, hours)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}
