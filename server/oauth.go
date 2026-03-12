package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/svelle/mattermost-pagerduty-plugin/server/store/kvstore"
)

const (
	pluginID = "com.svelle.pagerduty-plugin"

	pagerDutyAuthURL  = "https://identity.pagerduty.com/oauth/authorize"
	pagerDutyTokenURL = "https://identity.pagerduty.com/oauth/token" //nolint:gosec // Not a credential

	oauthScopes      = "schedules.read oncalls.read services.read incidents.read incidents.write users.read webhook_subscriptions.read webhook_subscriptions.write" //nolint:lll
	oauthStateExpiry = 10 * time.Minute
)

func (p *Plugin) getOAuthRedirectURI() string {
	return fmt.Sprintf("%s/plugins/%s/api/v1/oauth/callback", p.siteURL, pluginID)
}

func (p *Plugin) handleOAuthConnect(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	p.client.Log.Debug("handleOAuthConnect called", "user_id", userID)

	config := p.getConfiguration()
	if err := config.IsValid(); err != nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.oauth.not_configured",
			Message:    "Plugin not configured. Please contact your administrator.",
			StatusCode: http.StatusNotImplemented,
		})
		return
	}

	stateBytes := make([]byte, 32)
	if _, err := rand.Read(stateBytes); err != nil {
		p.handleErrorWithCode(w, http.StatusInternalServerError, "Failed to generate OAuth state", err)
		return
	}
	state := hex.EncodeToString(stateBytes)

	oauthState := &kvstore.OAuthState{
		UserID:    userID,
		ExpiresAt: time.Now().Add(oauthStateExpiry),
	}
	if err := p.kvstore.SetOAuthState(state, oauthState); err != nil {
		p.handleErrorWithCode(w, http.StatusInternalServerError, "Failed to store OAuth state", err)
		return
	}

	authURL, err := url.Parse(pagerDutyAuthURL)
	if err != nil {
		p.handleErrorWithCode(w, http.StatusInternalServerError, "Failed to parse PagerDuty auth URL", err)
		return
	}

	q := authURL.Query()
	q.Set("client_id", config.OAuthClientID)
	q.Set("redirect_uri", p.getOAuthRedirectURI())
	q.Set("response_type", "code")
	q.Set("scope", oauthScopes)
	q.Set("state", state)
	authURL.RawQuery = q.Encode()

	p.client.Log.Debug("Redirecting user to PagerDuty OAuth", "user_id", userID)
	http.Redirect(w, r, authURL.String(), http.StatusFound)
}

type oauthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
}

func (p *Plugin) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	p.client.Log.Debug("handleOAuthCallback called", "user_id", userID)

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" || state == "" {
		errMsg := r.URL.Query().Get("error_description")
		if errMsg == "" {
			errMsg = r.URL.Query().Get("error")
		}
		if errMsg == "" {
			errMsg = "Missing code or state parameter"
		}
		p.client.Log.Warn("OAuth callback missing parameters", "error", errMsg)
		p.writeOAuthResultPage(w, false, errMsg)
		return
	}

	oauthState, err := p.kvstore.GetOAuthState(state)
	if err != nil {
		p.client.Log.Error("Failed to retrieve OAuth state", "error", err.Error())
		p.writeOAuthResultPage(w, false, "Invalid OAuth state. Please try again.")
		return
	}
	if oauthState == nil {
		p.client.Log.Warn("OAuth state not found", "state", state)
		p.writeOAuthResultPage(w, false, "OAuth state expired. Please try again.")
		return
	}

	// Clean up the state
	_ = p.kvstore.DeleteOAuthState(state)

	if time.Now().After(oauthState.ExpiresAt) {
		p.client.Log.Warn("OAuth state expired", "user_id", oauthState.UserID)
		p.writeOAuthResultPage(w, false, "OAuth state expired. Please try again.")
		return
	}

	if oauthState.UserID != userID {
		p.client.Log.Warn("OAuth state user mismatch", "expected", oauthState.UserID, "actual", userID)
		p.writeOAuthResultPage(w, false, "User mismatch. Please try again.")
		return
	}

	// Exchange authorization code for tokens
	token, err := p.exchangeCodeForToken(code)
	if err != nil {
		p.client.Log.Error("Failed to exchange OAuth code for token", "error", err.Error())
		p.writeOAuthResultPage(w, false, "Failed to complete authorization. Please try again.")
		return
	}

	// Store the token
	if err := p.kvstore.SetUserToken(userID, token); err != nil {
		p.client.Log.Error("Failed to store user token", "error", err.Error(), "user_id", userID)
		p.writeOAuthResultPage(w, false, "Failed to save authorization. Please try again.")
		return
	}

	p.client.Log.Info("Successfully connected PagerDuty account", "user_id", userID)
	p.writeOAuthResultPage(w, true, "")
}

