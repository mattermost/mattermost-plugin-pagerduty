// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
)

const (
	accessAdminErrorID  = "api.pagerduty.access_policy.error"
	accessPolicyMaxBody = 1 << 20

	// Defaults and bounds for paged upstream queries.
	accessDefaultLimit = 50
	accessMaxLimit     = 200
)

// accessPolicyStatus is the response shape for the admin policy GET, PUT and DELETE routes.
type accessPolicyStatus struct {
	Available         bool   `json:"available"`
	UnavailableReason string `json:"unavailable_reason"`
	HasPolicy         bool   `json:"has_policy"`
	PolicyUnknown     bool   `json:"policy_unknown"`
	Expression        string `json:"expression"`
}

type accessExpressionRequest struct {
	Expression string `json:"expression"`
}

type accessTestUsersRequest struct {
	Expression string `json:"expression"`
	Term       string `json:"term"`
	After      string `json:"after"`
	Limit      int    `json:"limit"`
}

// SystemAdminRequired rejects requests from users who are not system admins.
// It must run after MattermostAuthorizationRequired.
func (p *Plugin) SystemAdminRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !p.isUserSystemAdmin(r.Header.Get("Mattermost-User-ID")) {
			p.handleError(w, r, &APIError{
				ID:         "api.pagerduty.access_policy.forbidden",
				Message:    "Only system administrators can manage the access policy.",
				StatusCode: http.StatusForbidden,
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}

// handleGetAccess reports whether the requesting user may use the plugin.
func (p *Plugin) handleGetAccess(w http.ResponseWriter, r *http.Request) {
	allowed := p.userHasAccess(r.Header.Get("Mattermost-User-ID"))
	p.writeAccessJSON(w, map[string]bool{"allowed": allowed})
}

func (p *Plugin) handleGetAccessPolicy(w http.ResponseWriter, r *http.Request) {
	status, apiErr := p.currentAccessPolicyStatus()
	if apiErr != nil {
		p.handleError(w, r, apiErr)
		return
	}
	p.writeAccessJSON(w, status)
}

func (p *Plugin) handleSaveAccessPolicy(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	req, ok := p.decodeExpressionRequest(w, r)
	if !ok {
		return
	}
	expression := strings.TrimSpace(req.Expression)
	if expression == "" {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.access_policy.empty_expression",
			Message:    "The access rule expression must not be empty. Remove the policy to allow everyone.",
			StatusCode: http.StatusBadRequest,
		})
		return
	}

	resourceID, err := p.getAccessResourceID()
	if err != nil {
		p.client.Log.Error("Failed to get access resource ID", "error", err.Error())
		p.handleError(w, r, internalAccessError("Failed to prepare the access policy."))
		return
	}

	policy := &model.AccessControlPolicy{
		ID:      resourceID,
		Name:    accessPolicyName,
		Type:    accessResourceType(),
		Active:  true,
		Version: model.AccessControlPolicyVersionV0_5,
		Rules: []model.AccessControlPolicyRule{{
			Actions:    []string{accessActionView},
			Expression: expression,
		}},
	}

	saved, appErr := p.API.SaveAccessControlPolicy(userID, policy)
	if appErr != nil {
		p.handleError(w, r, p.upstreamAccessError("Failed to save the access policy", appErr))
		return
	}

	p.invalidateAccessCache()
	p.publishAccessPolicyChanged()

	// Build the response from the mutation result: the save succeeded, so a follow-up read
	// must not be able to turn it into a failure.
	status := &accessPolicyStatus{HasPolicy: true, Expression: expression}
	if saved != nil && len(saved.Rules) > 0 && saved.Rules[0].Expression != "" {
		status.Expression = saved.Rules[0].Expression
	}
	status.Available, status.UnavailableReason = p.accessControlAvailability()
	p.writeAccessJSON(w, status)
}

