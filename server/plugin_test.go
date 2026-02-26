package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
	"github.com/svelle/mattermost-pagerduty-plugin/server/store/kvstore"
)

// mockKVStore implements kvstore.KVStore for testing
type mockKVStore struct {
	getUserTokenFunc              func(userID string) (*kvstore.OAuthToken, error)
	setUserTokenFunc              func(userID string, token *kvstore.OAuthToken) error
	deleteUserTokenFunc           func(userID string) error
	getOAuthStateFunc             func(state string) (*kvstore.OAuthState, error)
	setOAuthStateFunc             func(state string, oauthState *kvstore.OAuthState) error
	deleteOAuthStateFunc          func(state string) error
	getChannelSubscriptionFunc    func(channelID string) (*kvstore.ChannelSubscription, error)
	setChannelSubscriptionFunc    func(sub *kvstore.ChannelSubscription) error
	deleteChannelSubscriptionFunc func(channelID string) error
	getSubscriptionIndexFunc      func() ([]string, error)
	setSubscriptionIndexFunc      func(channelIDs []string) error
	getUserNotificationPrefsFunc  func(userID string) (*kvstore.UserNotificationPrefs, error)
	setUserNotificationPrefsFunc  func(userID string, prefs *kvstore.UserNotificationPrefs) error
	getWebhookRegistrationFunc    func() (*kvstore.WebhookRegistration, error)
	setWebhookRegistrationFunc    func(reg *kvstore.WebhookRegistration) error
	deleteWebhookRegistrationFunc func() error
	getOnCallSnapshotFunc         func() (*kvstore.OnCallSnapshot, error)
	setOnCallSnapshotFunc         func(snapshot *kvstore.OnCallSnapshot) error
}

func (m *mockKVStore) GetCachedSchedules() ([]byte, error) { return nil, nil }
func (m *mockKVStore) SetCachedSchedules(_ []byte) error   { return nil }

// Channel subscription methods
func (m *mockKVStore) GetChannelSubscription(channelID string) (*kvstore.ChannelSubscription, error) {
	if m.getChannelSubscriptionFunc != nil {
		return m.getChannelSubscriptionFunc(channelID)
	}
	return nil, nil
}
func (m *mockKVStore) SetChannelSubscription(sub *kvstore.ChannelSubscription) error {
	if m.setChannelSubscriptionFunc != nil {
		return m.setChannelSubscriptionFunc(sub)
	}
	return nil
}
func (m *mockKVStore) DeleteChannelSubscription(channelID string) error {
	if m.deleteChannelSubscriptionFunc != nil {
		return m.deleteChannelSubscriptionFunc(channelID)
	}
	return nil
}
func (m *mockKVStore) GetSubscriptionIndex() ([]string, error) {
	if m.getSubscriptionIndexFunc != nil {
		return m.getSubscriptionIndexFunc()
	}
	return nil, nil
}
func (m *mockKVStore) SetSubscriptionIndex(channelIDs []string) error {
	if m.setSubscriptionIndexFunc != nil {
		return m.setSubscriptionIndexFunc(channelIDs)
	}
	return nil
}

// User notification preferences
func (m *mockKVStore) GetUserNotificationPrefs(userID string) (*kvstore.UserNotificationPrefs, error) {
	if m.getUserNotificationPrefsFunc != nil {
		return m.getUserNotificationPrefsFunc(userID)
	}
	return nil, nil
}
func (m *mockKVStore) SetUserNotificationPrefs(userID string, prefs *kvstore.UserNotificationPrefs) error {
	if m.setUserNotificationPrefsFunc != nil {
		return m.setUserNotificationPrefsFunc(userID, prefs)
	}
	return nil
}

// Webhook registration
func (m *mockKVStore) GetWebhookRegistration() (*kvstore.WebhookRegistration, error) {
	if m.getWebhookRegistrationFunc != nil {
		return m.getWebhookRegistrationFunc()
	}
	return nil, nil
}
func (m *mockKVStore) SetWebhookRegistration(reg *kvstore.WebhookRegistration) error {
	if m.setWebhookRegistrationFunc != nil {
		return m.setWebhookRegistrationFunc(reg)
	}
	return nil
}
func (m *mockKVStore) DeleteWebhookRegistration() error {
	if m.deleteWebhookRegistrationFunc != nil {
		return m.deleteWebhookRegistrationFunc()
	}
	return nil
}

// On-call state cache
func (m *mockKVStore) GetOnCallSnapshot() (*kvstore.OnCallSnapshot, error) {
	if m.getOnCallSnapshotFunc != nil {
		return m.getOnCallSnapshotFunc()
	}
	return nil, nil
}
func (m *mockKVStore) SetOnCallSnapshot(snapshot *kvstore.OnCallSnapshot) error {
	if m.setOnCallSnapshotFunc != nil {
		return m.setOnCallSnapshotFunc(snapshot)
	}
	return nil
}

