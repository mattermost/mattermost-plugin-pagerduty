package testutils

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// SetupTestPlugin creates a test plugin instance with mocked API
func SetupTestPlugin(t *testing.T) (*plugintest.API, *mux.Router) {
	api := &plugintest.API{}

	// Set up common expectations
	api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything).Maybe()
	api.On("LogInfo", mock.Anything, mock.Anything, mock.Anything).Maybe()
	api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything).Maybe()
	api.On("LogError", mock.Anything, mock.Anything, mock.Anything).Maybe()

	router := mux.NewRouter()
	return api, router
}

// MakeAuthenticatedRequest creates an HTTP request with authentication headers
func MakeAuthenticatedRequest(t *testing.T, method, url string, body interface{}, userID string) *http.Request {
	var bodyReader io.Reader
	if body != nil {
		bodyBytes, err := json.Marshal(body)
		require.NoError(t, err)
		bodyReader = bytes.NewReader(bodyBytes)
	}

	req := httptest.NewRequest(method, url, bodyReader)
	req.Header.Set("Mattermost-User-ID", userID)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return req
}

// AssertJSONResponse checks if the response has the expected status code and decodes the JSON body
func AssertJSONResponse(t *testing.T, w *httptest.ResponseRecorder, expectedStatus int, v interface{}) {
	require.Equal(t, expectedStatus, w.Code)

	if v != nil && w.Body.Len() > 0 {
		require.Equal(t, "application/json", w.Header().Get("Content-Type"))
		err := json.NewDecoder(w.Body).Decode(v)
		require.NoError(t, err)
	}
}

// MockHTTPClient creates a mock HTTP client for testing external API calls
type MockHTTPClient struct {
	DoFunc func(req *http.Request) (*http.Response, error)
}

func (m *MockHTTPClient) Do(req *http.Request) (*http.Response, error) {
	return m.DoFunc(req)
}

// NewMockHTTPResponse creates a mock HTTP response
func NewMockHTTPResponse(statusCode int, body string) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Body:       io.NopCloser(bytes.NewBufferString(body)),
		Header:     make(http.Header),
	}
}

// CreateTestUser creates a test user
func CreateTestUser(id, username string) *model.User {
	return &model.User{
		Id:       id,
		Username: username,
		Email:    username + "@example.com",
	}
}

// CreateTestConfig creates a test plugin configuration
func CreateTestConfig() map[string]interface{} {
	return map[string]interface{}{
		"OAuthClientID":     "test-client-id",
		"OAuthClientSecret": "test-client-secret",
		"APIBaseURL":        "https://api.pagerduty.com",
	}
}
