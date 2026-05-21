// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package kvstore

import (
	"fmt"
	"time"

	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/pkg/errors"
)

// Client wraps the Mattermost plugin KV store API.
type Client struct {
	client *pluginapi.Client
}

// NewKVStore creates a new KV store client.
func NewKVStore(client *pluginapi.Client) KVStore {
	return Client{
		client: client,
	}
}

// GetCachedSchedules retrieves cached schedule data.
func (kv Client) GetCachedSchedules() ([]byte, error) {
	var data []byte
	err := kv.client.KV.Get("pagerduty_schedules_cache", &data)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get cached schedules")
	}
	return data, nil
}

// SetCachedSchedules stores schedule data in cache.
func (kv Client) SetCachedSchedules(data []byte) error {
	_, err := kv.client.KV.Set("pagerduty_schedules_cache", data)
	if err != nil {
		return errors.Wrap(err, "failed to cache schedules")
	}
	return nil
}

func userTokenKey(userID string) string {
	return fmt.Sprintf("pd_token_%s", userID)
}

func oauthStateKey(state string) string {
	return fmt.Sprintf("pd_oauth_state_%s", state)
}

// GetUserToken retrieves the OAuth token for a user.
func (kv Client) GetUserToken(userID string) (*OAuthToken, error) {
	var token OAuthToken
	err := kv.client.KV.Get(userTokenKey(userID), &token)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get user token")
	}
	if token.AccessToken == "" {
		return nil, nil
	}
	return &token, nil
}

// SetUserToken stores the OAuth token for a user.
func (kv Client) SetUserToken(userID string, token *OAuthToken) error {
	_, err := kv.client.KV.Set(userTokenKey(userID), token)
	if err != nil {
		return errors.Wrap(err, "failed to set user token")
	}
	return nil
}

// DeleteUserToken removes the OAuth token for a user.
func (kv Client) DeleteUserToken(userID string) error {
	err := kv.client.KV.Delete(userTokenKey(userID))
	if err != nil {
		return errors.Wrap(err, "failed to delete user token")
	}
	return nil
}

// GetOAuthState retrieves an OAuth state entry.
func (kv Client) GetOAuthState(state string) (*OAuthState, error) {
	var oauthState OAuthState
	err := kv.client.KV.Get(oauthStateKey(state), &oauthState)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get OAuth state")
	}
	if oauthState.UserID == "" {
		return nil, nil
	}
	return &oauthState, nil
}

// SetOAuthState stores an OAuth state entry.
func (kv Client) SetOAuthState(state string, oauthState *OAuthState) error {
	_, err := kv.client.KV.Set(oauthStateKey(state), oauthState)
	if err != nil {
		return errors.Wrap(err, "failed to set OAuth state")
	}
	return nil
}

// DeleteOAuthState removes an OAuth state entry.
func (kv Client) DeleteOAuthState(state string) error {
	err := kv.client.KV.Delete(oauthStateKey(state))
	if err != nil {
		return errors.Wrap(err, "failed to delete OAuth state")
	}
	return nil
}

// Channel subscription key helpers

func channelSubKey(channelID string) string {
	return fmt.Sprintf("pd_channel_sub_%s", channelID)
}

const subscriptionIndexKey = "pd_sub_index"

// GetChannelSubscription retrieves a channel's subscription.
func (kv Client) GetChannelSubscription(channelID string) (*ChannelSubscription, error) {
	var sub ChannelSubscription
	err := kv.client.KV.Get(channelSubKey(channelID), &sub)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get channel subscription")
	}
	if sub.ChannelID == "" {
		return nil, nil
	}
	return &sub, nil
}

// SetChannelSubscription stores a channel's subscription.
func (kv Client) SetChannelSubscription(sub *ChannelSubscription) error {
	_, err := kv.client.KV.Set(channelSubKey(sub.ChannelID), sub)
	if err != nil {
		return errors.Wrap(err, "failed to set channel subscription")
	}
	return nil
}

// DeleteChannelSubscription removes a channel's subscription.
func (kv Client) DeleteChannelSubscription(channelID string) error {
	err := kv.client.KV.Delete(channelSubKey(channelID))
	if err != nil {
		return errors.Wrap(err, "failed to delete channel subscription")
	}
	return nil
}

