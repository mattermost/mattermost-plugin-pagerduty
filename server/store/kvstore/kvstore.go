package kvstore

import "time"

// OAuthToken stores per-user PagerDuty OAuth tokens.
type OAuthToken struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// IsExpired returns true if the access token has expired (with a 60-second buffer).
func (t *OAuthToken) IsExpired() bool {
	return time.Now().After(t.ExpiresAt.Add(-60 * time.Second))
}

// OAuthState stores the CSRF state for an in-progress OAuth flow.
type OAuthState struct {
	UserID    string    `json:"user_id"`
	ExpiresAt time.Time `json:"expires_at"`
}

// KVStore is the interface for plugin key-value storage.
type KVStore interface {
	GetCachedSchedules() ([]byte, error)
	SetCachedSchedules(data []byte) error

	GetUserToken(userID string) (*OAuthToken, error)
	SetUserToken(userID string, token *OAuthToken) error
	DeleteUserToken(userID string) error

	GetOAuthState(state string) (*OAuthState, error)
	SetOAuthState(state string, oauthState *OAuthState) error
	DeleteOAuthState(state string) error
}
