// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"net/http"
)

// APIError represents a structured error response returned by the plugin API.
type APIError struct {
	ID         string `json:"id"`
	Message    string `json:"message"`
	StatusCode int    `json:"-"`
}

// handleError writes a structured JSON error response to the client and logs the error.
// Use this for internal errors where the caller doesn't need specific status codes.
func (p *Plugin) handleError(w http.ResponseWriter, _ *http.Request, err *APIError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.StatusCode)

	if encErr := json.NewEncoder(w).Encode(err); encErr != nil {
		p.client.Log.Error("Failed to encode error response", "error", encErr.Error())
	}
}

// handleErrorWithCode writes a structured JSON error response with a specific HTTP status code.
// It logs both the public message (returned to the client) and the internal error (for debugging).
func (p *Plugin) handleErrorWithCode(w http.ResponseWriter, code int, publicMsg string, internalErr error) {
	p.client.Log.Error(publicMsg, "error", internalErr.Error(), "status", code)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)

	resp := map[string]string{"error": publicMsg}
	if encErr := json.NewEncoder(w).Encode(resp); encErr != nil {
		p.client.Log.Error("Failed to encode error response", "error", encErr.Error())
	}
}
