// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package kvstore

import "time"

// OAuthToken stores per-user PagerDuty OAuth tokens.
type OAuthToken struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// IsExpired returns true if the access token has expired (with a 60-second buffer).
func (t *OAuthToken) IsExpired() bool {
	return time.Now().After(t.ExpiresAt.Add(-60 * time.Second))
}

// OAuthState stores the CSRF state for an in-progress OAuth flow.
type OAuthState struct {
	UserID    string    `json:"user_id"`
	ExpiresAt time.Time `json:"expires_at"`
}

// ChannelSubscription represents a channel's subscription to PagerDuty events.
type ChannelSubscription struct {
	ChannelID  string    `json:"channel_id"`
	CreatorID  string    `json:"creator_id"`
	EventTypes []string  `json:"event_types"`
	ServiceIDs []string  `json:"service_ids,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// UserNotificationPrefs represents per-user notification preferences.
type UserNotificationPrefs struct {
	Enabled       bool `json:"enabled"`
	OnCallStart   bool `json:"oncall_start"`
	OnCallEnd     bool `json:"oncall_end"`
	ShiftReminder bool `json:"shift_reminder"`
	ShiftTaken    bool `json:"shift_taken"`
}

// WebhookRegistration stores PagerDuty webhook subscription info.
type WebhookRegistration struct {
	SubscriptionID string    `json:"subscription_id"`
	Secret         string    `json:"secret"`
	CreatedBy      string    `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
}

// OnCallSnapshot stores the most recent on-call state for change detection.
type OnCallSnapshot struct {
	Entries   []OnCallEntry `json:"entries"`
	UpdatedAt time.Time     `json:"updated_at"`
}

// OnCallEntry represents a single on-call entry in the snapshot.
type OnCallEntry struct {
	UserID             string `json:"user_id"`
	UserName           string `json:"user_name"`
	UserEmail          string `json:"user_email"`
	ScheduleID         string `json:"schedule_id"`
	ScheduleName       string `json:"schedule_name"`
	EscalationPolicyID string `json:"escalation_policy_id,omitempty"`
	Start              string `json:"start"`
	End                string `json:"end"`
}

// ReminderRecord tracks which shift reminders have been sent.
type ReminderRecord struct {
	SentReminders map[string]time.Time `json:"sent_reminders"`
}

// KVStore is the interface for plugin key-value storage.
type KVStore interface {
	GetCachedSchedules() ([]byte, error)
	SetCachedSchedules(data []byte) error

	GetUserToken(userID string) (*OAuthToken, error)
	SetUserToken(userID string, token *OAuthToken) error
	DeleteUserToken(userID string) error

	GetOAuthState(state string) (*OAuthState, error)
	SetOAuthState(state string, oauthState *OAuthState) error
	DeleteOAuthState(state string) error

	// Channel subscription methods
	GetChannelSubscription(channelID string) (*ChannelSubscription, error)
	SetChannelSubscription(sub *ChannelSubscription) error
	DeleteChannelSubscription(channelID string) error
	GetSubscriptionIndex() ([]string, error)
	SetSubscriptionIndex(channelIDs []string) error

	// User notification preferences
	GetUserNotificationPrefs(userID string) (*UserNotificationPrefs, error)
	SetUserNotificationPrefs(userID string, prefs *UserNotificationPrefs) error

	// Webhook registration
	GetWebhookRegistration() (*WebhookRegistration, error)
	SetWebhookRegistration(reg *WebhookRegistration) error
	DeleteWebhookRegistration() error

	// On-call state cache
	GetOnCallSnapshot() (*OnCallSnapshot, error)
	SetOnCallSnapshot(snapshot *OnCallSnapshot) error

	// Reminder tracking
	GetReminderRecord() (*ReminderRecord, error)
	SetReminderRecord(record *ReminderRecord) error
}
