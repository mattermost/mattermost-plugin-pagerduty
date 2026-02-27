package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"

	"github.com/svelle/mattermost-pagerduty-plugin/server/store/kvstore"
)

func TestExecuteCommand(t *testing.T) {
	t.Run("no subcommand shows help", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "PagerDuty Plugin Commands")
		assert.Equal(t, model.CommandResponseTypeEphemeral, resp.ResponseType)
	})

	t.Run("help subcommand shows help", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty help",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "PagerDuty Plugin Commands")
	})

	t.Run("unknown subcommand shows help", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty unknown",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "PagerDuty Plugin Commands")
	})
}

func TestExecuteSubscribe(t *testing.T) {
	// webhookKVStore returns a mock KV store with a webhook registration present
	webhookKVStore := func() *mockKVStore {
		return &mockKVStore{
			getWebhookRegistrationFunc: func() (*kvstore.WebhookRegistration, error) {
				return &kvstore.WebhookRegistration{SubscriptionID: "sub-test"}, nil
			},
		}
	}

	t.Run("subscribe with defaults", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)
		p.kvstore = webhookKVStore()

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command:   "/pagerduty subscribe",
			UserId:    "user-1",
			ChannelId: "channel-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "subscribed to PagerDuty events")
	})

	t.Run("subscribe with specific events", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)
		p.kvstore = webhookKVStore()

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command:   "/pagerduty subscribe incident.triggered,incident.resolved",
			UserId:    "user-1",
			ChannelId: "channel-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "incident.triggered")
		assert.Contains(t, resp.Text, "incident.resolved")
	})

	t.Run("subscribe with service filter", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)
		p.kvstore = webhookKVStore()

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command:   "/pagerduty subscribe --service PSERVICE1",
			UserId:    "user-1",
			ChannelId: "channel-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "subscribed to PagerDuty events")
		assert.Contains(t, resp.Text, "PSERVICE1")
	})

	t.Run("subscribe with invalid event type", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)
		p.kvstore = webhookKVStore()

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command:   "/pagerduty subscribe invalid.event",
			UserId:    "user-1",
			ChannelId: "channel-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "Unknown event type")
	})

	t.Run("subscribe without webhook configured", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command:   "/pagerduty subscribe",
			UserId:    "user-1",
			ChannelId: "channel-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "No PagerDuty webhook is configured")
	})
}

func TestExecuteUnsubscribe(t *testing.T) {
	t.Run("unsubscribe success", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command:   "/pagerduty unsubscribe",
			UserId:    "user-1",
			ChannelId: "channel-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "unsubscribed")
	})
}

func TestExecuteList(t *testing.T) {
	t.Run("no subscription", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command:   "/pagerduty list",
			UserId:    "user-1",
			ChannelId: "channel-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "not subscribed")
	})

	t.Run("existing subscription", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)
		p.kvstore = &mockKVStore{
			getChannelSubscriptionFunc: func(channelID string) (*kvstore.ChannelSubscription, error) {
				return &kvstore.ChannelSubscription{
					ChannelID:  channelID,
					EventTypes: []string{EventIncidentTriggered},
					ServiceIDs: []string{"svc-1"},
				}, nil
			},
		}

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command:   "/pagerduty list",
			UserId:    "user-1",
			ChannelId: "channel-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "incident.triggered")
		assert.Contains(t, resp.Text, "svc-1")
	})
}

func TestExecuteNotify(t *testing.T) {
	t.Run("notify on", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty notify on",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "enabled")
	})

	t.Run("notify off", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty notify off",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "disabled")
	})

	t.Run("notify status", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)
		p.kvstore = &mockKVStore{
			getUserNotificationPrefsFunc: func(_ string) (*kvstore.UserNotificationPrefs, error) {
				return &kvstore.UserNotificationPrefs{
					Enabled:     true,
					OnCallStart: true,
					OnCallEnd:   false,
				}, nil
			},
		}

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty notify status",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "enabled")
		assert.Contains(t, resp.Text, "On-call start")
	})

	t.Run("notify with no argument", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty notify",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "Usage")
	})
}

func TestExecuteWebhookStatus(t *testing.T) {
	t.Run("no webhook configured", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty webhook status",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "No PagerDuty webhook")
	})

	t.Run("webhook configured", func(t *testing.T) {
		api := newMockAPI()
		p := newTestPlugin(api)
		p.kvstore = &mockKVStore{
			getWebhookRegistrationFunc: func() (*kvstore.WebhookRegistration, error) {
				return &kvstore.WebhookRegistration{
					SubscriptionID: "sub-123",
				}, nil
			},
		}

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty webhook status",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "sub-123")
		assert.Contains(t, resp.Text, "Active")
	})
}

func TestExecuteWebhookSetup(t *testing.T) {
	t.Run("non-admin is rejected", func(t *testing.T) {
		api := newMockAPI()
		api.On("GetUser", "user-1").Return(&model.User{
			Roles: "system_user",
		}, nil)

		p := newTestPlugin(api)

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
			Command: "/pagerduty webhook setup",
			UserId:  "user-1",
		})

		assert.Nil(t, appErr)
		assert.Contains(t, resp.Text, "system administrators")
	})
}

func TestIsValidEventType(t *testing.T) {
	assert.True(t, isValidEventType(EventIncidentTriggered))
	assert.True(t, isValidEventType(EventIncidentAcknowledged))
	assert.True(t, isValidEventType(EventIncidentResolved))
	assert.True(t, isValidEventType(EventIncidentEscalated))
	assert.True(t, isValidEventType(EventOnCallChange))
	assert.True(t, isValidEventType(EventIncidentReassigned))
	assert.False(t, isValidEventType("invalid.event"))
}

func TestBoolEmoji(t *testing.T) {
	assert.Equal(t, "enabled", boolEmoji(true))
	assert.Equal(t, "disabled", boolEmoji(false))
}
