package kvstore

import (
	"fmt"

	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/pkg/errors"
)

// Client wraps the Mattermost plugin KV store API.
type Client struct {
	client *pluginapi.Client
}

// NewKVStore creates a new KV store client.
func NewKVStore(client *pluginapi.Client) KVStore {
	return Client{
		client: client,
	}
}

// GetCachedSchedules retrieves cached schedule data.
func (kv Client) GetCachedSchedules() ([]byte, error) {
	var data []byte
	err := kv.client.KV.Get("pagerduty_schedules_cache", &data)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get cached schedules")
	}
	return data, nil
}

// SetCachedSchedules stores schedule data in cache.
func (kv Client) SetCachedSchedules(data []byte) error {
	_, err := kv.client.KV.Set("pagerduty_schedules_cache", data)
	if err != nil {
		return errors.Wrap(err, "failed to cache schedules")
	}
	return nil
}

func userTokenKey(userID string) string {
	return fmt.Sprintf("pd_token_%s", userID)
}

func oauthStateKey(state string) string {
	return fmt.Sprintf("pd_oauth_state_%s", state)
}

// GetUserToken retrieves the OAuth token for a user.
func (kv Client) GetUserToken(userID string) (*OAuthToken, error) {
	var token OAuthToken
	err := kv.client.KV.Get(userTokenKey(userID), &token)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get user token")
	}
	if token.AccessToken == "" {
		return nil, nil
	}
	return &token, nil
}

// SetUserToken stores the OAuth token for a user.
func (kv Client) SetUserToken(userID string, token *OAuthToken) error {
	_, err := kv.client.KV.Set(userTokenKey(userID), token)
	if err != nil {
		return errors.Wrap(err, "failed to set user token")
	}
	return nil
}

// DeleteUserToken removes the OAuth token for a user.
func (kv Client) DeleteUserToken(userID string) error {
	err := kv.client.KV.Delete(userTokenKey(userID))
	if err != nil {
		return errors.Wrap(err, "failed to delete user token")
	}
	return nil
}

// GetOAuthState retrieves an OAuth state entry.
func (kv Client) GetOAuthState(state string) (*OAuthState, error) {
	var oauthState OAuthState
	err := kv.client.KV.Get(oauthStateKey(state), &oauthState)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get OAuth state")
	}
	if oauthState.UserID == "" {
		return nil, nil
	}
	return &oauthState, nil
}

// SetOAuthState stores an OAuth state entry.
func (kv Client) SetOAuthState(state string, oauthState *OAuthState) error {
	_, err := kv.client.KV.Set(oauthStateKey(state), oauthState)
	if err != nil {
		return errors.Wrap(err, "failed to set OAuth state")
	}
	return nil
}

// DeleteOAuthState removes an OAuth state entry.
func (kv Client) DeleteOAuthState(state string) error {
	err := kv.client.KV.Delete(oauthStateKey(state))
	if err != nil {
		return errors.Wrap(err, "failed to delete OAuth state")
	}
	return nil
}
