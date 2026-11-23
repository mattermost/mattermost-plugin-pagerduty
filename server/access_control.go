// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"
)

const (
	// accessResourceTypeSuffix is the plugin-local resource type segment.
	accessResourceTypeSuffix = "plugin"

	// accessActionView is the ABAC action evaluated for every plugin request.
	accessActionView = "view"

	// accessPolicyName is the display name of the plugin's access policy.
	accessPolicyName = "PagerDuty plugin access"

	// wsEventAccessPolicyChanged is published to all users when the policy is saved or removed.
	wsEventAccessPolicyChanged = "access_policy_changed"
)

// accessResourceType returns the ABAC resource type, "<pluginID>:<type>".
func accessResourceType() string {
	return manifest.Id + model.PluginAccessControlPolicyTypeSeparator + accessResourceTypeSuffix
}

// getAccessResourceID returns the stable ID shared by the plugin's ABAC resource and policy.
// The ID is generated once and stored in the KV store with an atomic write so that all
// cluster nodes agree on it.
func (p *Plugin) getAccessResourceID() (string, error) {
	p.accessResourceIDLock.Lock()
	defer p.accessResourceIDLock.Unlock()

	if p.accessResourceID != "" {
		return p.accessResourceID, nil
	}

	id, err := p.kvstore.GetAccessResourceID()
	if err != nil {
		return "", errors.Wrap(err, "failed to read access resource ID")
	}

	if id == "" {
		// The write is a no-op when another node created the ID first.
		if _, createErr := p.kvstore.CreateAccessResourceID(model.NewId()); createErr != nil {
			return "", errors.Wrap(createErr, "failed to create access resource ID")
		}
		// Whether we or another node won the race, the stored value is the source of truth.
		id, err = p.kvstore.GetAccessResourceID()
		if err != nil {
			return "", errors.Wrap(err, "failed to re-read access resource ID")
		}
		if id == "" {
			return "", errors.New("access resource ID is empty after creation")
		}
	}

	p.accessResourceID = id
	return id, nil
}

// userHasAccess reports whether the user may use the plugin. With no policy stored everyone
// has access. Any evaluation error, or a missing decision, denies access (fail closed).
func (p *Plugin) userHasAccess(userID string) bool {
	resourceID, err := p.getAccessResourceID()
	if err != nil {
		p.client.Log.Warn("Access control: failed to get resource ID, denying access", "user_id", userID, "error", err.Error())
		return false
	}

	decision, appErr := p.API.EvaluateAccessControl(userID, accessResourceType(), resourceID, accessActionView)
	if appErr != nil {
		p.client.Log.Warn("Access control: evaluation failed, denying access", "user_id", userID, "error", appErr.Error())
		return false
	}
	if decision == nil {
		p.client.Log.Warn("Access control: evaluation returned no decision, denying access", "user_id", userID)
		return false
	}
	if decision.IsNoPolicy() {
		return true
	}
	return decision.Decision
}

// AccessControlRequired rejects requests from users who fail the plugin's access policy.
// It must run after MattermostAuthorizationRequired.
func (p *Plugin) AccessControlRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !p.userHasAccess(r.Header.Get("Mattermost-User-ID")) {
			p.handleError(w, r, &APIError{
				ID:         "api.pagerduty.access.forbidden",
				Message:    "You do not have access to the PagerDuty plugin.",
				StatusCode: http.StatusForbidden,
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}
