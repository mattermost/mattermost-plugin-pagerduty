package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	stderrors "errors"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
)

// handleGetPagerDutyClient is a helper that retrieves the per-user PagerDuty client.
// It returns nil and writes an error response if the user is not connected.
func (p *Plugin) handleGetPagerDutyClient(w http.ResponseWriter, r *http.Request) *pagerduty.Client {
	userID := r.Header.Get("Mattermost-User-ID")
	pdClient, err := p.getPagerDutyClientForUser(userID)
	if err != nil {
		statusCode := http.StatusInternalServerError
		errID := "api.pagerduty.auth.error"

		if stderrors.Is(err, ErrNotConnected) {
			statusCode = http.StatusUnauthorized
			errID = "api.pagerduty.not_connected"
		} else if stderrors.Is(err, ErrTokenExpired) {
			statusCode = http.StatusUnauthorized
			errID = "api.pagerduty.token_expired"
		}

		p.client.Log.Warn("Failed to get PagerDuty client for user", "user_id", userID, "error", err.Error())
		p.handleError(w, r, &APIError{
			ID:         errID,
			Message:    err.Error(),
			StatusCode: statusCode,
		})
		return nil
	}
	return pdClient
}

func (p *Plugin) handleGetSchedules(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleGetSchedules called", "user_id", r.Header.Get("Mattermost-User-ID"))

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	schedules, err := pdClient.GetSchedules(100, 0)
	if err != nil {
		p.client.Log.Error("Failed to get schedules from PagerDuty", "error", err.Error())
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.schedules.error",
			Message:    "Failed to retrieve schedules",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully retrieved schedules", "count", len(schedules.Schedules))
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(schedules); err != nil {
		p.client.Log.Error("Failed to encode schedules response", "error", err.Error())
	}
}

func (p *Plugin) handleGetOnCalls(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleGetOnCalls called", "user_id", r.Header.Get("Mattermost-User-ID"))

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	scheduleID := r.URL.Query().Get("schedule_id")
	var oncalls *pagerduty.OnCallsResponse
	var err error

	if scheduleID != "" {
		p.client.Log.Debug("Fetching on-calls for specific schedule", "schedule_id", scheduleID)
		oncalls, err = pdClient.GetOnCallsForSchedule(scheduleID)
	} else {
		p.client.Log.Debug("Fetching current on-calls for all schedules")
		oncalls, err = pdClient.GetCurrentOnCalls()
	}

	if err != nil {
		p.client.Log.Error("Failed to get on-calls from PagerDuty", "error", err.Error(), "schedule_id", scheduleID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.oncalls.error",
			Message:    "Failed to retrieve on-call users",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully retrieved on-calls", "count", len(oncalls.OnCalls))
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(oncalls); err != nil {
		p.client.Log.Error("Failed to encode on-calls response", "error", err.Error())
	}
}

func (p *Plugin) handleGetScheduleDetails(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleGetScheduleDetails called", "user_id", r.Header.Get("Mattermost-User-ID"))

	scheduleID := r.URL.Query().Get("id")
	if scheduleID == "" {
		p.client.Log.Warn("Schedule ID missing in request")
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.schedule.id.missing",
			Message:    "Schedule ID is required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	// Get schedule with the next 48 hours of coverage
	now := time.Now()
	until := now.Add(48 * time.Hour)

	p.client.Log.Debug("Fetching schedule details", "schedule_id", scheduleID, "from", now.Format(time.RFC3339), "until", until.Format(time.RFC3339))
	schedule, err := pdClient.GetSchedule(scheduleID, now, until)
	if err != nil {
		p.client.Log.Error("Failed to get schedule details from PagerDuty", "error", err.Error(), "schedule_id", scheduleID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.schedule.error",
			Message:    "Failed to retrieve schedule details",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully retrieved schedule details", "schedule_id", scheduleID, "name", schedule.Schedule.Name)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(schedule); err != nil {
		p.client.Log.Error("Failed to encode schedule response", "error", err.Error())
	}
}

func (p *Plugin) handleGetServices(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleGetServices called", "user_id", r.Header.Get("Mattermost-User-ID"))

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	services, err := pdClient.GetServices(100, 0)
	if err != nil {
		p.client.Log.Error("Failed to get services from PagerDuty", "error", err.Error())
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.services.error",
			Message:    "Failed to retrieve services",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully retrieved services", "count", len(services.Services))
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(services); err != nil {
		p.client.Log.Error("Failed to encode services response", "error", err.Error())
	}
}

// CreateIncidentRequest represents the request body for creating an incident
type CreateIncidentRequest struct {
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	ServiceID   string   `json:"service_id"`
	Urgency     string   `json:"urgency,omitempty"`
	AssigneeIDs []string `json:"assignee_ids,omitempty"`
}

func (p *Plugin) handleCreateIncident(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleCreateIncident called", "user_id", r.Header.Get("Mattermost-User-ID"))

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB limit

	var req CreateIncidentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.client.Log.Warn("Failed to decode create incident request", "error", err)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.decode.error",
			Message:    "Invalid request body",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	if req.Title == "" || req.ServiceID == "" {
		p.client.Log.Warn("Missing required fields in create incident request", "title", req.Title, "service_id", req.ServiceID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.fields.missing",
			Message:    "Title and service_id are required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	p.client.Log.Debug("Creating incident in PagerDuty", "title", req.Title, "service_id", req.ServiceID, "assignees", len(req.AssigneeIDs))

	incident, err := pdClient.CreateIncident(req.Title, req.Description, req.ServiceID, req.Urgency, req.AssigneeIDs)
	if err != nil {
		p.client.Log.Error("Failed to create incident in PagerDuty", "error", err.Error())
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.create.error",
			Message:    "Failed to create incident",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully created incident", "incident_id", incident.Incident.ID, "title", incident.Incident.Title)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(incident); err != nil {
		p.client.Log.Error("Failed to encode create incident response", "error", err.Error())
	}
}

// getUserEmail retrieves the email address for a Mattermost user
func (p *Plugin) getUserEmail(userID string) (string, error) {
	user, err := p.client.User.Get(userID)
	if err != nil {
		return "", errors.Wrap(err, "failed to get user")
	}
	return user.Email, nil
}

func (p *Plugin) handleGetIncidents(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleGetIncidents called", "user_id", r.Header.Get("Mattermost-User-ID"))

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	statuses := []string{"triggered", "acknowledged"}

	// Parse optional user_ids filter (comma-separated)
	var userIDs []string
	if rawUserIDs := r.URL.Query().Get("user_ids"); rawUserIDs != "" {
		userIDs = strings.Split(rawUserIDs, ",")
	}

	// Parse optional schedule_id filter — resolve to on-call user IDs
	if scheduleID := r.URL.Query().Get("schedule_id"); scheduleID != "" {
		p.client.Log.Debug("Resolving schedule to on-call users for incident filter", "schedule_id", scheduleID)
		oncalls, err := pdClient.GetOnCallsForSchedule(scheduleID)
		if err != nil {
			p.client.Log.Error("Failed to resolve schedule on-calls for filtering", "error", err.Error(), "schedule_id", scheduleID)
			p.handleError(w, r, &APIError{
				ID:         "api.pagerduty.incidents.schedule.error",
				Message:    "Failed to resolve schedule for filtering",
				StatusCode: http.StatusInternalServerError,
			})
			return
		}

		scheduleUserIDs := extractUserIDsFromOnCalls(oncalls.OnCalls)
		if len(userIDs) > 0 {
			userIDs = intersectStrings(userIDs, scheduleUserIDs)
		} else {
			userIDs = scheduleUserIDs
		}

		// If no on-call users found (or intersection is empty), return empty result
		if len(userIDs) == 0 {
			empty := &pagerduty.IncidentsResponse{}
			w.Header().Set("Content-Type", "application/json")
			if encodeErr := json.NewEncoder(w).Encode(empty); encodeErr != nil {
				p.client.Log.Error("Failed to encode empty incidents response", "error", encodeErr.Error())
			}
			return
		}
	}

	incidents, err := pdClient.GetIncidents(statuses, userIDs, 100, 0)
	if err != nil {
		p.client.Log.Error("Failed to get incidents from PagerDuty", "error", err.Error())
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incidents.error",
			Message:    "Failed to retrieve incidents",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully retrieved incidents", "count", len(incidents.Incidents))
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(incidents); err != nil {
		p.client.Log.Error("Failed to encode incidents response", "error", err.Error())
	}
}

func extractUserIDsFromOnCalls(oncalls []pagerduty.OnCall) []string {
	seen := make(map[string]bool)
	var ids []string
	for _, oc := range oncalls {
		if oc.User.ID != "" && !seen[oc.User.ID] {
			seen[oc.User.ID] = true
			ids = append(ids, oc.User.ID)
		}
	}
	return ids
}

func intersectStrings(a, b []string) []string {
	set := make(map[string]bool, len(b))
	for _, v := range b {
		set[v] = true
	}
	var result []string
	for _, v := range a {
		if set[v] {
			result = append(result, v)
		}
	}
	return result
}

// UpdateIncidentAPIRequest represents the API request body for updating an incident
type UpdateIncidentAPIRequest struct {
	Status string `json:"status"`
}

func (p *Plugin) handleUpdateIncident(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	p.client.Log.Debug("handleUpdateIncident called", "user_id", userID)

	vars := mux.Vars(r)
	incidentID := vars["id"]
	if incidentID == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.id.missing",
			Message:    "Incident ID is required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB limit

	var req UpdateIncidentAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.decode.error",
			Message:    "Invalid request body",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	if req.Status == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.status.missing",
			Message:    "Status is required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	// Validate that the status is a known PagerDuty incident status.
	validStatuses := map[string]bool{"acknowledged": true, "resolved": true}
	if !validStatuses[req.Status] {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.status.invalid",
			Message:    "Status must be 'acknowledged' or 'resolved'",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	email, err := p.getUserEmail(userID)
	if err != nil {
		p.client.Log.Error("Failed to get user email", "error", err.Error(), "user_id", userID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.user.email.error",
			Message:    "Failed to get user email",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	incident, err := pdClient.UpdateIncident(incidentID, req.Status, email)
	if err != nil {
		p.client.Log.Error("Failed to update incident", "error", err.Error(), "incident_id", incidentID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.update.error",
			Message:    "Failed to update incident",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully updated incident", "incident_id", incidentID, "status", req.Status)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(incident); err != nil {
		p.client.Log.Error("Failed to encode update incident response", "error", err.Error())
	}
}

func (p *Plugin) handleGetIncidentNotes(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleGetIncidentNotes called", "user_id", r.Header.Get("Mattermost-User-ID"))

	vars := mux.Vars(r)
	incidentID := vars["id"]
	if incidentID == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.id.missing",
			Message:    "Incident ID is required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	notes, err := pdClient.GetIncidentNotes(incidentID)
	if err != nil {
		p.client.Log.Error("Failed to get incident notes", "error", err.Error(), "incident_id", incidentID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.notes.error",
			Message:    "Failed to retrieve incident notes",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully retrieved incident notes", "incident_id", incidentID, "count", len(notes.Notes))
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(notes); err != nil {
		p.client.Log.Error("Failed to encode incident notes response", "error", err.Error())
	}
}

func (p *Plugin) handleGetCurrentUser(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleGetCurrentUser called", "user_id", r.Header.Get("Mattermost-User-ID"))

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	user, err := pdClient.GetCurrentUser()
	if err != nil {
		p.client.Log.Error("Failed to get current user from PagerDuty", "error", err.Error())
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.users.me.error",
			Message:    "Failed to retrieve current user",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully retrieved current user", "pd_user_id", user.User.ID, "name", user.User.Name)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(user); err != nil {
		p.client.Log.Error("Failed to encode current user response", "error", err.Error())
	}
}

func (p *Plugin) handleGetUsers(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleGetUsers called", "user_id", r.Header.Get("Mattermost-User-ID"))

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	query := r.URL.Query().Get("query")

	users, err := pdClient.GetUsers(query, 25)
	if err != nil {
		p.client.Log.Error("Failed to get users from PagerDuty", "error", err.Error())
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.users.error",
			Message:    "Failed to retrieve users",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully retrieved users", "count", len(users.Users))
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(users); err != nil {
		p.client.Log.Error("Failed to encode users response", "error", err.Error())
	}
}

// CreateOverrideAPIRequest represents the API request body for creating a schedule override
type CreateOverrideAPIRequest struct {
	Start  string `json:"start"`
	End    string `json:"end"`
	UserID string `json:"user_id"`
}

func (p *Plugin) handleCreateOverride(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleCreateOverride called", "user_id", r.Header.Get("Mattermost-User-ID"))

	vars := mux.Vars(r)
	scheduleID := vars["id"]
	if scheduleID == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.override.schedule.missing",
			Message:    "Schedule ID is required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req CreateOverrideAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.override.decode.error",
			Message:    "Invalid request body",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	if req.Start == "" || req.End == "" || req.UserID == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.override.fields.missing",
			Message:    "Start, end, and user_id are required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	override, err := pdClient.CreateOverride(scheduleID, req.Start, req.End, req.UserID)
	if err != nil {
		p.client.Log.Error("Failed to create override", "error", err.Error(), "schedule_id", scheduleID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.override.create.error",
			Message:    "Failed to create override",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully created override", "schedule_id", scheduleID, "override_id", override.Override.ID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(override); err != nil {
		p.client.Log.Error("Failed to encode create override response", "error", err.Error())
	}
}

// CreateBulkOverrideRequest represents the request body for creating bulk overrides.
// It finds all shifts for the target user within the date range and creates overrides for each.
type CreateBulkOverrideRequest struct {
	ScheduleID   string `json:"schedule_id"`
	Start        string `json:"start"`
	End          string `json:"end"`
	TargetUserID string `json:"target_user_id"`
	CoverUserID  string `json:"cover_user_id"`
}

// BulkOverrideResult represents a single override result (success or failure).
type BulkOverrideResult struct {
	Start   string `json:"start"`
	End     string `json:"end"`
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// BulkOverrideResponse is the response from a bulk override request.
type BulkOverrideResponse struct {
	TotalShifts int                  `json:"total_shifts"`
	Created     int                  `json:"created"`
	Failed      int                  `json:"failed"`
	Results     []BulkOverrideResult `json:"results"`
}

// BulkOverridePreviewResponse is the response from a bulk override preview request.
type BulkOverridePreviewResponse struct {
	TotalShifts int                         `json:"total_shifts"`
	Shifts      []BulkOverridePreviewShift  `json:"shifts"`
}

// BulkOverridePreviewShift represents a single shift that would be overridden.
type BulkOverridePreviewShift struct {
	Start    string `json:"start"`
	End      string `json:"end"`
	UserID   string `json:"user_id"`
	UserName string `json:"user_name"`
}

// parseBulkOverrideDateRange parses and validates the start/end query params or JSON fields for bulk override endpoints.
func (p *Plugin) parseBulkOverrideDateRange(w http.ResponseWriter, r *http.Request, startStr, endStr string) (time.Time, time.Time, bool) {
	startTime, err := time.Parse(time.RFC3339, startStr)
	if err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.bulk_override.start.invalid",
			Message:    "Start must be a valid RFC3339 timestamp",
			StatusCode: http.StatusBadRequest,
		})
		return time.Time{}, time.Time{}, false
	}

	endTime, err := time.Parse(time.RFC3339, endStr)
	if err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.bulk_override.end.invalid",
			Message:    "End must be a valid RFC3339 timestamp",
			StatusCode: http.StatusBadRequest,
		})
		return time.Time{}, time.Time{}, false
	}

	if !endTime.After(startTime) {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.bulk_override.range.invalid",
			Message:    "End time must be after start time",
			StatusCode: http.StatusBadRequest,
		})
		return time.Time{}, time.Time{}, false
	}

	if endTime.Sub(startTime) > 30*24*time.Hour {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.bulk_override.range.too_long",
			Message:    "Override range cannot exceed 30 days",
			StatusCode: http.StatusBadRequest,
		})
		return time.Time{}, time.Time{}, false
	}

	return startTime, endTime, true
}

// getTargetEntries fetches the schedule and filters entries for the target user.
func (p *Plugin) getTargetEntries(w http.ResponseWriter, r *http.Request, pdClient *pagerduty.Client, scheduleID string, startTime, endTime time.Time, targetUserID string) ([]pagerduty.RenderedScheduleEntry, bool) {
	schedule, err := pdClient.GetSchedule(scheduleID, startTime, endTime)
	if err != nil {
		p.client.Log.Error("Failed to get schedule for bulk override", "error", err.Error(), "schedule_id", scheduleID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.bulk_override.schedule.error",
			Message:    "Failed to retrieve schedule for the given date range",
			StatusCode: http.StatusInternalServerError,
		})
		return nil, false
	}

	var targetEntries []pagerduty.RenderedScheduleEntry
	if schedule.Schedule.FinalSchedule != nil {
		for _, entry := range schedule.Schedule.FinalSchedule.RenderedScheduleEntries {
			if entry.User.ID == targetUserID {
				targetEntries = append(targetEntries, entry)
			}
		}
	}
	return targetEntries, true
}

func (p *Plugin) handleBulkOverridePreview(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleBulkOverridePreview called", "user_id", r.Header.Get("Mattermost-User-ID"))

	scheduleID := r.URL.Query().Get("schedule_id")
	startStr := r.URL.Query().Get("start")
	endStr := r.URL.Query().Get("end")
	targetUserID := r.URL.Query().Get("target_user_id")

	if scheduleID == "" || startStr == "" || endStr == "" || targetUserID == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.bulk_override.fields.missing",
			Message:    "schedule_id, start, end, and target_user_id query parameters are required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	startTime, endTime, ok := p.parseBulkOverrideDateRange(w, r, startStr, endStr)
	if !ok {
		return
	}

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	targetEntries, ok := p.getTargetEntries(w, r, pdClient, scheduleID, startTime, endTime, targetUserID)
	if !ok {
		return
	}

	shifts := make([]BulkOverridePreviewShift, 0, len(targetEntries))
	for _, entry := range targetEntries {
		shifts = append(shifts, BulkOverridePreviewShift{
			Start:    entry.Start,
			End:      entry.End,
			UserID:   entry.User.ID,
			UserName: entry.User.Summary,
		})
	}

	resp := BulkOverridePreviewResponse{
		TotalShifts: len(shifts),
		Shifts:      shifts,
	}

	w.Header().Set("Content-Type", "application/json")
	if encErr := json.NewEncoder(w).Encode(resp); encErr != nil {
		p.client.Log.Error("Failed to encode bulk override preview response", "error", encErr.Error())
	}
}

func (p *Plugin) handleCreateBulkOverride(w http.ResponseWriter, r *http.Request) {
	p.client.Log.Debug("handleCreateBulkOverride called", "user_id", r.Header.Get("Mattermost-User-ID"))

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req CreateBulkOverrideRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.bulk_override.decode.error",
			Message:    "Invalid request body",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	if req.ScheduleID == "" || req.Start == "" || req.End == "" || req.TargetUserID == "" || req.CoverUserID == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.bulk_override.fields.missing",
			Message:    "schedule_id, start, end, target_user_id, and cover_user_id are required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	startTime, endTime, ok := p.parseBulkOverrideDateRange(w, r, req.Start, req.End)
	if !ok {
		return
	}

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	targetEntries, ok := p.getTargetEntries(w, r, pdClient, req.ScheduleID, startTime, endTime, req.TargetUserID)
	if !ok {
		return
	}

	if len(targetEntries) == 0 {
		p.client.Log.Debug("No shifts found for target user in override range", "schedule_id", req.ScheduleID, "target_user_id", req.TargetUserID)
		resp := BulkOverrideResponse{
			TotalShifts: 0,
			Created:     0,
			Failed:      0,
			Results:     []BulkOverrideResult{},
		}
		w.Header().Set("Content-Type", "application/json")
		if encErr := json.NewEncoder(w).Encode(resp); encErr != nil {
			p.client.Log.Error("Failed to encode bulk override response", "error", encErr.Error())
		}
		return
	}

	var results []BulkOverrideResult
	created := 0
	failed := 0

	for _, entry := range targetEntries {
		_, overrideErr := pdClient.CreateOverride(req.ScheduleID, entry.Start, entry.End, req.CoverUserID)
		if overrideErr != nil {
			p.client.Log.Warn("Failed to create bulk override for shift",
				"error", overrideErr.Error(),
				"schedule_id", req.ScheduleID,
				"start", entry.Start,
				"end", entry.End,
			)
			results = append(results, BulkOverrideResult{
				Start:   entry.Start,
				End:     entry.End,
				Success: false,
				Error:   overrideErr.Error(),
			})
			failed++
		} else {
			results = append(results, BulkOverrideResult{
				Start:   entry.Start,
				End:     entry.End,
				Success: true,
			})
			created++
		}
	}

	p.client.Log.Debug("Bulk override completed",
		"schedule_id", req.ScheduleID,
		"total_shifts", len(targetEntries),
		"created", created,
		"failed", failed,
	)

	resp := BulkOverrideResponse{
		TotalShifts: len(targetEntries),
		Created:     created,
		Failed:      failed,
		Results:     results,
	}

	w.Header().Set("Content-Type", "application/json")
	statusCode := http.StatusCreated
	if failed > 0 && created == 0 {
		statusCode = http.StatusInternalServerError
	} else if failed > 0 {
		statusCode = http.StatusMultiStatus
	}
	w.WriteHeader(statusCode)
	if encErr := json.NewEncoder(w).Encode(resp); encErr != nil {
		p.client.Log.Error("Failed to encode bulk override response", "error", encErr.Error())
	}
}

// CreateIncidentNoteAPIRequest represents the API request for adding a note
type CreateIncidentNoteAPIRequest struct {
	Content string `json:"content"`
}

func (p *Plugin) handleCreateIncidentNote(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	p.client.Log.Debug("handleCreateIncidentNote called", "user_id", userID)

	vars := mux.Vars(r)
	incidentID := vars["id"]
	if incidentID == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.id.missing",
			Message:    "Incident ID is required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB limit

	var req CreateIncidentNoteAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.note.decode.error",
			Message:    "Invalid request body",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	if req.Content == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.note.content.missing",
			Message:    "Note content is required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	email, err := p.getUserEmail(userID)
	if err != nil {
		p.client.Log.Error("Failed to get user email", "error", err.Error(), "user_id", userID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.user.email.error",
			Message:    "Failed to get user email",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	pdClient := p.handleGetPagerDutyClient(w, r)
	if pdClient == nil {
		return
	}

	note, err := pdClient.CreateIncidentNote(incidentID, req.Content, email)
	if err != nil {
		p.client.Log.Error("Failed to create incident note", "error", err.Error(), "incident_id", incidentID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.note.create.error",
			Message:    "Failed to create incident note",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("Successfully created incident note", "incident_id", incidentID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(note); err != nil {
		p.client.Log.Error("Failed to encode create incident note response", "error", err.Error())
	}
}

// --- Subscription Management Handlers ---

// SubscriptionAPIRequest represents the API request body for creating a subscription.
type SubscriptionAPIRequest struct {
	ChannelID  string   `json:"channel_id"`
	EventTypes []string `json:"event_types"`
	ServiceIDs []string `json:"service_ids,omitempty"`
}

func (p *Plugin) handleGetSubscriptions(w http.ResponseWriter, r *http.Request) {
	channelID := r.URL.Query().Get("channel_id")

	if channelID != "" {
		// Get subscription for a specific channel
		sub, err := p.kvstore.GetChannelSubscription(channelID)
		if err != nil {
			p.handleError(w, r, &APIError{
				ID:         "api.pagerduty.subscriptions.error",
				Message:    "Failed to retrieve subscription",
				StatusCode: http.StatusInternalServerError,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if sub == nil {
			if err := json.NewEncoder(w).Encode(map[string]interface{}{"subscription": nil}); err != nil {
				p.client.Log.Error("Failed to encode null subscription", "error", err.Error())
			}
			return
		}
		if err := json.NewEncoder(w).Encode(map[string]interface{}{"subscription": sub}); err != nil {
			p.client.Log.Error("Failed to encode subscription response", "error", err.Error())
		}
		return
	}

	// Get all subscriptions
	index, err := p.kvstore.GetSubscriptionIndex()
	if err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.subscriptions.error",
			Message:    "Failed to retrieve subscriptions",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	var subs []*ChannelSubscription
	for _, chID := range index {
		sub, subErr := p.kvstore.GetChannelSubscription(chID)
		if subErr != nil || sub == nil {
			continue
		}
		subs = append(subs, sub)
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"subscriptions": subs}); err != nil {
		p.client.Log.Error("Failed to encode subscriptions response", "error", err.Error())
	}
}

func (p *Plugin) handleCreateSubscription(w http.ResponseWriter, r *http.Request) {
	// Require a webhook to be registered before allowing subscriptions
	reg, regErr := p.kvstore.GetWebhookRegistration()
	if regErr != nil || reg == nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.subscription.no_webhook",
			Message:    "No PagerDuty webhook is configured. An admin must run /pagerduty webhook setup first.",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	userID := r.Header.Get("Mattermost-User-ID")

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req SubscriptionAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.subscription.decode.error",
			Message:    "Invalid request body",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	if req.ChannelID == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.subscription.channel.missing",
			Message:    "Channel ID is required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	// Verify the user is a member of the target channel to prevent
	// unauthorized users from creating subscriptions on arbitrary channels.
	if _, err := p.client.Channel.GetMember(req.ChannelID, userID); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.subscription.forbidden",
			Message:    "You must be a member of the channel to manage its subscriptions",
			StatusCode: http.StatusForbidden,
		})
		return
	}

	eventTypes := req.EventTypes
	if len(eventTypes) == 0 {
		eventTypes = AllEventTypes
	}

	sub := &ChannelSubscription{
		ChannelID:  req.ChannelID,
		CreatorID:  userID,
		EventTypes: eventTypes,
		ServiceIDs: req.ServiceIDs,
		CreatedAt:  time.Now(),
	}

	if err := p.saveSubscription(sub); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.subscription.create.error",
			Message:    "Failed to create subscription",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"subscription": sub}); err != nil {
		p.client.Log.Error("Failed to encode subscription response", "error", err.Error())
	}
}

func (p *Plugin) handleDeleteSubscription(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	vars := mux.Vars(r)
	channelID := vars["channelId"]
	if channelID == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.subscription.channel.missing",
			Message:    "Channel ID is required",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	// Verify the user is a member of the target channel.
	if _, err := p.client.Channel.GetMember(channelID, userID); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.subscription.forbidden",
			Message:    "You must be a member of the channel to manage its subscriptions",
			StatusCode: http.StatusForbidden,
		})
		return
	}

	if err := p.removeSubscription(channelID); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.subscription.delete.error",
			Message:    "Failed to delete subscription",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"ok": true}); err != nil {
		p.client.Log.Error("Failed to encode delete response", "error", err.Error())
	}
}

// --- Webhook Management Handlers ---

func (p *Plugin) handleWebhookSetup(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	if !p.isUserSystemAdmin(userID) {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.webhook.forbidden",
			Message:    "Only system administrators can manage webhooks",
			StatusCode: http.StatusForbidden,
		})
		return
	}

	resp, _ := p.executeWebhookSetup(&model.CommandArgs{UserId: userID})
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"message": resp.Text}); err != nil {
		p.client.Log.Error("Failed to encode webhook setup response", "error", err.Error())
	}
}