// GetSubscriptionIndex retrieves the list of channel IDs that have subscriptions.
func (kv Client) GetSubscriptionIndex() ([]string, error) {
	var index []string
	err := kv.client.KV.Get(subscriptionIndexKey, &index)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get subscription index")
	}
	return index, nil
}

// SetSubscriptionIndex stores the list of channel IDs that have subscriptions.
func (kv Client) SetSubscriptionIndex(channelIDs []string) error {
	_, err := kv.client.KV.Set(subscriptionIndexKey, channelIDs)
	if err != nil {
		return errors.Wrap(err, "failed to set subscription index")
	}
	return nil
}

// User notification preferences

func notificationPrefsKey(userID string) string {
	return fmt.Sprintf("pd_notify_prefs_%s", userID)
}

// GetUserNotificationPrefs retrieves a user's notification preferences.
func (kv Client) GetUserNotificationPrefs(userID string) (*UserNotificationPrefs, error) {
	var prefs UserNotificationPrefs
	err := kv.client.KV.Get(notificationPrefsKey(userID), &prefs)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get user notification preferences")
	}
	return &prefs, nil
}

// SetUserNotificationPrefs stores a user's notification preferences.
func (kv Client) SetUserNotificationPrefs(userID string, prefs *UserNotificationPrefs) error {
	_, err := kv.client.KV.Set(notificationPrefsKey(userID), prefs)
	if err != nil {
		return errors.Wrap(err, "failed to set user notification preferences")
	}
	return nil
}

// Webhook registration

const webhookRegistrationKey = "pd_webhook_reg"

// GetWebhookRegistration retrieves the stored webhook registration.
func (kv Client) GetWebhookRegistration() (*WebhookRegistration, error) {
	var reg WebhookRegistration
	err := kv.client.KV.Get(webhookRegistrationKey, &reg)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get webhook registration")
	}
	if reg.SubscriptionID == "" {
		return nil, nil
	}
	return &reg, nil
}

// SetWebhookRegistration stores the webhook registration.
func (kv Client) SetWebhookRegistration(reg *WebhookRegistration) error {
	_, err := kv.client.KV.Set(webhookRegistrationKey, reg)
	if err != nil {
		return errors.Wrap(err, "failed to set webhook registration")
	}
	return nil
}

// DeleteWebhookRegistration removes the webhook registration.
func (kv Client) DeleteWebhookRegistration() error {
	err := kv.client.KV.Delete(webhookRegistrationKey)
	if err != nil {
		return errors.Wrap(err, "failed to delete webhook registration")
	}
	return nil
}

// On-call state cache

const onCallSnapshotKey = "pd_oncall_snapshot"

// GetOnCallSnapshot retrieves the cached on-call state.
func (kv Client) GetOnCallSnapshot() (*OnCallSnapshot, error) {
	var snapshot OnCallSnapshot
	err := kv.client.KV.Get(onCallSnapshotKey, &snapshot)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get on-call snapshot")
	}
	return &snapshot, nil
}

// SetOnCallSnapshot stores the on-call state snapshot.
func (kv Client) SetOnCallSnapshot(snapshot *OnCallSnapshot) error {
	_, err := kv.client.KV.Set(onCallSnapshotKey, snapshot)
	if err != nil {
		return errors.Wrap(err, "failed to set on-call snapshot")
	}
	return nil
}

// Reminder tracking

const reminderRecordKey = "pd_reminder_record"

// GetReminderRecord retrieves the reminder tracking record.
func (kv Client) GetReminderRecord() (*ReminderRecord, error) {
	var record ReminderRecord
	err := kv.client.KV.Get(reminderRecordKey, &record)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get reminder record")
	}
	if record.SentReminders == nil {
		record.SentReminders = make(map[string]time.Time)
	}
	return &record, nil
}

// SetReminderRecord stores the reminder tracking record.
func (kv Client) SetReminderRecord(record *ReminderRecord) error {
	_, err := kv.client.KV.Set(reminderRecordKey, record)
	if err != nil {
		return errors.Wrap(err, "failed to set reminder record")
	}
	return nil
}