// Reminder tracking
func (m *mockKVStore) GetReminderRecord() (*kvstore.ReminderRecord, error) { return nil, nil }
func (m *mockKVStore) SetReminderRecord(_ *kvstore.ReminderRecord) error   { return nil }

func (m *mockKVStore) GetUserToken(userID string) (*kvstore.OAuthToken, error) {
	if m.getUserTokenFunc != nil {
		return m.getUserTokenFunc(userID)
	}
	return nil, nil
}

func (m *mockKVStore) SetUserToken(userID string, token *kvstore.OAuthToken) error {
	if m.setUserTokenFunc != nil {
		return m.setUserTokenFunc(userID, token)
	}
	return nil
}

func (m *mockKVStore) DeleteUserToken(userID string) error {
	if m.deleteUserTokenFunc != nil {
		return m.deleteUserTokenFunc(userID)
	}
	return nil
}

func (m *mockKVStore) GetOAuthState(state string) (*kvstore.OAuthState, error) {
	if m.getOAuthStateFunc != nil {
		return m.getOAuthStateFunc(state)
	}
	return nil, nil
}

func (m *mockKVStore) SetOAuthState(state string, oauthState *kvstore.OAuthState) error {
	if m.setOAuthStateFunc != nil {
		return m.setOAuthStateFunc(state, oauthState)
	}
	return nil
}

func (m *mockKVStore) DeleteOAuthState(state string) error {
	if m.deleteOAuthStateFunc != nil {
		return m.deleteOAuthStateFunc(state)
	}
	return nil
}

func setupMockAPIForActivation(api *plugintest.API, siteURL string) {
	api.On("GetConfig").Return(&model.Config{
		ServiceSettings: model.ServiceSettings{
			SiteURL: &siteURL,
		},
	})
	api.On("LogInfo", mock.Anything).Return().Maybe()
	api.On("LogInfo", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
	api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
	api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
	api.On("LogError", mock.Anything).Return().Maybe()
	api.On("LogError", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()

	// Bot setup mocks
	api.On("GetServerVersion").Return("7.0.0")
	api.On("GetBundlePath").Return("/tmp/plugin", nil).Maybe()
	api.On("KVGet", mock.Anything).Return(nil, nil).Maybe()
	api.On("KVSetWithOptions", mock.Anything, mock.Anything, mock.Anything).Return(true, nil).Maybe()
	api.On("EnsureBotUser", mock.Anything).Return("bot-user-id", nil).Maybe()
	api.On("PatchBot", mock.Anything, mock.Anything).Return(nil, nil).Maybe()

	// Slash command registration mock
	api.On("RegisterCommand", mock.Anything).Return(nil).Maybe()
}

func TestPlugin_OnActivate(t *testing.T) {
	t.Run("successful activation", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)

		setupMockAPIForActivation(api, "http://localhost:8065")

		plugin := &Plugin{}
		plugin.SetAPI(api)

		err := plugin.OnActivate()

		require.NoError(t, err)
		assert.NotNil(t, plugin.client)
		assert.NotNil(t, plugin.kvstore)
		assert.NotNil(t, plugin.createPagerDutyClient)
		assert.Equal(t, "http://localhost:8065", plugin.siteURL)
		assert.NotEmpty(t, plugin.botID)

		// Clean up monitor
		if plugin.onCallMonitor != nil {
			plugin.onCallMonitor.Stop()
		}
	})

	t.Run("missing site URL", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)

		api.On("GetConfig").Return(&model.Config{
			ServiceSettings: model.ServiceSettings{
				SiteURL: nil,
			},
		})
		api.On("LogInfo", mock.Anything).Return().Maybe()
		api.On("LogInfo", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogError", mock.Anything).Return().Maybe()
		api.On("LogError", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()

		plugin := &Plugin{}
		plugin.SetAPI(api)

		err := plugin.OnActivate()
		require.Error(t, err)
		assert.Contains(t, err.Error(), "site URL is not configured")
	})
}

func TestPlugin_OnDeactivate(t *testing.T) {
	api := &plugintest.API{}
	defer api.AssertExpectations(t)

	api.On("LogInfo", mock.Anything).Return()

	plugin := &Plugin{}
	plugin.SetAPI(api)
	plugin.client = pluginapi.NewClient(api, nil)

	err := plugin.OnDeactivate()
	assert.NoError(t, err)
}

