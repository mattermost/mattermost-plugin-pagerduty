// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package pagerduty

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockHTTPClient struct {
	doFunc func(req *http.Request) (*http.Response, error)
}

func (m *mockHTTPClient) Do(req *http.Request) (*http.Response, error) {
	return m.doFunc(req)
}

func newMockResponse(statusCode int, body string) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

func TestNewOAuthClient(t *testing.T) {
	tests := []struct {
		name           string
		accessToken    string
		baseURL        string
		wantBaseURL    string
		wantAuthHeader string
	}{
		{
			name:           "with custom base URL",
			accessToken:    "oauth-token-123",
			baseURL:        "https://custom.pagerduty.com",
			wantBaseURL:    "https://custom.pagerduty.com",
			wantAuthHeader: "Bearer oauth-token-123",
		},
		{
			name:           "with empty base URL uses default",
			accessToken:    "oauth-token-456",
			baseURL:        "",
			wantBaseURL:    defaultBaseURL,
			wantAuthHeader: "Bearer oauth-token-456",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewOAuthClient(tt.accessToken, tt.baseURL)
			assert.NotNil(t, client)
			assert.Equal(t, tt.wantBaseURL, client.baseURL)
			assert.Equal(t, tt.wantAuthHeader, client.authHeader)
			assert.NotNil(t, client.httpClient)
		})
	}
}

func TestNewClient(t *testing.T) {
	tests := []struct {
		name           string
		apiToken       string
		baseURL        string
		wantBaseURL    string
		wantAuthHeader string
	}{
		{
			name:           "with custom base URL",
			apiToken:       "test-token",
			baseURL:        "https://custom.pagerduty.com",
			wantBaseURL:    "https://custom.pagerduty.com",
			wantAuthHeader: "Token token=test-token",
		},
		{
			name:           "with empty base URL uses default",
			apiToken:       "test-token",
			baseURL:        "",
			wantBaseURL:    defaultBaseURL,
			wantAuthHeader: "Token token=test-token",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewClient(tt.apiToken, tt.baseURL)
			assert.NotNil(t, client)
			assert.Equal(t, tt.wantBaseURL, client.baseURL)
			assert.Equal(t, tt.wantAuthHeader, client.authHeader)
			assert.NotNil(t, client.httpClient)
		})
	}
}

func TestClient_doRequest(t *testing.T) {
	tests := []struct {
		name        string
		method      string
		path        string
		params      url.Values
		authHeader  string
		mockFunc    func(req *http.Request) (*http.Response, error)
		wantBody    string
		wantErr     bool
		errContains string
	}{
		{
			name:       "successful GET request with Bearer auth",
			method:     "GET",
			path:       "/api/v1/schedules",
			params:     url.Values{"limit": []string{"10"}},
			authHeader: "Bearer oauth-token",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "GET", req.Method)
				assert.Equal(t, "https://api.pagerduty.com/api/v1/schedules?limit=10", req.URL.String())
				assert.Equal(t, "application/vnd.pagerduty+json;version=2", req.Header.Get("Accept"))
				assert.Equal(t, "Bearer oauth-token", req.Header.Get("Authorization"))

				return newMockResponse(200, `{"schedules": []}`), nil
			},
			wantBody: `{"schedules": []}`,
			wantErr:  false,
		},
		{
			name:       "successful GET request with legacy Token auth",
			method:     "GET",
			path:       "/api/v1/schedules",
			params:     url.Values{"limit": []string{"10"}},
			authHeader: "Token token=test-token",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "Token token=test-token", req.Header.Get("Authorization"))
				return newMockResponse(200, `{"schedules": []}`), nil
			},
			wantBody: `{"schedules": []}`,
			wantErr:  false,
		},
		{
			name:       "handles 401 unauthorized",
			method:     "GET",
			path:       "/api/v1/schedules",
			authHeader: "Bearer oauth-token",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(401, `{"error": {"message": "Unauthorized"}}`), nil
			},
			wantErr:     true,
			errContains: "Unauthorized",
		},
		{
			name:       "handles network error",
			method:     "GET",
			path:       "/api/v1/schedules",
			authHeader: "Bearer oauth-token",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return nil, errors.New("network error")
			},
			wantErr:     true,
			errContains: "network error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &Client{
				baseURL:    "https://api.pagerduty.com",
				authHeader: tt.authHeader,
				httpClient: &mockHTTPClient{
					doFunc: tt.mockFunc,
				},
			}

			body, err := client.doRequest(tt.method, tt.path, tt.params)

			if tt.wantErr {
				require.Error(t, err)
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.wantBody, string(body))
			}
		})
	}
}

func TestClient_GetSchedules(t *testing.T) {
	client := &Client{
		baseURL:    "https://api.pagerduty.com",
		authHeader: "Bearer test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "25", req.URL.Query().Get("limit"))
				assert.Equal(t, "0", req.URL.Query().Get("offset"))
				return newMockResponse(200, `{
					"schedules": [{"id": "SCHED1", "name": "Primary On-Call", "time_zone": "America/New_York"}],
					"limit": 25, "offset": 0, "total": 1
				}`), nil
			},
		},
	}

	got, err := client.GetSchedules(25, 0)
	require.NoError(t, err)
	assert.Len(t, got.Schedules, 1)
	assert.Equal(t, "SCHED1", got.Schedules[0].ID)
}

func TestClient_GetOnCalls(t *testing.T) {
	client := &Client{
		baseURL:    "https://api.pagerduty.com",
		authHeader: "Bearer test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(200, `{"oncalls": [{"user": {"id": "USER1"}, "escalation_level": 1}]}`), nil
			},
		},
	}

	got, err := client.GetOnCalls(nil)
	require.NoError(t, err)
	assert.Len(t, got.OnCalls, 1)
}

