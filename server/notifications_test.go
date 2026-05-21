// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
	"github.com/svelle/mattermost-pagerduty-plugin/server/store/kvstore"
)

func TestSubscriptionMatchesEvent(t *testing.T) {
	api := newMockAPI()
	p := newTestPlugin(api)

	t.Run("matches event type and all services", func(t *testing.T) {
		sub := &ChannelSubscription{
			EventTypes: []string{EventIncidentTriggered, EventIncidentResolved},
			ServiceIDs: []string{},
		}
		assert.True(t, p.subscriptionMatchesEvent(sub, EventIncidentTriggered, []string{"any-service"}))
		assert.True(t, p.subscriptionMatchesEvent(sub, EventIncidentResolved, []string{"any-service"}))
	})

	t.Run("does not match event type", func(t *testing.T) {
		sub := &ChannelSubscription{
			EventTypes: []string{EventIncidentTriggered},
			ServiceIDs: []string{},
		}
		assert.False(t, p.subscriptionMatchesEvent(sub, EventIncidentResolved, []string{"any-service"}))
	})

	t.Run("matches event type and service filter", func(t *testing.T) {
		sub := &ChannelSubscription{
			EventTypes: []string{EventIncidentTriggered},
			ServiceIDs: []string{"svc-1", "svc-2"},
		}
		assert.True(t, p.subscriptionMatchesEvent(sub, EventIncidentTriggered, []string{"svc-1"}))
		assert.True(t, p.subscriptionMatchesEvent(sub, EventIncidentTriggered, []string{"svc-2"}))
	})

	t.Run("does not match service filter", func(t *testing.T) {
		sub := &ChannelSubscription{
			EventTypes: []string{EventIncidentTriggered},
			ServiceIDs: []string{"svc-1"},
		}
		assert.False(t, p.subscriptionMatchesEvent(sub, EventIncidentTriggered, []string{"svc-other"}))
	})

	t.Run("on-call change matches via resolved service IDs", func(t *testing.T) {
		sub := &ChannelSubscription{
			EventTypes: []string{EventOnCallChange},
			ServiceIDs: []string{"svc-1"},
		}
		assert.True(t, p.subscriptionMatchesEvent(sub, EventOnCallChange, []string{"svc-1"}))
	})

	t.Run("on-call change does not match wrong service", func(t *testing.T) {
		sub := &ChannelSubscription{
			EventTypes: []string{EventOnCallChange},
			ServiceIDs: []string{"svc-1"},
		}
		assert.False(t, p.subscriptionMatchesEvent(sub, EventOnCallChange, []string{"svc-2"}))
	})

	t.Run("on-call change with empty resolved IDs skips service-filtered channels", func(t *testing.T) {
		sub := &ChannelSubscription{
			EventTypes: []string{EventOnCallChange},
			ServiceIDs: []string{"svc-1"},
		}
		// No service IDs resolved (EP mapping not populated) — skip to avoid false positives
		assert.False(t, p.subscriptionMatchesEvent(sub, EventOnCallChange, []string{}))
	})

	t.Run("on-call change with empty resolved IDs delivers to unfiltered channels", func(t *testing.T) {
		sub := &ChannelSubscription{
			EventTypes: []string{EventOnCallChange},
			ServiceIDs: []string{}, // No service filter
		}
		assert.True(t, p.subscriptionMatchesEvent(sub, EventOnCallChange, []string{}))
	})

	t.Run("on-call change with multiple resolved IDs matches any", func(t *testing.T) {
		sub := &ChannelSubscription{
			EventTypes: []string{EventOnCallChange},
			ServiceIDs: []string{"svc-2"},
		}
		// EP maps to multiple services; svc-2 matches
		assert.True(t, p.subscriptionMatchesEvent(sub, EventOnCallChange, []string{"svc-1", "svc-2"}))
	})
}