func (p *Plugin) handleWebhookTeardown(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	if !p.isUserSystemAdmin(userID) {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.webhook.forbidden",
			Message:    "Only system administrators can manage webhooks",
			StatusCode: http.StatusForbidden,
		})
		return
	}

	resp, _ := p.executeWebhookTeardown(&model.CommandArgs{UserId: userID})
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"message": resp.Text}); err != nil {
		p.client.Log.Error("Failed to encode webhook teardown response", "error", err.Error())
	}
}

func (p *Plugin) handleWebhookStatus(w http.ResponseWriter, r *http.Request) {
	reg, err := p.kvstore.GetWebhookRegistration()

	status := map[string]interface{}{
		"active": false,
	}

	if err == nil && reg != nil {
		status["active"] = true
		status["subscription_id"] = reg.SubscriptionID
		status["created_by"] = reg.CreatedBy
		status["created_at"] = reg.CreatedAt
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(status); err != nil {
		p.client.Log.Error("Failed to encode webhook status response", "error", err.Error())
	}
}

// --- Notification Preferences Handlers ---

func (p *Plugin) handleGetNotificationPrefs(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	prefs, err := p.kvstore.GetUserNotificationPrefs(userID)
	if err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.notification_prefs.error",
			Message:    "Failed to retrieve notification preferences",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(prefs); err != nil {
		p.client.Log.Error("Failed to encode notification prefs response", "error", err.Error())
	}
}

func (p *Plugin) handleSetNotificationPrefs(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var prefs UserNotificationPrefs
	if err := json.NewDecoder(r.Body).Decode(&prefs); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.notification_prefs.decode.error",
			Message:    "Invalid request body",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	if err := p.kvstore.SetUserNotificationPrefs(userID, &prefs); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.notification_prefs.save.error",
			Message:    "Failed to save notification preferences",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(prefs); err != nil {
		p.client.Log.Error("Failed to encode notification prefs response", "error", err.Error())
	}
}
