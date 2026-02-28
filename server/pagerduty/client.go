package pagerduty

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/pkg/errors"
)

const (
	defaultBaseURL = "https://api.pagerduty.com"
	apiVersion     = "2"
)

// HTTPClient interface for mocking in tests
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

type Client struct {
	baseURL    string
	authHeader string
	httpClient HTTPClient
}

// NewOAuthClient creates a PagerDuty client using an OAuth Bearer token.
func NewOAuthClient(accessToken, baseURL string) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	return &Client{
		baseURL:    baseURL,
		authHeader: "Bearer " + accessToken,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// NewClient creates a PagerDuty client using a legacy API token.
// Deprecated: Use NewOAuthClient for OAuth Bearer token authentication.
func NewClient(apiToken, baseURL string) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	return &Client{
		baseURL:    baseURL,
		authHeader: "Token token=" + apiToken,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) doRequest(method, path string, params url.Values) ([]byte, error) {
	return c.doRequestWithBody(method, path, params, nil)
}

func (c *Client) doRequestWithBody(method, path string, params url.Values, body interface{}) ([]byte, error) {
	return c.doRequestWithBodyAndHeaders(method, path, params, body, nil)
}

func (c *Client) doRequestWithBodyAndHeaders(method, path string, params url.Values, body interface{}, extraHeaders map[string]string) ([]byte, error) {
	u, err := url.Parse(c.baseURL + path)
	if err != nil {
		return nil, errors.Wrap(err, "failed to parse URL")
	}

	if params != nil {
		u.RawQuery = params.Encode()
	}

	var requestBody io.Reader
	if body != nil {
		jsonBody, marshalErr := json.Marshal(body)
		if marshalErr != nil {
			return nil, errors.Wrap(marshalErr, "failed to marshal request body")
		}
		requestBody = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequest(method, u.String(), requestBody)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create request")
	}

	req.Header.Set("Authorization", c.authHeader)
	req.Header.Set("Accept", "application/vnd.pagerduty+json;version="+apiVersion)
	req.Header.Set("Content-Type", "application/json")

	for key, value := range extraHeaders {
		req.Header.Set(key, value)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, errors.Wrap(err, "failed to execute request")
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read response body")
	}

	if resp.StatusCode >= 400 {
		var errorResp ErrorResponse
		if err := json.Unmarshal(responseBody, &errorResp); err == nil && errorResp.Error.Message != "" {
			return nil, fmt.Errorf("PagerDuty API error: %s (code: %d)", errorResp.Error.Message, errorResp.Error.Code)
		}
		return nil, fmt.Errorf("PagerDuty API error: HTTP %d - %s", resp.StatusCode, string(responseBody))
	}

	return responseBody, nil
}

func (c *Client) GetSchedules(limit, offset int) (*SchedulesResponse, error) {
	params := url.Values{}
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))

	body, err := c.doRequest("GET", "/schedules", params)
	if err != nil {
		return nil, err
	}

	var response SchedulesResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal schedules response")
	}

	return &response, nil
}

func (c *Client) GetSchedule(scheduleID string, since, until time.Time) (*ScheduleResponse, error) {
	params := url.Values{}
	params.Set("since", since.Format(time.RFC3339))
	params.Set("until", until.Format(time.RFC3339))

	body, err := c.doRequest("GET", fmt.Sprintf("/schedules/%s", scheduleID), params)
	if err != nil {
		return nil, err
	}

	var response ScheduleResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal schedule response")
	}

	return &response, nil
}

func (c *Client) GetOnCalls(params url.Values) (*OnCallsResponse, error) {
	if params == nil {
		params = url.Values{}
	}

	body, err := c.doRequest("GET", "/oncalls", params)
	if err != nil {
		return nil, err
	}

	var response OnCallsResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal oncalls response")
	}

	return &response, nil
}