func (p *Plugin) handleDeleteAccessPolicy(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	resourceID, err := p.getAccessResourceID()
	if err != nil {
		p.client.Log.Error("Failed to get access resource ID", "error", err.Error())
		p.handleError(w, r, internalAccessError("Failed to prepare the access policy."))
		return
	}

	if appErr := p.API.DeleteAccessControlPolicy(userID, accessResourceType(), resourceID); appErr != nil && !isAccessPolicyAbsent(appErr) {
		if appErr.StatusCode == http.StatusNotImplemented {
			// The engine is not registered, so nothing was removed: do not claim success.
			p.client.Log.Warn("Failed to delete the access policy: access control engine unavailable", "error", appErr.Error())
			p.handleError(w, r, &APIError{
				ID:         accessAdminErrorID,
				Message:    "The access rule could not be removed because attribute-based access control is not available on this server. The stored rule is still in place.",
				StatusCode: http.StatusNotImplemented,
			})
			return
		}
		p.handleError(w, r, p.upstreamAccessError("Failed to delete the access policy", appErr))
		return
	}

	p.invalidateAccessCache()
	p.publishAccessPolicyChanged()

	// The delete succeeded (or the policy was already absent), so report no policy directly.
	status := &accessPolicyStatus{}
	status.Available, status.UnavailableReason = p.accessControlAvailability()
	p.writeAccessJSON(w, status)
}

func (p *Plugin) handleCheckAccessExpression(w http.ResponseWriter, r *http.Request) {
	req, ok := p.decodeExpressionRequest(w, r)
	if !ok {
		return
	}

	errs, appErr := p.API.CheckAccessControlExpression(r.Header.Get("Mattermost-User-ID"), accessResourceType(), req.Expression)
	if appErr != nil {
		p.handleError(w, r, p.upstreamAccessError("Failed to check the expression", appErr))
		return
	}
	if errs == nil {
		errs = []model.CELExpressionError{}
	}
	p.writeAccessJSON(w, map[string]any{"errors": errs})
}

func (p *Plugin) handleAccessVisualAST(w http.ResponseWriter, r *http.Request) {
	req, ok := p.decodeExpressionRequest(w, r)
	if !ok {
		return
	}

	ast, appErr := p.API.GetAccessControlVisualAST(r.Header.Get("Mattermost-User-ID"), accessResourceType(), req.Expression)
	if appErr != nil {
		p.handleError(w, r, p.upstreamAccessError("Failed to parse the expression", appErr))
		return
	}
	p.writeAccessJSON(w, ast)
}

func (p *Plugin) handleAccessFields(w http.ResponseWriter, r *http.Request) {
	after := r.URL.Query().Get("after")
	limit := accessDefaultLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			p.handleError(w, r, &APIError{
				ID:         accessAdminErrorID,
				Message:    "Invalid limit.",
				StatusCode: http.StatusBadRequest,
			})
			return
		}
		limit = min(parsed, accessMaxLimit)
	}

	fields, appErr := p.API.GetAccessControlFieldsAutocomplete(r.Header.Get("Mattermost-User-ID"), after, limit)
	if appErr != nil {
		p.handleError(w, r, p.upstreamAccessError("Failed to load attribute fields", appErr))
		return
	}
	if fields == nil {
		fields = []*model.PropertyField{}
	}
	p.writeAccessJSON(w, fields)
}

func (p *Plugin) handleAccessTestUsers(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, accessPolicyMaxBody)

	var req accessTestUsersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.handleError(w, r, invalidAccessBodyError())
		return
	}
	limit := req.Limit
	if limit < 1 {
		limit = accessDefaultLimit
	}
	limit = min(limit, accessMaxLimit)

	resp, appErr := p.API.QueryUsersForAccessControlExpression(
		r.Header.Get("Mattermost-User-ID"), accessResourceType(), req.Expression, req.Term, req.After, limit)
	if appErr != nil {
		p.handleError(w, r, p.upstreamAccessError("Failed to test the expression", appErr))
		return
	}
	if resp == nil {
		resp = &model.AccessControlPolicyTestResponse{Users: []*model.User{}}
	}
	p.writeAccessJSON(w, resp)
}