func TestClient_GetSchedule(t *testing.T) {
	client := &Client{
		baseURL:    "https://api.pagerduty.com",
		authHeader: "Bearer test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				assert.Contains(t, req.URL.Path, "SCHED1")
				return newMockResponse(200, `{
					"schedule": {
						"id": "SCHED1", "name": "Primary On-Call", "time_zone": "America/New_York",
						"final_schedule": {"rendered_schedule_entries": [{"start": "2024-01-01T00:00:00Z", "end": "2024-01-02T00:00:00Z", "user": {"id": "USER1", "name": "John Doe"}}]}
					}
				}`), nil
			},
		},
	}

	got, err := client.GetSchedule("SCHED1", time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2024, 1, 2, 0, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	assert.Equal(t, "SCHED1", got.Schedule.ID)
}

func TestClient_GetCurrentOnCalls(t *testing.T) {
	client := &Client{
		baseURL:    "https://api.pagerduty.com",
		authHeader: "Bearer test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				query := req.URL.Query()
				assert.Equal(t, "UTC", query.Get("time_zone"))
				assert.Equal(t, []string{"users", "schedules"}, query["include[]"])
				assert.Equal(t, "true", query.Get("earliest"))

				return newMockResponse(200, `{
					"oncalls": [{"user": {"id": "USER1", "name": "John Doe"}, "schedule": {"id": "SCHED1", "name": "Primary"}, "escalation_level": 1, "start": "2024-01-01T00:00:00Z", "end": "2024-01-02T00:00:00Z"}]
				}`), nil
			},
		},
	}

	response, err := client.GetCurrentOnCalls()
	require.NoError(t, err)
	assert.Len(t, response.OnCalls, 1)
	assert.Equal(t, "USER1", response.OnCalls[0].User.ID)
}

func TestClient_GetOnCallsForSchedule(t *testing.T) {
	scheduleID := "SCHED123"
	client := &Client{
		baseURL:    "https://api.pagerduty.com",
		authHeader: "Bearer test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				query := req.URL.Query()
				assert.Equal(t, []string{scheduleID}, query["schedule_ids[]"])
				assert.Equal(t, []string{"users"}, query["include[]"])
				assert.Equal(t, "true", query.Get("earliest"))

				return newMockResponse(200, `{"oncalls": []}`), nil
			},
		},
	}

	response, err := client.GetOnCallsForSchedule(scheduleID)
	require.NoError(t, err)
	assert.NotNil(t, response)
}

func TestClient_GetIncidents(t *testing.T) {
	client := &Client{
		baseURL:    "https://api.pagerduty.com",
		authHeader: "Bearer test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				query := req.URL.Query()
				assert.Equal(t, []string{"triggered", "acknowledged"}, query["statuses[]"])
				assert.Equal(t, "created_at:desc", query.Get("sort_by"))
				return newMockResponse(200, `{"incidents": [{"id": "INC1", "title": "Test", "status": "triggered"}], "limit": 100, "offset": 0, "more": false, "total": 1}`), nil
			},
		},
	}

	response, err := client.GetIncidents([]string{"triggered", "acknowledged"}, nil, 100, 0)
	require.NoError(t, err)
	assert.Len(t, response.Incidents, 1)
}

func TestClient_UpdateIncident(t *testing.T) {
	client := &Client{
		baseURL:    "https://api.pagerduty.com",
		authHeader: "Bearer test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "PUT", req.Method)
				assert.Contains(t, req.URL.Path, "/incidents/INC1")
				assert.Equal(t, "user@example.com", req.Header.Get("From"))
				return newMockResponse(200, `{"incident": {"id": "INC1", "status": "acknowledged"}}`), nil
			},
		},
	}

	response, err := client.UpdateIncident("INC1", "acknowledged", "user@example.com")
	require.NoError(t, err)
	assert.Equal(t, "INC1", response.Incident.ID)
	assert.Equal(t, "acknowledged", response.Incident.Status)
}

func TestClient_GetIncidentNotes(t *testing.T) {
	client := &Client{
		baseURL:    "https://api.pagerduty.com",
		authHeader: "Bearer test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "GET", req.Method)
				assert.Contains(t, req.URL.Path, "/incidents/INC1/notes")
				return newMockResponse(200, `{"notes": [{"id": "N1", "content": "test note", "created_at": "2024-01-01T00:00:00Z", "user": {"id": "U1", "type": "user_reference", "summary": "Test User"}}]}`), nil
			},
		},
	}

	response, err := client.GetIncidentNotes("INC1")
	require.NoError(t, err)
	assert.Len(t, response.Notes, 1)
}

func TestClient_CreateIncidentNote(t *testing.T) {
	client := &Client{
		baseURL:    "https://api.pagerduty.com",
		authHeader: "Bearer test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "POST", req.Method)
				assert.Contains(t, req.URL.Path, "/incidents/INC1/notes")
				assert.Equal(t, "user@example.com", req.Header.Get("From"))
				return newMockResponse(201, `{"note": {"id": "N1", "content": "This is a note", "created_at": "2024-01-01T00:00:00Z", "user": {"id": "U1", "type": "user_reference", "summary": "Test User"}}}`), nil
			},
		},
	}

	response, err := client.CreateIncidentNote("INC1", "This is a note", "user@example.com")
	require.NoError(t, err)
	assert.Equal(t, "This is a note", response.Note.Content)
	assert.NotEmpty(t, response.Note.ID)
}

func TestClient_HTTPClientInterface(t *testing.T) {
	var _ HTTPClient = &http.Client{}
	var _ HTTPClient = &mockHTTPClient{}
}