func (c *Client) GetCurrentOnCalls() (*OnCallsResponse, error) {
	params := url.Values{}
	params.Set("time_zone", "UTC")
	params.Add("include[]", "users")
	params.Add("include[]", "schedules")
	params.Set("earliest", "true")

	return c.GetOnCalls(params)
}

func (c *Client) GetOnCallsForSchedule(scheduleID string) (*OnCallsResponse, error) {
	params := url.Values{}
	params.Set("schedule_ids[]", scheduleID)
	params.Set("include[]", "users")
	params.Set("earliest", "true")

	return c.GetOnCalls(params)
}

// GetServices retrieves a list of services from PagerDuty
func (c *Client) GetServices(limit, offset int) (*ServicesResponse, error) {
	params := url.Values{}
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))

	body, err := c.doRequest("GET", "/services", params)
	if err != nil {
		return nil, err
	}

	var response ServicesResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal services response")
	}

	return &response, nil
}

// CreateIncident creates a new incident in PagerDuty
func (c *Client) CreateIncident(title, description, serviceID, urgency string, assigneeIDs []string) (*CreateIncidentResponse, error) {
	incident := Incident{
		Type:        "incident",
		Title:       title,
		Description: description,
		Service: ServiceReference{
			ID:   serviceID,
			Type: "service_reference",
		},
	}

	// Set urgency if provided (defaults to "high" in PagerDuty)
	if urgency != "" {
		incident.Urgency = urgency
	}

	// Add assignments if provided
	if len(assigneeIDs) > 0 {
		assignments := make([]Assignment, len(assigneeIDs))
		for i, assigneeID := range assigneeIDs {
			assignments[i] = Assignment{
				Assignee: AssigneeReference{
					ID:   assigneeID,
					Type: "user_reference",
				},
			}
		}
		incident.Assignments = assignments
	}

	request := CreateIncidentRequest{
		Incident: incident,
	}

	body, err := c.doRequestWithBody("POST", "/incidents", nil, request)
	if err != nil {
		return nil, err
	}

	var response CreateIncidentResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal create incident response")
	}

	return &response, nil
}

// GetIncidents retrieves incidents from PagerDuty filtered by statuses and optionally by user IDs
func (c *Client) GetIncidents(statuses, userIDs []string, limit, offset int) (*IncidentsResponse, error) {
	params := url.Values{}
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))
	params.Set("sort_by", "created_at:desc")
	for _, status := range statuses {
		params.Add("statuses[]", status)
	}
	for _, uid := range userIDs {
		params.Add("user_ids[]", uid)
	}

	body, err := c.doRequest("GET", "/incidents", params)
	if err != nil {
		return nil, err
	}

	var response IncidentsResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal incidents response")
	}

	return &response, nil
}

// UpdateIncident updates an incident's status (acknowledge, resolve)
func (c *Client) UpdateIncident(incidentID, status, fromEmail string) (*IncidentResponse, error) {
	request := UpdateIncidentRequest{
		Incident: UpdateIncidentBody{
			Type:   "incident_reference",
			Status: status,
		},
	}

	headers := map[string]string{
		"From": fromEmail,
	}

	body, err := c.doRequestWithBodyAndHeaders("PUT", fmt.Sprintf("/incidents/%s", incidentID), nil, request, headers)
	if err != nil {
		return nil, err
	}

	var response IncidentResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal update incident response")
	}

	return &response, nil
}

// GetIncidentNotes retrieves notes for a specific incident
func (c *Client) GetIncidentNotes(incidentID string) (*IncidentNotesResponse, error) {
	body, err := c.doRequest("GET", fmt.Sprintf("/incidents/%s/notes", incidentID), nil)
	if err != nil {
		return nil, err
	}

	var response IncidentNotesResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal incident notes response")
	}

	return &response, nil
}

// GetCurrentUser retrieves the currently authenticated PagerDuty user
func (c *Client) GetCurrentUser() (*UserResponse, error) {
	body, err := c.doRequest("GET", "/users/me", nil)
	if err != nil {
		return nil, err
	}

	var response UserResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal current user response")
	}

	return &response, nil
}

