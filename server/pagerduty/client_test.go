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

func TestNewClient(t *testing.T) {
	tests := []struct {
		name        string
		apiToken    string
		baseURL     string
		wantBaseURL string
	}{
		{
			name:        "with custom base URL",
			apiToken:    "test-token",
			baseURL:     "https://custom.pagerduty.com",
			wantBaseURL: "https://custom.pagerduty.com",
		},
		{
			name:        "with empty base URL uses default",
			apiToken:    "test-token",
			baseURL:     "",
			wantBaseURL: defaultBaseURL,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewClient(tt.apiToken, tt.baseURL)
			assert.NotNil(t, client)
			assert.Equal(t, tt.apiToken, client.apiToken)
			assert.Equal(t, tt.wantBaseURL, client.baseURL)
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
		mockFunc    func(req *http.Request) (*http.Response, error)
		wantBody    string
		wantErr     bool
		errContains string
	}{
		{
			name:   "successful GET request",
			method: "GET",
			path:   "/api/v1/schedules",
			params: url.Values{"limit": []string{"10"}},
			mockFunc: func(req *http.Request) (*http.Response, error) {
				// Verify request
				assert.Equal(t, "GET", req.Method)
				assert.Equal(t, "https://api.pagerduty.com/api/v1/schedules?limit=10", req.URL.String())
				assert.Equal(t, "application/vnd.pagerduty+json;version=2", req.Header.Get("Accept"))
				assert.Equal(t, "Token token=test-token", req.Header.Get("Authorization"))

				return newMockResponse(200, `{"schedules": []}`), nil
			},
			wantBody: `{"schedules": []}`,
			wantErr:  false,
		},
		{
			name:   "handles 401 unauthorized",
			method: "GET",
			path:   "/api/v1/schedules",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(401, `{"error": {"message": "Unauthorized"}}`), nil
			},
			wantErr:     true,
			errContains: "Unauthorized",
		},
		{
			name:   "handles network error",
			method: "GET",
			path:   "/api/v1/schedules",
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
				baseURL:  "https://api.pagerduty.com",
				apiToken: "test-token",
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
	tests := []struct {
		name     string
		limit    int
		offset   int
		mockFunc func(req *http.Request) (*http.Response, error)
		want     *SchedulesResponse
		wantErr  bool
	}{
		{
			name:   "successful response",
			limit:  25,
			offset: 0,
			mockFunc: func(req *http.Request) (*http.Response, error) {
				// Verify query parameters
				assert.Equal(t, "25", req.URL.Query().Get("limit"))
				assert.Equal(t, "0", req.URL.Query().Get("offset"))

				return newMockResponse(200, `{
					"schedules": [
						{
							"id": "SCHED1",
							"name": "Primary On-Call",
							"time_zone": "America/New_York"
						}
					],
					"limit": 25,
					"offset": 0,
					"total": 1
				}`), nil
			},
			want: &SchedulesResponse{
				Schedules: []Schedule{
					{
						ID:       "SCHED1",
						Name:     "Primary On-Call",
						TimeZone: "America/New_York",
					},
				},
				ListResponse: ListResponse{
					Limit:  25,
					Offset: 0,
					Total:  1,
				},
			},
			wantErr: false,
		},
		{
			name:   "API error",
			limit:  10,
			offset: 0,
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(500, `{"error": {"message": "Internal server error"}}`), nil
			},
			wantErr: true,
		},
		{
			name:   "invalid JSON response",
			limit:  10,
			offset: 0,
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(200, `{invalid json`), nil
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &Client{
				baseURL:  "https://api.pagerduty.com",
				apiToken: "test-token",
				httpClient: &mockHTTPClient{
					doFunc: tt.mockFunc,
				},
			}

			got, err := client.GetSchedules(tt.limit, tt.offset)

			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.want, got)
			}
		})
	}
}

