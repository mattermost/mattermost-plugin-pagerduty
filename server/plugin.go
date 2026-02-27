package main

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/pkg/errors"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
	"github.com/svelle/mattermost-pagerduty-plugin/server/store/kvstore"
)

var (
	// ErrNotConnected indicates the user has not connected their PagerDuty account.
	ErrNotConnected = errors.New("not connected to PagerDuty")

	// ErrTokenExpired indicates the user's OAuth token has expired and could not be refreshed.
	ErrTokenExpired = errors.New("PagerDuty session expired, please reconnect")
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
}

// OnActivate is invoked when the plugin is activated. If an error is returned, the plugin will be deactivated.
func (p *Plugin) OnActivate() error {
	p.client = pluginapi.NewClient(p.MattermostPlugin.API, p.MattermostPlugin.Driver)

	// Initialize the PagerDuty client factory with the default OAuth implementation
	p.createPagerDutyClient = pagerduty.NewOAuthClient

	p.kvstore = kvstore.NewKVStore(p.client)

	config := p.MattermostPlugin.API.GetConfig()
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
		p.client.Log.Debug("OAuth token expired, attempting refresh", "user_id", userID)
		token, err = p.refreshUserToken(userID, token)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrTokenExpired, err)
		}
	}

	config := p.getConfiguration()
	return p.createPagerDutyClient(token.AccessToken, config.APIBaseURL), nil
}

// ServeHTTP handles HTTP requests to the plugin.
func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	if p.router == nil {
		http.Error(w, "Plugin not initialized", http.StatusServiceUnavailable)
		return
	}
	p.router.ServeHTTP(w, r)
}

// See https://developers.mattermost.com/extend/plugins/server/reference/