func TestFormatIncidentNotification(t *testing.T) {
	api := newMockAPI()
	p := newTestPlugin(api)

	incidentData := &pagerduty.WebhookIncidentData{
		Title:   "Server is down",
		HTMLURL: "https://example.pagerduty.com/incidents/P123",
		Service: pagerduty.ServiceReference{
			ID:      "svc-1",
			Summary: "Production API",
		},
		Urgency: "high",
		Assignees: []pagerduty.UserReference{
			{ID: "user-1", Summary: "Alice"},
			{ID: "user-2", Summary: "Bob"},
		},
		Description: "The server is not responding",
	}

	t.Run("incident triggered", func(t *testing.T) {
		msg := p.formatIncidentNotification(EventIncidentTriggered, incidentData)
		assert.Contains(t, msg, "Incident Triggered")
		assert.Contains(t, msg, "Server is down")
		assert.Contains(t, msg, "Production API")
		assert.Contains(t, msg, "high")
		assert.Contains(t, msg, "Alice, Bob")
		assert.Contains(t, msg, "The server is not responding")
	})

	t.Run("incident acknowledged", func(t *testing.T) {
		msg := p.formatIncidentNotification(EventIncidentAcknowledged, incidentData)
		assert.Contains(t, msg, "Incident Acknowledged")
		assert.Contains(t, msg, "Server is down")
		assert.Contains(t, msg, "Alice, Bob")
	})

	t.Run("incident resolved", func(t *testing.T) {
		msg := p.formatIncidentNotification(EventIncidentResolved, incidentData)
		assert.Contains(t, msg, "Incident Resolved")
		assert.Contains(t, msg, "Server is down")
		assert.Contains(t, msg, "Production API")
	})

	t.Run("incident escalated", func(t *testing.T) {
		msg := p.formatIncidentNotification(EventIncidentEscalated, incidentData)
		assert.Contains(t, msg, "Incident Escalated")
		assert.Contains(t, msg, "Server is down")
	})

	t.Run("incident reassigned", func(t *testing.T) {
		msg := p.formatIncidentNotification(EventIncidentReassigned, incidentData)
		assert.Contains(t, msg, "Incident Reassigned")
		assert.Contains(t, msg, "Alice, Bob")
	})

	t.Run("unknown event type returns empty", func(t *testing.T) {
		msg := p.formatIncidentNotification("unknown.event", incidentData)
		assert.Empty(t, msg)
	})

	t.Run("markdown injection in incident fields is neutralized", func(t *testing.T) {
		evil := &pagerduty.WebhookIncidentData{
			Title:   "@channel click [here](https://evil.com)",
			HTMLURL: "https://example.pagerduty.com/incidents/P123",
			Service: pagerduty.ServiceReference{
				ID:      "svc-1",
				Summary: "**bold** *italic*",
			},
			Urgency: "high",
			Assignees: []pagerduty.UserReference{
				{ID: "u1", Summary: "@all"},
			},
			Description: "line1\n# fake header\n> fake quote",
		}

		msg := p.formatIncidentNotification(EventIncidentTriggered, evil)

		assert.NotContains(t, msg, "[here](https://evil.com)", "attacker link must not render")
		assert.NotContains(t, msg, "@channel ", "raw @channel mention must be broken")
		assert.NotContains(t, msg, "@all,", "raw @all mention must be broken")
		assert.NotContains(t, msg, "\n# fake header", "newline-injected header must be stripped")
		assert.NotContains(t, msg, "\n> fake quote", "newline-injected blockquote must be stripped")
		assert.Contains(t, msg, "\\[here\\]", "brackets in title must be escaped")
		assert.Contains(t, msg, "\\*\\*bold\\*\\*", "asterisks in service summary must be escaped")
	})

	t.Run("non-http incident URL is rendered as plain text", func(t *testing.T) {
		evil := &pagerduty.WebhookIncidentData{
			Title:   "Server is down",
			HTMLURL: "javascript:alert(1)",
			Service: pagerduty.ServiceReference{ID: "svc-1", Summary: "API"},
		}
		msg := p.formatIncidentNotification(EventIncidentResolved, evil)
		assert.NotContains(t, msg, "javascript:")
		assert.NotContains(t, msg, "(javascript")
		assert.Contains(t, msg, "Server is down")
	})
}

func TestFormatAssignees(t *testing.T) {
	t.Run("empty assignees", func(t *testing.T) {
		assert.Equal(t, "", formatAssignees(nil))
		assert.Equal(t, "", formatAssignees([]pagerduty.UserReference{}))
	})

	t.Run("single assignee with summary", func(t *testing.T) {
		assignees := []pagerduty.UserReference{{ID: "u1", Summary: "Alice"}}
		assert.Equal(t, "Alice", formatAssignees(assignees))
	})

	t.Run("multiple assignees", func(t *testing.T) {
		assignees := []pagerduty.UserReference{
			{ID: "u1", Summary: "Alice"},
			{ID: "u2", Summary: "Bob"},
		}
		assert.Equal(t, "Alice, Bob", formatAssignees(assignees))
	})

	t.Run("assignee without summary uses ID", func(t *testing.T) {
		assignees := []pagerduty.UserReference{{ID: "u1"}}
		assert.Equal(t, "u1", formatAssignees(assignees))
	})
}