func TestClient_GetOnCalls(t *testing.T) {
	tests := []struct {
		name     string
		params   url.Values
		mockFunc func(req *http.Request) (*http.Response, error)
		want     *OnCallsResponse
		wantErr  bool
	}{
		{
			name: "successful response with parameters",
			params: url.Values{
				"schedule_ids[]": []string{"SCHED1", "SCHED2"},
				"since":          []string{"2024-01-01T00:00:00Z"},
				"until":          []string{"2024-01-02T00:00:00Z"},
			},
			mockFunc: func(req *http.Request) (*http.Response, error) {
				// Verify query parameters
				query := req.URL.Query()
				assert.Equal(t, []string{"SCHED1", "SCHED2"}, query["schedule_ids[]"])
				assert.Equal(t, "2024-01-01T00:00:00Z", query.Get("since"))
				assert.Equal(t, "2024-01-02T00:00:00Z", query.Get("until"))

				return newMockResponse(200, `{
					"oncalls": [
						{
							"user": {
								"id": "USER1",
								"name": "John Doe",
								"email": "john@example.com"
							},
							"schedule": {
								"id": "SCHED1",
								"name": "Primary On-Call"
							},
							"escalation_level": 1,
							"start": "2024-01-01T00:00:00Z",
							"end": "2024-01-02T00:00:00Z"
						}
					]
				}`), nil
			},
			want: &OnCallsResponse{
				OnCalls: []OnCall{
					{
						User: User{
							ID:    "USER1",
							Name:  "John Doe",
							Email: "john@example.com",
						},
						Schedule: Schedule{
							ID:   "SCHED1",
							Name: "Primary On-Call",
						},
						EscalationLevel: 1,
						Start:           "2024-01-01T00:00:00Z",
						End:             "2024-01-02T00:00:00Z",
					},
				},
			},
			wantErr: false,
		},
		{
			name:   "nil parameters",
			params: nil,
			mockFunc: func(req *http.Request) (*http.Response, error) {
				// Should have empty query
				assert.Empty(t, req.URL.Query())
				return newMockResponse(200, `{"oncalls": []}`), nil
			},
			want: &OnCallsResponse{
				OnCalls: []OnCall{},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &Client{
				baseURL:  "https://api.pagerduty.com",
				apiToken: "test-token",
				httpClient: &mockHTTPClient{
					doFunc: tt.mockFunc,
				},
			}

			got, err := client.GetOnCalls(tt.params)

			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.want, got)
			}
		})
	}
}

func TestClient_GetSchedule(t *testing.T) {
	tests := []struct {
		name       string
		scheduleID string
		since      time.Time
		until      time.Time
		mockFunc   func(req *http.Request) (*http.Response, error)
		want       *ScheduleResponse
		wantErr    bool
	}{
		{
			name:       "successful response",
			scheduleID: "SCHED1",
			since:      time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
			until:      time.Date(2024, 1, 2, 0, 0, 0, 0, time.UTC),
			mockFunc: func(req *http.Request) (*http.Response, error) {
				// Verify path and parameters
				assert.Contains(t, req.URL.Path, "SCHED1")
				assert.Equal(t, "2024-01-01T00:00:00Z", req.URL.Query().Get("since"))
				assert.Equal(t, "2024-01-02T00:00:00Z", req.URL.Query().Get("until"))

				return newMockResponse(200, `{
					"schedule": {
						"id": "SCHED1",
						"name": "Primary On-Call",
						"time_zone": "America/New_York",
						"final_schedule": {
							"rendered_schedule_entries": [
								{
									"start": "2024-01-01T00:00:00Z",
									"end": "2024-01-02T00:00:00Z",
									"user": {
										"id": "USER1",
										"name": "John Doe"
									}
								}
							]
						}
					}
				}`), nil
			},
			want: &ScheduleResponse{
				Schedule: ScheduleDetail{
					ID:       "SCHED1",
					Name:     "Primary On-Call",
					TimeZone: "America/New_York",
					FinalSchedule: &FinalSchedule{
						RenderedScheduleEntries: []RenderedScheduleEntry{
							{
								Start: "2024-01-01T00:00:00Z",
								End:   "2024-01-02T00:00:00Z",
								User: User{
									ID:   "USER1",
									Name: "John Doe",
								},
							},
						},
					},
				},
			},
			wantErr: false,
		},
		{
			name:       "not found",
			scheduleID: "INVALID",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(404, `{"error": {"message": "Schedule not found"}}`), nil
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &Client{
				baseURL:  "https://api.pagerduty.com",
				apiToken: "test-token",
				httpClient: &mockHTTPClient{
					doFunc: tt.mockFunc,
				},
			}

			got, err := client.GetSchedule(tt.scheduleID, tt.since, tt.until)

			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.want, got)
			}
		})
	}
}

