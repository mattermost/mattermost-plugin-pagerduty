// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// newTestAPI creates a mock API with common log expectations for api_test.go
func newTestAPI() *plugintest.API {
	api := &plugintest.API{}
	api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
	api.On("LogInfo", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
	api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
	api.On("LogError", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
	return api
}

func TestPlugin_handleError(t *testing.T) {
	tests := []struct {
		name         string
		apiError     *APIError
		expectedCode int
		expectedBody map[string]any
	}{
		{
			name: "standard error",
			apiError: &APIError{
				ID:         "test.error",
				Message:    "Test error message",
				StatusCode: http.StatusBadRequest,
			},
			expectedCode: http.StatusBadRequest,
			expectedBody: map[string]any{
				"id":      "test.error",
				"message": "Test error message",
			},
		},
		{
			name: "internal server error",
			apiError: &APIError{
				ID:         "internal.error",
				Message:    "Something went wrong",
				StatusCode: http.StatusInternalServerError,
			},
			expectedCode: http.StatusInternalServerError,
			expectedBody: map[string]any{
				"id":      "internal.error",
				"message": "Something went wrong",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plugin := &Plugin{
				client: &pluginapi.Client{},
			}

			w := httptest.NewRecorder()
			r := httptest.NewRequest("GET", "/test", nil)

			plugin.handleError(w, r, tt.apiError)

			assert.Equal(t, tt.expectedCode, w.Code)
			assert.Equal(t, "application/json", w.Header().Get("Content-Type"))

			var responseBody map[string]any
			err := json.Unmarshal(w.Body.Bytes(), &responseBody)
			assert.NoError(t, err)
			assert.Equal(t, tt.expectedBody, responseBody)
		})
	}
}

func TestPlugin_MattermostAuthorizationRequired(t *testing.T) {
	t.Run("with user ID", func(t *testing.T) {
		api := newTestAPI()
		p := &Plugin{}
		p.SetAPI(api)
		p.client = pluginapi.NewClient(api, nil)

		testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("OK"))
		})

		handler := p.MattermostAuthorizationRequired(testHandler)

		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Mattermost-User-ID", "test-user-id")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "OK", w.Body.String())
	})

	t.Run("without user ID returns JSON error", func(t *testing.T) {
		api := newTestAPI()
		p := &Plugin{}
		p.SetAPI(api)
		p.client = pluginapi.NewClient(api, nil)

		testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("OK"))
		})

		handler := p.MattermostAuthorizationRequired(testHandler)

		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
		assert.Equal(t, "application/json", w.Header().Get("Content-Type"))

		var errResp map[string]any
		err := json.Unmarshal(w.Body.Bytes(), &errResp)
		assert.NoError(t, err)
		assert.Equal(t, "not_authorized", errResp["id"])
		assert.Contains(t, errResp["message"], "Not authorized")
	})
}

func TestPlugin_getConfiguration(t *testing.T) {
	t.Run("returns configuration", func(t *testing.T) {
		expectedConfig := &configuration{
			OAuthClientID:     "client-id",
			OAuthClientSecret: "client-secret",
			APIBaseURL:        "https://api.pagerduty.com",
		}

		plugin := &Plugin{
			configuration: expectedConfig,
		}

		config := plugin.getConfiguration()
		assert.Equal(t, expectedConfig, config)
	})

	t.Run("handles concurrent access", func(t *testing.T) {
		plugin := &Plugin{
			configuration: &configuration{
				OAuthClientID:     "client-id",
				OAuthClientSecret: "client-secret",
				APIBaseURL:        "https://api.pagerduty.com",
			},
		}

		done := make(chan bool, 10)
		for range 10 {
			go func() {
				config := plugin.getConfiguration()
				assert.NotNil(t, config)
				done <- true
			}()
		}

		for range 10 {
			<-done
		}
	})
}
