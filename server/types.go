// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import "github.com/svelle/mattermost-pagerduty-plugin/server/store/kvstore"

// Event type constants for channel subscriptions.
const (
	EventIncidentTriggered    = "incident.triggered"
	EventIncidentAcknowledged = "incident.acknowledged"
	EventIncidentResolved     = "incident.resolved"
	EventIncidentEscalated    = "incident.escalated"
	EventIncidentReassigned   = "incident.reassigned"
	EventOnCallChange         = "oncall.change"
)

// AllEventTypes is the default set of event types for channel subscriptions.
var AllEventTypes = []string{
	EventIncidentTriggered,
	EventIncidentAcknowledged,
	EventIncidentResolved,
	EventIncidentEscalated,
	EventOnCallChange,
}

// IncidentEventTypes are the event types that come from PagerDuty webhooks.
var IncidentEventTypes = []string{
	EventIncidentTriggered,
	EventIncidentAcknowledged,
	EventIncidentResolved,
	EventIncidentEscalated,
	EventIncidentReassigned,
}

// Type aliases so we can use shorter names in the main package
// while keeping the canonical definitions in the kvstore package.
type (
	ChannelSubscription   = kvstore.ChannelSubscription
	UserNotificationPrefs = kvstore.UserNotificationPrefs
	WebhookRegistration   = kvstore.WebhookRegistration
	OnCallSnapshot        = kvstore.OnCallSnapshot
	OnCallEntry           = kvstore.OnCallEntry
	ReminderRecord        = kvstore.ReminderRecord
)

// DefaultNotificationPrefs returns the default notification preferences (all off).
func DefaultNotificationPrefs() *UserNotificationPrefs {
	return &UserNotificationPrefs{}
}

// AllEnabledNotificationPrefs returns notification preferences with everything enabled.
func AllEnabledNotificationPrefs() *UserNotificationPrefs {
	return &UserNotificationPrefs{
		Enabled:       true,
		OnCallStart:   true,
		OnCallEnd:     true,
		ShiftReminder: true,
		ShiftTaken:    true,
	}
}
