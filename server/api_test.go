package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
)

func TestPlugin_handleError(t *testing.T) {
	tests := []struct {
		name         string
		apiError     *APIError
		expectedCode int
		expectedBody map[string]interface{}
	}{
		{
			name: "standard error",
			apiError: &APIError{
				ID:         "test.error",
				Message:    "Test error message",
				StatusCode: http.StatusBadRequest,
			},
			expectedCode: http.StatusBadRequest,
			expectedBody: map[string]interface{}{
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
			expectedBody: map[string]interface{}{
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

			var responseBody map[string]interface{}
			err := json.Unmarshal(w.Body.Bytes(), &responseBody)
			assert.NoError(t, err)
			assert.Equal(t, tt.expectedBody, responseBody)
		})
	}
}

func TestPlugin_MattermostAuthorizationRequired(t *testing.T) {
	tests := []struct {
		name           string
		userID         string
		expectedStatus int
		expectedBody   string
	}{
		{
			name:           "with user ID",
			userID:         "test-user-id",
			expectedStatus: http.StatusOK,
			expectedBody:   "OK",
		},
		{
			name:           "without user ID",
			userID:         "",
			expectedStatus: http.StatusUnauthorized,
			expectedBody:   "Not authorized\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plugin := &Plugin{}

			testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte("OK"))
			})

			handler := plugin.MattermostAuthorizationRequired(testHandler)

			req := httptest.NewRequest("GET", "/test", nil)
			if tt.userID != "" {
				req.Header.Set("Mattermost-User-ID", tt.userID)
			}
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)
			assert.Equal(t, tt.expectedBody, w.Body.String())
		})
	}
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
		for i := 0; i < 10; i++ {
			go func() {
				config := plugin.getConfiguration()
				assert.NotNil(t, config)
				done <- true
			}()
		}

		for i := 0; i < 10; i++ {
			<-done
		}
	})
}
