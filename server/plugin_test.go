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
	getUserTokenFunc    func(userID string) (*kvstore.OAuthToken, error)
	setUserTokenFunc    func(userID string, token *kvstore.OAuthToken) error
	deleteUserTokenFunc func(userID string) error
	getOAuthStateFunc   func(state string) (*kvstore.OAuthState, error)
	setOAuthStateFunc   func(state string, oauthState *kvstore.OAuthState) error
	deleteOAuthStateFunc func(state string) error
}

func (m *mockKVStore) GetCachedSchedules() ([]byte, error) { return nil, nil }
func (m *mockKVStore) SetCachedSchedules(_ []byte) error    { return nil }

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

func TestPlugin_OnActivate(t *testing.T) {
	t.Run("successful activation", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)

		siteURL := "http://localhost:8065"
		api.On("GetConfig").Return(&model.Config{
			ServiceSettings: model.ServiceSettings{
				SiteURL: &siteURL,
			},
		})
		api.On("LogInfo", mock.Anything).Return().Maybe()
		api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogError", mock.Anything).Return().Maybe()

		plugin := &Plugin{}
		plugin.SetAPI(api)

		err := plugin.OnActivate()

		require.NoError(t, err)
		assert.NotNil(t, plugin.client)
		assert.NotNil(t, plugin.kvstore)
		assert.NotNil(t, plugin.createPagerDutyClient)
		assert.Equal(t, "http://localhost:8065", plugin.siteURL)
	})

	t.Run("missing site URL", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)

		api.On("GetConfig").Return(&model.Config{
			ServiceSettings: model.ServiceSettings{
				SiteURL: nil,
			},
		})
		api.On("LogInfo", mock.Anything).Return()
		api.On("LogError", mock.Anything).Return()

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

			plugin := &Plugin{}
			plugin.SetAPI(api)
			plugin.client = pluginapi.NewClient(api, nil)
			plugin.createPagerDutyClient = pagerduty.NewOAuthClient

			if tt.setupPlugin != nil {
				tt.setupPlugin(plugin)
			}

			w := httptest.NewRecorder()
			r := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.userID != "" {
				r.Header.Set("Mattermost-User-ID", tt.userID)
			}

			plugin.ServeHTTP(nil, w, r)

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

		siteURL := "http://localhost:8065"
		api.On("GetConfig").Return(&model.Config{
			ServiceSettings: model.ServiceSettings{
				SiteURL: &siteURL,
			},
		})
		api.On("LogInfo", mock.Anything).Return().Maybe()
		api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On("LogError", mock.Anything).Return().Maybe()

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