func TestOnCallNotificationFormatting(t *testing.T) {
	api := newMockAPI()
	p := newTestPlugin(api)

	t.Run("formatOnCallChangeChannel", func(t *testing.T) {
		newEntries := []OnCallEntry{{UserName: "Alice", End: "2024-01-15T10:00:00Z"}}
		removedEntries := []OnCallEntry{{UserName: "Bob"}}

		msg := p.formatOnCallChangeChannel("Primary Schedule", newEntries, removedEntries)
		assert.Contains(t, msg, "On-Call Change: Primary Schedule")
		assert.Contains(t, msg, "Alice")
		assert.Contains(t, msg, "Bob")
		assert.Contains(t, msg, "is now on-call")
		assert.Contains(t, msg, "no longer on-call")
	})

	t.Run("formatOnCallStartDM", func(t *testing.T) {
		msg := formatOnCallStartDM("Primary Schedule", "2024-01-15T10:00:00Z")
		assert.Contains(t, msg, "Primary Schedule")
		assert.Contains(t, msg, "on-call")
	})

	t.Run("formatOnCallEndDM with replacement", func(t *testing.T) {
		msg := formatOnCallEndDM("Primary Schedule", "Alice")
		assert.Contains(t, msg, "Primary Schedule")
		assert.Contains(t, msg, "ended")
		assert.Contains(t, msg, "Alice")
	})

	t.Run("formatOnCallEndDM without replacement", func(t *testing.T) {
		msg := formatOnCallEndDM("Primary Schedule", "")
		assert.Contains(t, msg, "Primary Schedule")
		assert.Contains(t, msg, "ended")
	})

	t.Run("formatShiftReminderDM", func(t *testing.T) {
		startTime := time.Now().Add(25 * time.Minute)
		msg := formatShiftReminderDM("Primary Schedule", startTime)
		assert.Contains(t, msg, "Primary Schedule")
		assert.Contains(t, msg, "starts in")
		// Use regex-style check: should contain some number of minutes
		assert.Regexp(t, `\d+m`, msg)
	})

	t.Run("formatShiftTakenDM", func(t *testing.T) {
		msg := formatShiftTakenDM("Alice", "Primary Schedule", "2024-01-15T08:00:00Z", "2024-01-15T16:00:00Z")
		assert.Contains(t, msg, "Alice")
		assert.Contains(t, msg, "Primary Schedule")
		assert.Contains(t, msg, "taken")
	})
}

func TestFormatTimeShort(t *testing.T) {
	t.Run("valid ISO time", func(t *testing.T) {
		result := formatTimeShort("2024-01-15T10:30:00Z")
		assert.Contains(t, result, "Jan 15")
		assert.Contains(t, result, "10:30")
	})

	t.Run("invalid time returns raw input", func(t *testing.T) {
		result := formatTimeShort("not-a-date")
		assert.Equal(t, "not-a-date", result)
	})
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		name     string
		duration time.Duration
		expected string
	}{
		{"negative returns now", -5 * time.Minute, "now"},
		{"minutes only", 25 * time.Minute, "25m"},
		{"hours and minutes", 2*time.Hour + 30*time.Minute, "2h 30m"},
		{"days and hours", 26 * time.Hour, "1d 2h"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatDuration(tt.duration)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestRouteToSubscribedChannels(t *testing.T) {
	t.Run("posts to matching channels", func(t *testing.T) {
		api := newMockAPI()

		var postedChannels []string
		api.On("CreatePost", mock.Anything).Run(func(args mock.Arguments) {
			post := args.Get(0).(*model.Post)
			postedChannels = append(postedChannels, post.ChannelId)
		}).Return(&model.Post{}, nil).Maybe()

		p := newTestPlugin(api)
		p.kvstore = &mockKVStore{
			getSubscriptionIndexFunc: func() ([]string, error) {
				return []string{"channel-1", "channel-2"}, nil
			},
			getChannelSubscriptionFunc: func(channelID string) (*kvstore.ChannelSubscription, error) {
				if channelID == "channel-1" {
					return &kvstore.ChannelSubscription{
						ChannelID:  "channel-1",
						EventTypes: []string{EventIncidentTriggered},
					}, nil
				}
				return &kvstore.ChannelSubscription{
					ChannelID:  "channel-2",
					EventTypes: []string{EventIncidentResolved},
				}, nil
			},
		}

		// Should post to channel-1 (matches event type) but not channel-2
		p.routeToSubscribedChannels(EventIncidentTriggered, []string{"svc-1"}, "Test message")

		assert.Contains(t, postedChannels, "channel-1")
		assert.NotContains(t, postedChannels, "channel-2")
	})
}

// newMockAPI creates a mock API with common log expectations
func newMockAPI() *plugintest.API {
	api := &plugintest.API{}
	// Accept log calls with varying numbers of key-value pairs (1, 3, 5, 7 args).
	for _, method := range []string{"LogDebug", "LogInfo", "LogWarn", "LogError"} {
		api.On(method, mock.Anything).Return().Maybe()
		api.On(method, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On(method, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On(method, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On(method, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
	}
	return api
}
