// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package kvstore

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestOAuthToken_IsExpired(t *testing.T) {
	t.Run("expiry well in the future is not expired", func(t *testing.T) {
		tok := &OAuthToken{ExpiresAt: time.Now().Add(30 * time.Minute)}
		assert.False(t, tok.IsExpired())
	})

	t.Run("expiry within the proactive buffer is treated as expired", func(t *testing.T) {
		tok := &OAuthToken{ExpiresAt: time.Now().Add(2 * time.Minute)}
		assert.True(t, tok.IsExpired())
	})

	t.Run("expiry in the past is expired", func(t *testing.T) {
		tok := &OAuthToken{ExpiresAt: time.Now().Add(-time.Minute)}
		assert.True(t, tok.IsExpired())
	})
}
