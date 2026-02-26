package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
)

func newTestPlugin(api *plugintest.API) *Plugin {
	p := &Plugin{}
	p.SetAPI(api)
	p.client = pluginapi.NewClient(api, nil)
	p.botID = "bot-user-id"
	p.kvstore = &mockKVStore{}
	p.configuration = &configuration{}
	p.createPagerDutyClient = pagerduty.NewOAuthClient
	p.router = p.initRouter()
	return p
}

func signPayload(body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyWebhookSignature(t *testing.T) {
	api := &plugintest.API{}
	api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
	api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()

	p := newTestPlugin(api)

	t.Run("valid signature", func(t *testing.T) {
		secret := "test-secret-123"
		p.kvstore = &mockKVStore{
			getWebhookRegistrationFunc: func() (*WebhookRegistration, error) {
				return &WebhookRegistration{Secret: secret}, nil
			},
		}

		body := []byte(`{"event":{"id":"test"}}`)
		signature := signPayload(body, secret)

		assert.True(t, p.verifyWebhookSignature(body, signature))
	})

	t.Run("invalid signature", func(t *testing.T) {
		secret := "test-secret-123"
		p.kvstore = &mockKVStore{
			getWebhookRegistrationFunc: func() (*WebhookRegistration, error) {
				return &WebhookRegistration{Secret: secret}, nil
			},
		}

		body := []byte(`{"event":{"id":"test"}}`)

		assert.False(t, p.verifyWebhookSignature(body, "v1=deadbeef"))
	})

	t.Run("missing signature header", func(t *testing.T) {
		p.kvstore = &mockKVStore{
			getWebhookRegistrationFunc: func() (*WebhookRegistration, error) {
				return &WebhookRegistration{Secret: "some-secret"}, nil
			},
		}

		body := []byte(`{"event":{"id":"test"}}`)

		assert.False(t, p.verifyWebhookSignature(body, ""))
	})

	t.Run("no secret configured skips verification", func(t *testing.T) {
		p.kvstore = &mockKVStore{}
		p.configuration = &configuration{}

		body := []byte(`{"event":{"id":"test"}}`)

		assert.True(t, p.verifyWebhookSignature(body, ""))
	})

	t.Run("invalid signature format", func(t *testing.T) {
		p.kvstore = &mockKVStore{
			getWebhookRegistrationFunc: func() (*WebhookRegistration, error) {
				return &WebhookRegistration{Secret: "some-secret"}, nil
			},
		}

		body := []byte(`{"event":{"id":"test"}}`)

		assert.False(t, p.verifyWebhookSignature(body, "invalid-format"))
	})

	t.Run("config fallback secret", func(t *testing.T) {
		secret := "config-secret"
		p.kvstore = &mockKVStore{} // No registration
		p.configuration = &configuration{WebhookSecret: secret}

		body := []byte(`{"event":{"id":"test"}}`)
		signature := signPayload(body, secret)

		assert.True(t, p.verifyWebhookSignature(body, signature))
	})
}

func TestHandlePagerDutyWebhook(t *testing.T) {
	t.Run("rejects non-POST", func(t *testing.T) {
		api := &plugintest.API{}
		api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()

		p := newTestPlugin(api)

		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/api/v1/webhook", nil)
		p.handlePagerDutyWebhook(w, r)

		assert.Equal(t, http.StatusMethodNotAllowed, w.Code)
	})

	t.Run("rejects invalid signature", func(t *testing.T) {
		api := &plugintest.API{}
		api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogInfo", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()

		p := newTestPlugin(api)
		p.kvstore = &mockKVStore{
			getWebhookRegistrationFunc: func() (*WebhookRegistration, error) {
				return &WebhookRegistration{Secret: "the-secret"}, nil
			},
		}

		body := []byte(`{"event":{"id":"test"}}`)
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/api/v1/webhook", bytes.NewReader(body))
		r.Header.Set("X-PagerDuty-Signature", "v1=badsignature")

		p.handlePagerDutyWebhook(w, r)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("accepts valid webhook", func(t *testing.T) {
		api := &plugintest.API{}
		api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogInfo", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogError", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()

		secret := "webhook-secret"
		p := newTestPlugin(api)
		p.kvstore = &mockKVStore{
			getWebhookRegistrationFunc: func() (*WebhookRegistration, error) {
				return &WebhookRegistration{Secret: secret}, nil
			},
		}

		incidentData := pagerduty.WebhookIncidentData{
			Title:   "Test Incident",
			HTMLURL: "https://example.pagerduty.com/incidents/P123",
			Service: pagerduty.ServiceReference{ID: "svc1", Summary: "Test Service"},
		}
		dataBytes, _ := json.Marshal(incidentData)

		payload := pagerduty.WebhookPayload{
			Event: pagerduty.WebhookEvent{
				ID:           "event-1",
				EventType:    "incident.triggered",
				ResourceType: "incident",
				Data:         dataBytes,
			},
		}
		body, _ := json.Marshal(payload)

		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/api/v1/webhook", bytes.NewReader(body))
		r.Header.Set("X-PagerDuty-Signature", signPayload(body, secret))

		p.handlePagerDutyWebhook(w, r)

		assert.Equal(t, http.StatusOK, w.Code)
	})
}
