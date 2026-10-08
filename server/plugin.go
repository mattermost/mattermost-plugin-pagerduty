// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/mattermost/mattermost/server/public/pluginapi/cluster"
	"github.com/pkg/errors"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
	"github.com/svelle/mattermost-pagerduty-plugin/server/store/kvstore"
)

const (
	// tokenRefreshLockPrefix namespaces the per-user cluster mutex guarding token refreshes.
	tokenRefreshLockPrefix = "pd_token_refresh_"

	// tokenRefreshLockTimeout bounds how long a caller waits for the cluster-wide refresh
	// lock before reporting a transient failure instead of blocking the request forever.
	tokenRefreshLockTimeout = 30 * time.Second
)

var (
	// ErrNotConnected indicates the user has not connected their PagerDuty account.
	ErrNotConnected = errors.New("not connected to PagerDuty")

	// ErrTokenExpired indicates the user's OAuth token could not be refreshed and the
	// user must reconnect (terminal). This happens when PagerDuty rejects the refresh
	// token (invalid_grant) because it was revoked, rotated away, or expired.
	ErrTokenExpired = errors.New("PagerDuty session expired, please reconnect")

	// ErrTokenRefreshUnavailable indicates a transient failure refreshing the token
	// (network error or 5xx). The stored token is preserved and the caller may retry.
	ErrTokenRefreshUnavailable = errors.New("PagerDuty token refresh temporarily unavailable")
)

// Plugin implements the interface expected by the Mattermost server to communicate between the server and plugin processes.
type Plugin struct {
	plugin.MattermostPlugin

	// kvstore is the client used to read/write KV records for this plugin.
	kvstore kvstore.KVStore

	// client is the Mattermost server API client.
	client *pluginapi.Client

	// configurationLock synchronizes access to the configuration.
	configurationLock sync.RWMutex

	// configuration is the active plugin configuration. Consult getConfiguration and
	// setConfiguration for usage.
	configuration *configuration

	// siteURL is the Mattermost site URL, used for OAuth redirect URIs.
	siteURL string

	// createPagerDutyClient is a function to create PagerDuty clients.
	// This can be overridden in tests to inject mock clients.
	createPagerDutyClient func(accessToken, baseURL string) *pagerduty.Client

	// botID is the Mattermost user ID for the PagerDuty bot.
	botID string

	// router is the HTTP router for all plugin endpoints, initialized once in OnActivate.
	router *mux.Router

	// onCallMonitor runs background on-call change detection.
	onCallMonitor *OnCallMonitor

	// tokenRefreshLocks holds a per-user *sync.Mutex used to serialize OAuth token
	// refreshes within this process. PagerDuty rotates refresh tokens, so concurrent
	// refreshes of the same user's token would replay an already-rotated refresh token
	// and fail (invalid_grant). Cross-node exclusion is handled by a cluster mutex.
	tokenRefreshLocks sync.Map

	// tokenURLOverride, when set, replaces the PagerDuty OAuth token endpoint. Used in tests.
	tokenURLOverride string

	// refreshLockTimeoutOverride, when set, replaces tokenRefreshLockTimeout. Used in tests.
	refreshLockTimeoutOverride time.Duration
}

// OnActivate is invoked when the plugin is activated. If an error is returned, the plugin will be deactivated.
func (p *Plugin) OnActivate() error {
	p.client = pluginapi.NewClient(p.API, p.Driver)

	// Initialize the PagerDuty client factory with the default OAuth implementation
	p.createPagerDutyClient = pagerduty.NewOAuthClient

	p.kvstore = kvstore.NewKVStore(p.client)

	config := p.API.GetConfig()
	if config.ServiceSettings.SiteURL == nil {
		return errors.New("site URL is not configured")
	}
	p.siteURL = *config.ServiceSettings.SiteURL

	// Initialize HTTP router early so API endpoints are available even if
	// optional features (bot, slash command) fail to initialize.
	p.router = p.initRouter()

	// Log plugin configuration status
	pluginConfig := p.getConfiguration()
	if err := pluginConfig.IsValid(); err != nil {
		p.client.Log.Warn("Plugin configuration is not valid — OAuth will not work until configured", "error", err)
	}

	// Ensure bot account exists
	if err := p.ensureBot(); err != nil {
		return errors.Wrap(err, "failed to ensure PagerDuty bot")
	}

	// Register slash command
	if err := p.registerCommand(); err != nil {
		return errors.Wrap(err, "failed to register slash command")
	}

	// Start the on-call monitor background job
	p.onCallMonitor = NewOnCallMonitor(p)
	p.onCallMonitor.Start()

	p.client.Log.Info("PagerDuty plugin activated")
	return nil
}