func TestClient_GetCurrentOnCalls(t *testing.T) {
	client := &Client{
		baseURL:  "https://api.pagerduty.com",
		apiToken: "test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				// Verify the convenience method sets correct parameters
				query := req.URL.Query()
				assert.Equal(t, "UTC", query.Get("time_zone"))
				assert.Equal(t, []string{"users", "schedules"}, query["include[]"])
				assert.Equal(t, "true", query.Get("earliest"))

				return newMockResponse(200, `{
					"oncalls": [{
						"user": {"id": "USER1", "name": "John Doe"},
						"schedule": {"id": "SCHED1", "name": "Primary"},
						"escalation_level": 1,
						"start": "2024-01-01T00:00:00Z",
						"end": "2024-01-02T00:00:00Z"
					}]
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
		baseURL:  "https://api.pagerduty.com",
		apiToken: "test-token",
		httpClient: &mockHTTPClient{
			doFunc: func(req *http.Request) (*http.Response, error) {
				// Verify the convenience method sets correct parameters
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
	tests := []struct {
		name     string
		statuses []string
		userIDs  []string
		mockFunc func(req *http.Request) (*http.Response, error)
		wantErr  bool
		wantLen  int
	}{
		{
			name:     "successful retrieval with status filters",
			statuses: []string{"triggered", "acknowledged"},
			mockFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "GET", req.Method)
				assert.Contains(t, req.URL.Path, "/incidents")
				query := req.URL.Query()
				assert.Equal(t, []string{"triggered", "acknowledged"}, query["statuses[]"])
				assert.Equal(t, "created_at:desc", query.Get("sort_by"))
				assert.Equal(t, "100", query.Get("limit"))
				assert.Empty(t, query["user_ids[]"])
				return newMockResponse(200, `{"incidents": [{"id": "INC1", "title": "Test", "status": "triggered"}], "limit": 100, "offset": 0, "more": false, "total": 1}`), nil
			},
			wantErr: false,
			wantLen: 1,
		},
		{
			name:     "with user ID filters",
			statuses: []string{"triggered"},
			userIDs:  []string{"USER1", "USER2"},
			mockFunc: func(req *http.Request) (*http.Response, error) {
				query := req.URL.Query()
				assert.Equal(t, []string{"USER1", "USER2"}, query["user_ids[]"])
				assert.Equal(t, []string{"triggered"}, query["statuses[]"])
				return newMockResponse(200, `{"incidents": [{"id": "INC1", "title": "Test", "status": "triggered"}], "limit": 100, "offset": 0, "more": false, "total": 1}`), nil
			},
			wantErr: false,
			wantLen: 1,
		},
		{
			name:     "API error",
			statuses: []string{"triggered"},
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(401, `{"error": {"message": "Unauthorized", "code": 2001}}`), nil
			},
			wantErr: true,
		},
		{
			name:     "invalid JSON response",
			statuses: []string{"triggered"},
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(200, `invalid json`), nil
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &Client{
				baseURL:    "https://api.pagerduty.com",
				apiToken:   "test-token",
				httpClient: &mockHTTPClient{doFunc: tt.mockFunc},
			}

			response, err := client.GetIncidents(tt.statuses, tt.userIDs, 100, 0)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Len(t, response.Incidents, tt.wantLen)
		})
	}
}

func TestClient_UpdateIncident(t *testing.T) {
	tests := []struct {
		name     string
		id       string
		status   string
		email    string
		mockFunc func(req *http.Request) (*http.Response, error)
		wantErr  bool
	}{
		{
			name:   "successful acknowledge",
			id:     "INC1",
			status: "acknowledged",
			email:  "user@example.com",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "PUT", req.Method)
				assert.Contains(t, req.URL.Path, "/incidents/INC1")
				assert.Equal(t, "user@example.com", req.Header.Get("From"))

				// Verify body
				body, _ := io.ReadAll(req.Body)
				assert.Contains(t, string(body), `"status":"acknowledged"`)
				assert.Contains(t, string(body), `"type":"incident_reference"`)

				return newMockResponse(200, `{"incident": {"id": "INC1", "status": "acknowledged"}}`), nil
			},
			wantErr: false,
		},
		{
			name:   "successful resolve",
			id:     "INC2",
			status: "resolved",
			email:  "admin@example.com",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "PUT", req.Method)
				assert.Contains(t, req.URL.Path, "/incidents/INC2")
				assert.Equal(t, "admin@example.com", req.Header.Get("From"))
				return newMockResponse(200, `{"incident": {"id": "INC2", "status": "resolved"}}`), nil
			},
			wantErr: false,
		},
		{
			name:   "API error",
			id:     "INC1",
			status: "acknowledged",
			email:  "user@example.com",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(400, `{"error": {"message": "Invalid status", "code": 2001}}`), nil
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &Client{
				baseURL:    "https://api.pagerduty.com",
				apiToken:   "test-token",
				httpClient: &mockHTTPClient{doFunc: tt.mockFunc},
			}

			response, err := client.UpdateIncident(tt.id, tt.status, tt.email)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.id, response.Incident.ID)
			assert.Equal(t, tt.status, response.Incident.Status)
		})
	}
}

func TestClient_GetIncidentNotes(t *testing.T) {
	tests := []struct {
		name     string
		id       string
		mockFunc func(req *http.Request) (*http.Response, error)
		wantErr  bool
		wantLen  int
	}{
		{
			name: "successful retrieval",
			id:   "INC1",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "GET", req.Method)
				assert.Contains(t, req.URL.Path, "/incidents/INC1/notes")
				return newMockResponse(200, `{"notes": [{"id": "N1", "content": "test note", "created_at": "2024-01-01T00:00:00Z", "user": {"id": "U1", "type": "user_reference", "summary": "Test User"}}]}`), nil
			},
			wantErr: false,
			wantLen: 1,
		},
		{
			name: "empty notes",
			id:   "INC2",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(200, `{"notes": []}`), nil
			},
			wantErr: false,
			wantLen: 0,
		},
		{
			name: "API error",
			id:   "INC1",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(404, `{"error": {"message": "Not Found", "code": 2100}}`), nil
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &Client{
				baseURL:    "https://api.pagerduty.com",
				apiToken:   "test-token",
				httpClient: &mockHTTPClient{doFunc: tt.mockFunc},
			}

			response, err := client.GetIncidentNotes(tt.id)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Len(t, response.Notes, tt.wantLen)
		})
	}
}

func TestClient_CreateIncidentNote(t *testing.T) {
	tests := []struct {
		name     string
		id       string
		content  string
		email    string
		mockFunc func(req *http.Request) (*http.Response, error)
		wantErr  bool
	}{
		{
			name:    "successful note creation",
			id:      "INC1",
			content: "This is a note",
			email:   "user@example.com",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, "POST", req.Method)
				assert.Contains(t, req.URL.Path, "/incidents/INC1/notes")
				assert.Equal(t, "user@example.com", req.Header.Get("From"))

				body, _ := io.ReadAll(req.Body)
				assert.Contains(t, string(body), `"content":"This is a note"`)

				return newMockResponse(201, `{"note": {"id": "N1", "content": "This is a note", "created_at": "2024-01-01T00:00:00Z", "user": {"id": "U1", "type": "user_reference", "summary": "Test User"}}}`), nil
			},
			wantErr: false,
		},
		{
			name:    "API error",
			id:      "INC1",
			content: "note",
			email:   "user@example.com",
			mockFunc: func(req *http.Request) (*http.Response, error) {
				return newMockResponse(400, `{"error": {"message": "Bad request", "code": 2001}}`), nil
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &Client{
				baseURL:    "https://api.pagerduty.com",
				apiToken:   "test-token",
				httpClient: &mockHTTPClient{doFunc: tt.mockFunc},
			}

			response, err := client.CreateIncidentNote(tt.id, tt.content, tt.email)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.content, response.Note.Content)
			assert.NotEmpty(t, response.Note.ID)
		})
	}
}

// Test the actual HTTP client interface
func TestClient_HTTPClientInterface(t *testing.T) {
	// Ensure our mock implements the same interface as http.Client
	var _ HTTPClient = &http.Client{}
	var _ HTTPClient = &mockHTTPClient{}
}
