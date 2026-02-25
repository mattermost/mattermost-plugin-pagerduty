package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
)

const (
	maxWebhookBodySize       = 1 << 20 // 1MB
	pagerDutySignatureHeader = "X-PagerDuty-Signature"
)

// handlePagerDutyWebhook receives and processes PagerDuty V3 webhook events.
// This endpoint is NOT protected by the Mattermost auth middleware since
// requests come from PagerDuty's servers.
func (p *Plugin) handlePagerDutyWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Read the raw body (needed for signature verification)
	r.Body = http.MaxBytesReader(w, r.Body, maxWebhookBodySize)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		p.client.Log.Error("Failed to read webhook body", "error", err.Error())
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	// Verify the webhook signature
	if !p.verifyWebhookSignature(body, r.Header.Get(pagerDutySignatureHeader)) {
		p.client.Log.Warn("Webhook signature verification failed")
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	// Parse the webhook payload
	var payload pagerduty.WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		p.client.Log.Error("Failed to unmarshal webhook payload", "error", err.Error())
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	p.client.Log.Info("Received PagerDuty webhook",
		"event_id", payload.Event.ID,
		"event_type", payload.Event.EventType,
		"resource_type", payload.Event.ResourceType,
	)

	// Process the event (routing to channel subscriptions)
	p.processWebhookEvent(&payload.Event)

	// Respond immediately with 200
	w.WriteHeader(http.StatusOK)
}

// verifyWebhookSignature verifies the HMAC-SHA256 signature from PagerDuty.
// The signature header format is "v1=<hex-encoded-signature>".
func (p *Plugin) verifyWebhookSignature(body []byte, signatureHeader string) bool {
	// Get the secret from either the webhook registration or config
	secret := p.getWebhookSecret()
	if secret == "" {
		// If no secret is configured, skip verification but log a warning
		p.client.Log.Warn("No webhook secret configured, skipping signature verification")
		return true
	}

	if signatureHeader == "" {
		return false
	}

	// Parse the signature header (format: "v1=<signature>")
	parts := strings.SplitN(signatureHeader, "=", 2)
	if len(parts) != 2 || parts[0] != "v1" {
		p.client.Log.Warn("Invalid webhook signature format", "header", signatureHeader)
		return false
	}

	expectedSignature, err := hex.DecodeString(parts[1])
	if err != nil {
		p.client.Log.Warn("Failed to decode webhook signature", "error", err.Error())
		return false
	}

	// Compute HMAC-SHA256
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	computedSignature := mac.Sum(nil)

	return hmac.Equal(computedSignature, expectedSignature)
}

// getWebhookSecret retrieves the webhook secret from KV store or config.
func (p *Plugin) getWebhookSecret() string {
	// First try the webhook registration stored secret
	reg, err := p.kvstore.GetWebhookRegistration()
	if err == nil && reg != nil && reg.Secret != "" {
		return reg.Secret
	}

	// Fall back to the config-level secret
	config := p.getConfiguration()
	return config.WebhookSecret
}
