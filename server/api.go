// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"net/http"

	"github.com/gorilla/mux"
)

// initRouter creates and configures the HTTP router for all plugin endpoints.
// Called once during OnActivate.
func (p *Plugin) initRouter() *mux.Router {
	router := mux.NewRouter()

	// Webhook endpoint — NOT protected by Mattermost auth (receives requests from PagerDuty)
	router.HandleFunc("/api/v1/webhook", p.handlePagerDutyWebhook).Methods(http.MethodPost)

	// All other routes require Mattermost auth
	authRouter := router.PathPrefix("/api/v1").Subrouter()
	authRouter.Use(p.MattermostAuthorizationRequired)

	// OAuth endpoints
	authRouter.HandleFunc("/oauth/connect", p.handleOAuthConnect).Methods(http.MethodGet)
	authRouter.HandleFunc("/oauth/callback", p.handleOAuthCallback).Methods(http.MethodGet)
	authRouter.HandleFunc("/oauth/disconnect", p.handleOAuthDisconnect).Methods(http.MethodPost)
	authRouter.HandleFunc("/oauth/status", p.handleOAuthConnectionStatus).Methods(http.MethodGet)

	// PagerDuty endpoints
	authRouter.HandleFunc("/schedules", p.handleGetSchedules).Methods(http.MethodGet)
	authRouter.HandleFunc("/oncalls", p.handleGetOnCalls).Methods(http.MethodGet)
	authRouter.HandleFunc("/schedule", p.handleGetScheduleDetails).Methods(http.MethodGet)
	authRouter.HandleFunc("/services", p.handleGetServices).Methods(http.MethodGet)
	authRouter.HandleFunc("/incidents", p.handleGetIncidents).Methods(http.MethodGet)
	authRouter.HandleFunc("/incidents", p.handleCreateIncident).Methods(http.MethodPost)
	authRouter.HandleFunc("/incidents/{id}", p.handleUpdateIncident).Methods(http.MethodPut)
	authRouter.HandleFunc("/incidents/{id}/notes", p.handleGetIncidentNotes).Methods(http.MethodGet)
	authRouter.HandleFunc("/incidents/{id}/notes", p.handleCreateIncidentNote).Methods(http.MethodPost)
	authRouter.HandleFunc("/users/me", p.handleGetCurrentUser).Methods(http.MethodGet)
	authRouter.HandleFunc("/users", p.handleGetUsers).Methods(http.MethodGet)
	authRouter.HandleFunc("/schedules/{id}/overrides", p.handleCreateOverride).Methods(http.MethodPost)
	authRouter.HandleFunc("/bulk-override/preview", p.handleBulkOverridePreview).Methods(http.MethodGet)
	authRouter.HandleFunc("/bulk-override", p.handleCreateBulkOverride).Methods(http.MethodPost)

	// Subscription management endpoints
	authRouter.HandleFunc("/subscriptions", p.handleGetSubscriptions).Methods(http.MethodGet)
	authRouter.HandleFunc("/subscriptions", p.handleCreateSubscription).Methods(http.MethodPost)
	authRouter.HandleFunc("/subscriptions/{channelId}", p.handleDeleteSubscription).Methods(http.MethodDelete)

	// Webhook management endpoints
	authRouter.HandleFunc("/webhook/setup", p.handleWebhookSetup).Methods(http.MethodPost)
	authRouter.HandleFunc("/webhook/setup", p.handleWebhookTeardown).Methods(http.MethodDelete)
	authRouter.HandleFunc("/webhook/status", p.handleWebhookStatus).Methods(http.MethodGet)

	// Notification preferences endpoints
	authRouter.HandleFunc("/notification-prefs", p.handleGetNotificationPrefs).Methods(http.MethodGet)
	authRouter.HandleFunc("/notification-prefs", p.handleSetNotificationPrefs).Methods(http.MethodPut)

	return router
}

func (p *Plugin) MattermostAuthorizationRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := r.Header.Get("Mattermost-User-ID")
		if userID == "" {
			p.handleError(w, r, &APIError{
				ID:         "not_authorized",
				Message:    "Not authorized. Please log in to Mattermost.",
				StatusCode: http.StatusUnauthorized,
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}
