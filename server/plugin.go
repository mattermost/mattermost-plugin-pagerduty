package main

import (
	"fmt"
	"sync"

	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/pkg/errors"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
	"github.com/svelle/mattermost-pagerduty-plugin/server/store/kvstore"
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
}

// OnActivate is invoked when the plugin is activated. If an error is returned, the plugin will be deactivated.
func (p *Plugin) OnActivate() error {
	p.client = pluginapi.NewClient(p.MattermostPlugin.API, p.MattermostPlugin.Driver)
	p.client.Log.Info("PagerDuty plugin activating")

	// Initialize the PagerDuty client factory with the default OAuth implementation
	p.createPagerDutyClient = pagerduty.NewOAuthClient

	p.kvstore = kvstore.NewKVStore(p.client)

	config := p.MattermostPlugin.API.GetConfig()
	if config.ServiceSettings.SiteURL == nil {
		p.client.Log.Error("Site URL is not configured")
		return errors.New("site URL is not configured")
	}
	p.siteURL = *config.ServiceSettings.SiteURL
	p.client.Log.Debug("Site URL configured", "url", p.siteURL)

	// Log plugin configuration status
	pluginConfig := p.getConfiguration()
	if err := pluginConfig.IsValid(); err != nil {
		p.client.Log.Warn("Plugin configuration is not valid", "error", err)
	} else {
		p.client.Log.Info("Plugin configuration is valid", "base_url", pluginConfig.APIBaseURL)
	}

	p.client.Log.Info("PagerDuty plugin activated successfully")
	return nil
}

// OnDeactivate is invoked when the plugin is deactivated.
func (p *Plugin) OnDeactivate() error {
	if p.client != nil {
		p.client.Log.Info("PagerDuty plugin deactivating")
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
		return nil, fmt.Errorf("not connected to PagerDuty")
	}

	if token.IsExpired() {
		p.client.Log.Debug("OAuth token expired, attempting refresh", "user_id", userID)
		token, err = p.refreshUserToken(userID, token)
		if err != nil {
			return nil, fmt.Errorf("PagerDuty session expired, please reconnect: %w", err)
		}
	}

	config := p.getConfiguration()
	return p.createPagerDutyClient(token.AccessToken, config.APIBaseURL), nil
}

// See https://developers.mattermost.com/extend/plugins/server/reference/
