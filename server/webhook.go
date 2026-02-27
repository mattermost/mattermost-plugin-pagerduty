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

	p.client.Log.Debug("Received PagerDuty webhook",
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
// The signature header can contain one or more comma-separated signatures,
// each in the format "v1=<hex-encoded-signature>".
func (p *Plugin) verifyWebhookSignature(body []byte, signatureHeader string) bool {
	// Get the secret from either the webhook registration or config
	secret := p.getWebhookSecret()
	if secret == "" {
		// If no secret is configured, skip verification but log a warning
		p.client.Log.Warn("No webhook secret configured, skipping signature verification")
		return true
	}

	if signatureHeader == "" {
		p.client.Log.Warn("Webhook request missing signature header")
		return false
	}

	// Compute expected HMAC-SHA256
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	computedSignature := mac.Sum(nil)

	// The header may contain multiple comma-separated signatures (e.g. "v1=abc,v1=def").
	// Accept the request if ANY signature matches.
	for _, sig := range strings.Split(signatureHeader, ",") {
		sig = strings.TrimSpace(sig)
		parts := strings.SplitN(sig, "=", 2)
		if len(parts) != 2 || parts[0] != "v1" {
			continue
		}

		expectedSignature, err := hex.DecodeString(parts[1])
		if err != nil {
			continue
		}

		if hmac.Equal(computedSignature, expectedSignature) {
			return true
		}
	}

	p.client.Log.Warn("Webhook signature mismatch — no provided signature matched the computed HMAC",
		"header", signatureHeader,
	)
	return false
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