// OnDeactivate is invoked when the plugin is deactivated.
func (p *Plugin) OnDeactivate() error {
	if p.onCallMonitor != nil {
		p.onCallMonitor.Stop()
	}

	if p.client != nil {
		p.client.Log.Debug("PagerDuty plugin deactivating")
	}
	return nil
}

// getPagerDutyClientForUser retrieves the user's OAuth token from the KV store,
// refreshes it if expired, and returns a PagerDuty client authenticated as that user.
func (p *Plugin) getPagerDutyClientForUser(userID string) (*pagerduty.Client, error) {
	token, err := p.kvstore.GetUserToken(userID)
	if err != nil {
		return nil, errors.Wrap(err, "failed to retrieve user token")
	}
	if token == nil {
		return nil, ErrNotConnected
	}

	if token.IsExpired() {
		token, err = p.refreshUserTokenSingleFlight(userID)
		if err != nil {
			return nil, err
		}
	}

	config := p.getConfiguration()
	return p.createPagerDutyClient(token.AccessToken, config.APIBaseURL), nil
}

// userRefreshLock returns the per-user, process-local mutex used to serialize token refreshes.
func (p *Plugin) userRefreshLock(userID string) *sync.Mutex {
	lock, _ := p.tokenRefreshLocks.LoadOrStore(userID, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

// refreshLockTimeout returns how long to wait for the cluster-wide refresh lock.
func (p *Plugin) refreshLockTimeout() time.Duration {
	if p.refreshLockTimeoutOverride > 0 {
		return p.refreshLockTimeoutOverride
	}
	return tokenRefreshLockTimeout
}

// loadTokenForRefresh reads the user's stored token and reports whether it still needs
// refreshing. Callers use it to re-check state after acquiring a lock.
func (p *Plugin) loadTokenForRefresh(userID string) (*kvstore.OAuthToken, bool, error) {
	token, err := p.kvstore.GetUserToken(userID)
	if err != nil {
		return nil, false, errors.Wrap(err, "failed to retrieve user token")
	}
	if token == nil {
		return nil, false, ErrNotConnected
	}
	return token, token.IsExpired(), nil
}

// refreshUserTokenSingleFlight refreshes a user's token under two layers of locking so that
// only one refresh per user runs at a time, even in a clustered deployment. PagerDuty rotates
// refresh tokens, so a concurrent refresh would replay an already-rotated token and fail
// (invalid_grant), which can revoke the whole token family via reuse detection.
//
// The process-local mutex serializes goroutines on this node cheaply; the cluster mutex then
// serializes across nodes. Each layer re-reads the token once the lock is held, so a caller
// that waited reuses the token another refresher already rotated instead of replaying it.
func (p *Plugin) refreshUserTokenSingleFlight(userID string) (*kvstore.OAuthToken, error) {
	localLock := p.userRefreshLock(userID)
	localLock.Lock()
	defer localLock.Unlock()

	// Re-check before reaching for the cluster lock: a goroutine on this node may have
	// refreshed while we waited, which avoids the cluster lock's KV round-trips entirely.
	token, needsRefresh, err := p.loadTokenForRefresh(userID)
	if err != nil {
		return nil, err
	}
	if !needsRefresh {
		return token, nil
	}

	clusterLock, err := cluster.NewMutex(p.API, tokenRefreshLockPrefix+userID)
	if err != nil {
		return nil, errors.Wrapf(ErrTokenRefreshUnavailable, "failed to create refresh lock: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), p.refreshLockTimeout())
	defer cancel()

	if err = clusterLock.LockWithContext(ctx); err != nil {
		return nil, errors.Wrapf(ErrTokenRefreshUnavailable, "failed to acquire refresh lock: %v", err)
	}
	defer clusterLock.Unlock()

	// Re-check now that the cluster lock is held: another node may have refreshed.
	token, needsRefresh, err = p.loadTokenForRefresh(userID)
	if err != nil {
		return nil, err
	}
	if !needsRefresh {
		return token, nil
	}

	p.client.Log.Debug("OAuth token expired, attempting refresh", "user_id", userID)
	return p.refreshUserToken(userID, token)
}

// ServeHTTP handles HTTP requests to the plugin.
func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	if p.router == nil {
		p.handleError(w, r, &APIError{
			ID:         "api.pagerduty.not_initialized",
			Message:    "Plugin not initialized",
			StatusCode: http.StatusServiceUnavailable,
		})
		return
	}
	p.router.ServeHTTP(w, r)
}

// See https://developers.mattermost.com/extend/plugins/server/reference/