// GetOnCallsForUser retrieves on-call entries for a specific user
func (c *Client) GetOnCallsForUser(userID string) (*OnCallsResponse, error) {
	params := url.Values{}
	params.Set("user_ids[]", userID)
	params.Set("time_zone", "UTC")
	params.Add("include[]", "users")
	params.Add("include[]", "schedules")
	params.Set("earliest", "true")

	return c.GetOnCalls(params)
}

// GetUsers searches for PagerDuty users by query string
func (c *Client) GetUsers(query string, limit int) (*UsersResponse, error) {
	params := url.Values{}
	if query != "" {
		params.Set("query", query)
	}
	params.Set("limit", fmt.Sprintf("%d", limit))

	body, err := c.doRequest("GET", "/users", params)
	if err != nil {
		return nil, err
	}

	var response UsersResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal users response")
	}

	return &response, nil
}

// CreateOverride creates an override on a PagerDuty schedule
func (c *Client) CreateOverride(scheduleID, start, end, userID string) (*OverrideResponse, error) {
	request := CreateOverrideRequest{
		Override: Override{
			Start: start,
			End:   end,
			User: UserReference{
				ID:   userID,
				Type: "user_reference",
			},
		},
	}

	body, err := c.doRequestWithBody("POST", fmt.Sprintf("/schedules/%s/overrides", scheduleID), nil, request)
	if err != nil {
		return nil, err
	}

	var response OverrideResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal create override response")
	}

	return &response, nil
}

// CreateIncidentNote creates a note on an incident
func (c *Client) CreateIncidentNote(incidentID, content, fromEmail string) (*CreateIncidentNoteResponse, error) {
	request := CreateIncidentNoteRequest{
		Note: CreateIncidentNoteBody{
			Content: content,
		},
	}

	headers := map[string]string{
		"From": fromEmail,
	}

	body, err := c.doRequestWithBodyAndHeaders("POST", fmt.Sprintf("/incidents/%s/notes", incidentID), nil, request, headers)
	if err != nil {
		return nil, err
	}

	var response CreateIncidentNoteResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal create incident note response")
	}

	return &response, nil
}

// --- Webhook Subscription Management ---

// CreateWebhookSubscription creates a V3 webhook subscription in PagerDuty.
func (c *Client) CreateWebhookSubscription(webhookURL, secret, description string, events []string, filterType, filterID string) (*WebhookSubscriptionResult, error) {
	filter := WebhookFilter{
		Type: filterType,
	}
	if filterID != "" {
		filter.ID = filterID
	}

	request := WebhookSubscriptionRequest{
		WebhookSubscription: WebhookSubscriptionBody{
			Type: "webhook_subscription",
			DeliveryMethod: WebhookDeliveryMethod{
				Type:   "http_delivery_method",
				URL:    webhookURL,
				Secret: secret,
			},
			Events:      events,
			Filter:      filter,
			Description: description,
		},
	}

	body, err := c.doRequestWithBody("POST", "/webhook_subscriptions", nil, request)
	if err != nil {
		return nil, err
	}

	var response WebhookSubscriptionResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal webhook subscription response")
	}

	return &response.WebhookSubscription, nil
}

// DeleteWebhookSubscription removes a webhook subscription from PagerDuty.
func (c *Client) DeleteWebhookSubscription(subscriptionID string) error {
	_, err := c.doRequest("DELETE", fmt.Sprintf("/webhook_subscriptions/%s", subscriptionID), nil)
	return err
}

// ListWebhookSubscriptions retrieves all webhook subscriptions.
func (c *Client) ListWebhookSubscriptions() ([]WebhookSubscriptionResult, error) {
	body, err := c.doRequest("GET", "/webhook_subscriptions", nil)
	if err != nil {
		return nil, err
	}

	var response WebhookSubscriptionsListResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal webhook subscriptions response")
	}

	return response.WebhookSubscriptions, nil
}