func (p *Plugin) exchangeCodeForToken(code string) (*kvstore.OAuthToken, error) {
	config := p.getConfiguration()

	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("client_id", config.OAuthClientID)
	data.Set("client_secret", config.OAuthClientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", p.getOAuthRedirectURI())

	req, err := http.NewRequest(http.MethodPost, pagerDutyTokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, errors.Wrap(err, "failed to create token request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, errors.Wrap(err, "failed to request token")
	}
	defer resp.Body.Close()

	const maxTokenResponseSize = 1 << 20 // 1MB
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxTokenResponseSize))
	if err != nil {
		return nil, errors.Wrap(err, "failed to read token response")
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token exchange failed: HTTP %d - %s", resp.StatusCode, string(body))
	}

	var tokenResp oauthTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, errors.Wrap(err, "failed to parse token response")
	}

	return &kvstore.OAuthToken{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		TokenType:    tokenResp.TokenType,
		ExpiresAt:    time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second),
	}, nil
}

func (p *Plugin) handleOAuthDisconnect(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	p.client.Log.Debug("handleOAuthDisconnect called", "user_id", userID)

	if err := p.kvstore.DeleteUserToken(userID); err != nil {
		p.client.Log.Error("Failed to delete user token", "error", err.Error(), "user_id", userID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.oauth.disconnect.error",
			Message:    "Failed to disconnect",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	p.client.Log.Debug("User disconnected PagerDuty account", "user_id", userID)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]bool{"ok": true}); err != nil {
		p.client.Log.Error("Failed to encode disconnect response", "error", err.Error())
	}
}

func (p *Plugin) handleOAuthConnectionStatus(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	token, err := p.kvstore.GetUserToken(userID)
	if err != nil {
		p.client.Log.Error("Failed to check user token", "error", err.Error(), "user_id", userID)
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.oauth.status.error",
			Message:    "Failed to check connection status",
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	connected := token != nil
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]bool{"connected": connected}); err != nil {
		p.client.Log.Error("Failed to encode connection status response", "error", err.Error())
	}
}

func (p *Plugin) writeOAuthResultPage(w http.ResponseWriter, success bool, errMsg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	var message, title string
	if success {
		title = "Connected"
		message = "Successfully connected to PagerDuty. You can close this window."
	} else {
		title = "Connection Failed"
		// HTML-escape the error message to prevent reflected XSS — errMsg may
		// originate from PagerDuty's error_description query parameter which is
		// attacker-controllable.
		message = fmt.Sprintf("Failed to connect to PagerDuty: %s", html.EscapeString(errMsg))
	}

	page := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><title>PagerDuty - %s</title></head>
<body>
<h3>%s</h3>
<p>%s</p>
<script>
if (window.opener) {
    window.close();
}
</script>
</body>
</html>`, html.EscapeString(title), html.EscapeString(title), message)

	fmt.Fprint(w, page)
}

func (p *Plugin) refreshUserToken(userID string, token *kvstore.OAuthToken) (*kvstore.OAuthToken, error) {
	config := p.getConfiguration()

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("client_id", config.OAuthClientID)
	data.Set("client_secret", config.OAuthClientSecret)
	data.Set("refresh_token", token.RefreshToken)

	req, err := http.NewRequest(http.MethodPost, pagerDutyTokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, errors.Wrap(err, "failed to create refresh token request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, errors.Wrap(err, "failed to refresh token")
	}
	defer resp.Body.Close()

	const maxTokenResponseSize = 1 << 20 // 1MB
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxTokenResponseSize))
	if err != nil {
		return nil, errors.Wrap(err, "failed to read refresh token response")
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token refresh failed: HTTP %d - %s", resp.StatusCode, string(body))
	}

	var tokenResp oauthTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, errors.Wrap(err, "failed to parse refresh token response")
	}

	newToken := &kvstore.OAuthToken{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		TokenType:    tokenResp.TokenType,
		ExpiresAt:    time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second),
	}

	if err := p.kvstore.SetUserToken(userID, newToken); err != nil {
		return nil, errors.Wrap(err, "failed to store refreshed token")
	}

	p.client.Log.Debug("Successfully refreshed OAuth token", "user_id", userID)
	return newToken, nil
}