func TestPlugin_ServeHTTP(t *testing.T) {
	tests := []struct {
		name           string
		method         string
		path           string
		userID         string
		setupPlugin    func(*Plugin)
		expectedStatus int
	}{
		{
			name:           "missing user ID",
			method:         http.MethodGet,
			path:           "/api/v1/schedules",
			userID:         "",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "nonexistent endpoint",
			method:         http.MethodGet,
			path:           "/api/v1/nonexistent",
			userID:         "test-user-id",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:   "schedules endpoint - not connected",
			method: http.MethodGet,
			path:   "/api/v1/schedules",
			userID: "test-user-id",
			setupPlugin: func(p *Plugin) {
				p.configuration = &configuration{
					OAuthClientID:     "client-id",
					OAuthClientSecret: "client-secret",
				}
				p.kvstore = &mockKVStore{}
			},
			expectedStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			api := &plugintest.API{}
			defer api.AssertExpectations(t)

			api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Maybe()
			api.On("LogInfo", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Maybe()
			api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Maybe()
			api.On("LogError", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Maybe()

			p := &Plugin{}
			p.SetAPI(api)
			p.client = pluginapi.NewClient(api, nil)
			p.createPagerDutyClient = pagerduty.NewOAuthClient
			p.kvstore = &mockKVStore{}
			p.configuration = &configuration{}

			if tt.setupPlugin != nil {
				tt.setupPlugin(p)
			}

			p.router = p.initRouter()

			w := httptest.NewRecorder()
			r := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.userID != "" {
				r.Header.Set("Mattermost-User-ID", tt.userID)
			}

			p.ServeHTTP(nil, w, r)

			result := w.Result()
			assert.NotNil(t, result)
			assert.Equal(t, tt.expectedStatus, result.StatusCode)
		})
	}
}

func TestPlugin_Configuration(t *testing.T) {
	t.Run("IsValid", func(t *testing.T) {
		tests := []struct {
			name    string
			config  configuration
			wantErr bool
		}{
			{
				name: "valid configuration",
				config: configuration{
					OAuthClientID:     "client-id",
					OAuthClientSecret: "client-secret",
					APIBaseURL:        "https://api.pagerduty.com",
				},
				wantErr: false,
			},
			{
				name: "missing client ID",
				config: configuration{
					OAuthClientID:     "",
					OAuthClientSecret: "client-secret",
					APIBaseURL:        "https://api.pagerduty.com",
				},
				wantErr: true,
			},
			{
				name: "missing client secret",
				config: configuration{
					OAuthClientID:     "client-id",
					OAuthClientSecret: "",
					APIBaseURL:        "https://api.pagerduty.com",
				},
				wantErr: true,
			},
			{
				name: "empty base URL is ok",
				config: configuration{
					OAuthClientID:     "client-id",
					OAuthClientSecret: "client-secret",
					APIBaseURL:        "",
				},
				wantErr: false,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				err := tt.config.IsValid()
				if tt.wantErr {
					assert.Error(t, err)
				} else {
					assert.NoError(t, err)
				}
			})
		}
	})

	t.Run("setConfiguration", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)

		plugin := &Plugin{}
		plugin.SetAPI(api)
		plugin.client = pluginapi.NewClient(api, nil)

		config := &configuration{
			OAuthClientID:     "new-client-id",
			OAuthClientSecret: "new-client-secret",
			APIBaseURL:        "https://new.pagerduty.com",
		}

		plugin.setConfiguration(config)

		got := plugin.getConfiguration()
		assert.Equal(t, config, got)
	})

	t.Run("OnConfigurationChange", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)

		api.On("LoadPluginConfiguration", mock.Anything).Run(func(args mock.Arguments) {
			config := args.Get(0).(*configuration)
			config.OAuthClientID = "loaded-client-id"
			config.OAuthClientSecret = "loaded-client-secret"
			config.APIBaseURL = "https://api.pagerduty.com"
		}).Return(nil)

		plugin := &Plugin{}
		plugin.SetAPI(api)
		plugin.client = pluginapi.NewClient(api, nil)

		err := plugin.OnConfigurationChange()
		assert.NoError(t, err)

		config := plugin.getConfiguration()
		assert.Equal(t, "loaded-client-id", config.OAuthClientID)
		assert.Equal(t, "loaded-client-secret", config.OAuthClientSecret)
		assert.Equal(t, "https://api.pagerduty.com", config.APIBaseURL)
	})
}

func TestPlugin_Integration(t *testing.T) {
	t.Run("full plugin lifecycle", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)

		setupMockAPIForActivation(api, "http://localhost:8065")

		plugin := &Plugin{}
		plugin.SetAPI(api)

		err := plugin.OnActivate()
		require.NoError(t, err)

		assert.NotNil(t, plugin.client)
		assert.NotNil(t, plugin.kvstore)

		config := &configuration{
			OAuthClientID:     "client-id",
			OAuthClientSecret: "client-secret",
			APIBaseURL:        "https://api.pagerduty.com",
		}
		plugin.setConfiguration(config)

		err = plugin.OnDeactivate()
		assert.NoError(t, err)
	})
}
