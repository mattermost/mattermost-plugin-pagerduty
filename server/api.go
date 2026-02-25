package main

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// ServeHTTP handles HTTP requests to the plugin.
func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	router := mux.NewRouter()

	// Middleware to require that the user is logged in
	router.Use(p.MattermostAuthorizationRequired)

	apiRouter := router.PathPrefix("/api/v1").Subrouter()

	// OAuth endpoints
	apiRouter.HandleFunc("/oauth/connect", p.handleOAuthConnect).Methods(http.MethodGet)
	apiRouter.HandleFunc("/oauth/callback", p.handleOAuthCallback).Methods(http.MethodGet)
	apiRouter.HandleFunc("/oauth/disconnect", p.handleOAuthDisconnect).Methods(http.MethodPost)
	apiRouter.HandleFunc("/oauth/status", p.handleOAuthConnectionStatus).Methods(http.MethodGet)

	// PagerDuty endpoints
	apiRouter.HandleFunc("/schedules", p.handleGetSchedules).Methods(http.MethodGet)
	apiRouter.HandleFunc("/oncalls", p.handleGetOnCalls).Methods(http.MethodGet)
	apiRouter.HandleFunc("/schedule", p.handleGetScheduleDetails).Methods(http.MethodGet)
	apiRouter.HandleFunc("/services", p.handleGetServices).Methods(http.MethodGet)
	apiRouter.HandleFunc("/incidents", p.handleGetIncidents).Methods(http.MethodGet)
	apiRouter.HandleFunc("/incidents", p.handleCreateIncident).Methods(http.MethodPost)
	apiRouter.HandleFunc("/incidents/{id}", p.handleUpdateIncident).Methods(http.MethodPut)
	apiRouter.HandleFunc("/incidents/{id}/notes", p.handleGetIncidentNotes).Methods(http.MethodGet)
	apiRouter.HandleFunc("/incidents/{id}/notes", p.handleCreateIncidentNote).Methods(http.MethodPost)
	apiRouter.HandleFunc("/users/me", p.handleGetCurrentUser).Methods(http.MethodGet)
	apiRouter.HandleFunc("/users", p.handleGetUsers).Methods(http.MethodGet)
	apiRouter.HandleFunc("/schedules/{id}/overrides", p.handleCreateOverride).Methods(http.MethodPost)

	router.ServeHTTP(w, r)
}

func (p *Plugin) MattermostAuthorizationRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := r.Header.Get("Mattermost-User-ID")
		if userID == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

type APIError struct {
	ID         string `json:"id"`
	Message    string `json:"message"`
	StatusCode int    `json:"-"`
}

func (p *Plugin) handleError(w http.ResponseWriter, r *http.Request, err *APIError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.StatusCode)

	if encErr := json.NewEncoder(w).Encode(err); encErr != nil {
		p.client.Log.Error("Failed to encode error response", "error", encErr.Error())
	}
}
