package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	stderrors "errors"

	"github.com/gorilla/mux"
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

	p.client.Log.Info("Successfully retrieved schedules", "count", len(schedules.Schedules))
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

	p.client.Log.Info("Successfully retrieved on-calls", "count", len(oncalls.OnCalls))
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

	p.client.Log.Info("Successfully retrieved schedule details", "schedule_id", scheduleID, "name", schedule.Schedule.Name)
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

	p.client.Log.Info("Successfully retrieved services", "count", len(services.Services))
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

	incident, err := pdClient.CreateIncident(req.Title, req.Description, req.ServiceID, req.AssigneeIDs)
	if err != nil {
		p.client.Log.Error("Failed to create incident in PagerDuty", "error", err.Error())
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.incident.create.error",
			Message:    "Failed to create incident",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Info("Successfully created incident", "incident_id", incident.Incident.ID, "title", incident.Incident.Title)
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

	p.client.Log.Info("Successfully retrieved incidents", "count", len(incidents.Incidents))
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

	p.client.Log.Info("Successfully updated incident", "incident_id", incidentID, "status", req.Status)
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

	p.client.Log.Info("Successfully retrieved incident notes", "incident_id", incidentID, "count", len(notes.Notes))
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(notes); err != nil {
		p.client.Log.Error("Failed to encode incident notes response", "error", err.Error())
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

	p.client.Log.Info("Successfully created incident note", "incident_id", incidentID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(note); err != nil {
		p.client.Log.Error("Failed to encode create incident note response", "error", err.Error())
	}
}