// currentAccessPolicyStatus reads availability and the stored rule.
func (p *Plugin) currentAccessPolicyStatus() (*accessPolicyStatus, *APIError) {
	status := &accessPolicyStatus{}
	status.Available, status.UnavailableReason = p.accessControlAvailability()

	resourceID, err := p.getAccessResourceID()
	if err != nil {
		p.client.Log.Error("Failed to get access resource ID", "error", err.Error())
		return nil, internalAccessError("Failed to read the access policy.")
	}

	policy, appErr := p.API.GetAccessControlPolicy(resourceID)
	if appErr != nil {
		switch appErr.StatusCode {
		case http.StatusNotFound:
			return status, nil
		case http.StatusNotImplemented:
			// The engine is not registered: a stored rule may exist but cannot be read.
			status.PolicyUnknown = true
			return status, nil
		}
		return nil, p.upstreamAccessError("Failed to read the access policy", appErr)
	}
	if policy != nil && len(policy.Rules) > 0 {
		status.HasPolicy = true
		status.Expression = policy.Rules[0].Expression
	}
	return status, nil
}

// accessControlAvailability reports whether the server can store and evaluate ABAC policies,
// and a human-readable reason when it cannot.
func (p *Plugin) accessControlAvailability() (bool, string) {
	if !model.MinimumEnterpriseAdvancedLicense(p.API.GetLicense()) {
		return false, "Attribute-based access control requires a Mattermost Enterprise Advanced or Entry license."
	}
	cfg := p.API.GetConfig()
	if cfg == nil || cfg.AccessControlSettings.EnableAttributeBasedAccessControl == nil || !*cfg.AccessControlSettings.EnableAttributeBasedAccessControl {
		return false, "Attribute-based access control is not enabled. A system admin must turn on the AccessControlSettings.EnableAttributeBasedAccessControl server setting."
	}
	return true, ""
}

// isAccessPolicyAbsent reports whether an upstream error means no policy exists (not found).
// A 501 (engine not registered) is deliberately not "absent": a stored rule may still exist.
func isAccessPolicyAbsent(appErr *model.AppError) bool {
	return appErr.StatusCode == http.StatusNotFound
}

// upstreamAccessError converts an upstream AppError, preserving its status code and message.
func (p *Plugin) upstreamAccessError(context string, appErr *model.AppError) *APIError {
	status := appErr.StatusCode
	if status < 400 || status > 599 {
		status = http.StatusInternalServerError
	}
	p.client.Log.Warn(context, "error", appErr.Error(), "status", status)

	message := appErr.Message
	if message == "" {
		message = context
	}
	return &APIError{ID: accessAdminErrorID, Message: message, StatusCode: status}
}

func internalAccessError(message string) *APIError {
	return &APIError{ID: accessAdminErrorID, Message: message, StatusCode: http.StatusInternalServerError}
}

func invalidAccessBodyError() *APIError {
	return &APIError{
		ID:         accessAdminErrorID,
		Message:    "Invalid request body.",
		StatusCode: http.StatusBadRequest,
	}
}

func (p *Plugin) decodeExpressionRequest(w http.ResponseWriter, r *http.Request) (*accessExpressionRequest, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, accessPolicyMaxBody)

	var req accessExpressionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.handleError(w, r, invalidAccessBodyError())
		return nil, false
	}
	return &req, true
}

// publishAccessPolicyChanged tells all connected clients to re-check their access.
func (p *Plugin) publishAccessPolicyChanged() {
	p.client.Frontend.PublishWebSocketEvent(wsEventAccessPolicyChanged, map[string]any{}, &model.WebsocketBroadcast{})
}

func (p *Plugin) writeAccessJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		p.client.Log.Error("Failed to encode access control response", "error", err.Error())
	}
}
