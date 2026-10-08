// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/svelle/mattermost-pagerduty-plugin/server/store/kvstore"
)

// tokenState is a thread-safe holder for a user's stored OAuth token, used to
// observe what the refresh logic reads, writes, and deletes.
type tokenState struct {
	mu       sync.Mutex
	token    *kvstore.OAuthToken
	deleted  bool
	setCount int
}

// newStatefulStore returns a mockKVStore whose user-token methods are backed by a
// thread-safe in-memory token, plus the shared state for assertions.
func newStatefulStore(initial *kvstore.OAuthToken) (*mockKVStore, *tokenState) {
	st := &tokenState{token: initial}
	return &mockKVStore{
		getUserTokenFunc: func(_ string) (*kvstore.OAuthToken, error) {
			st.mu.Lock()
			defer st.mu.Unlock()
			if st.token == nil {
				return nil, nil
			}
			cp := *st.token
			return &cp, nil
		},
		setUserTokenFunc: func(_ string, token *kvstore.OAuthToken) error {
			st.mu.Lock()
			defer st.mu.Unlock()
			cp := *token
			st.token = &cp
			st.setCount++
			return nil
		},
		deleteUserTokenFunc: func(_ string) error {
			st.mu.Lock()
			defer st.mu.Unlock()
			st.token = nil
			st.deleted = true
			return nil
		},
	}, st
}

// clusterLockRecorder records the keys written through KVSetWithOptions, which is how
// cluster.Mutex acquires and releases its cluster-wide lock.
type clusterLockRecorder struct {
	mu   sync.Mutex
	keys []string
}

func (r *clusterLockRecorder) record(key string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.keys = append(r.keys, key)
}

func (r *clusterLockRecorder) recorded() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.keys...)
}

func newOAuthTestPlugin(tokenURL string, store kvstore.KVStore) (*Plugin, *clusterLockRecorder) {
	return newOAuthTestPluginWithLock(tokenURL, store, true)
}

// newOAuthTestPluginWithLock builds a test plugin whose cluster lock acquisition succeeds or
// fails. cluster.Mutex reads a false result from its atomic KV write as "held elsewhere", so
// lockAcquired=false simulates another cluster node already holding the refresh lock.
func newOAuthTestPluginWithLock(tokenURL string, store kvstore.KVStore, lockAcquired bool) (*Plugin, *clusterLockRecorder) {
	locks := &clusterLockRecorder{}
	api := newMockAPI()
	api.On("KVSetWithOptions", mock.Anything, mock.Anything, mock.Anything).Run(func(args mock.Arguments) {
		locks.record(args.Get(0).(string))
	}).Return(lockAcquired, nil).Maybe()

	p := newTestPlugin(api)
	p.kvstore = store
	p.setConfiguration(&configuration{
		OAuthClientID:     "client-id",
		OAuthClientSecret: "client-secret",
		APIBaseURL:        "https://api.pagerduty.com",
	})
	p.tokenURLOverride = tokenURL
	return p, locks
}

func expiredToken() *kvstore.OAuthToken {
	return &kvstore.OAuthToken{
		AccessToken:  "old-access",
		RefreshToken: "old-refresh",
		TokenType:    "bearer",
		ExpiresAt:    time.Now().Add(-time.Minute),
	}
}

// TestGetPagerDutyClientForUser_SingleFlightRefresh verifies that many concurrent
// callers with an expired token trigger exactly one refresh (no stale-token replay).
func TestGetPagerDutyClientForUser_SingleFlightRefresh(t *testing.T) {
	var hits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		// Widen the race window so concurrent callers pile up on the lock.
		time.Sleep(20 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"new-access","refresh_token":"new-refresh","token_type":"bearer","expires_in":3600}`))
	}))
	defer server.Close()

	store, state := newStatefulStore(expiredToken())
	p, locks := newOAuthTestPlugin(server.URL, store)

	const n = 25
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := range n {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			client, err := p.getPagerDutyClientForUser("user-1")
			errs[idx] = err
			if err == nil {
				assert.NotNil(t, client)
			}
		}(i)
	}
	wg.Wait()

	for _, err := range errs {
		require.NoError(t, err)
	}
	assert.Equal(t, int32(1), atomic.LoadInt32(&hits), "refresh endpoint must be hit exactly once")

	state.mu.Lock()
	require.NotNil(t, state.token)
	assert.Equal(t, "new-access", state.token.AccessToken)
	assert.Equal(t, "new-refresh", state.token.RefreshToken)
	assert.Equal(t, 1, state.setCount, "token must be persisted exactly once")
	state.mu.Unlock()

	// The local lock keeps the waiters off the cluster lock, so it is taken once
	// (one KV write to acquire, one to release) rather than once per caller.
	assert.Len(t, locks.recorded(), 2, "cluster lock must be acquired and released once")
}

// TestRefreshUserToken_InvalidGrantIsTerminal verifies invalid_grant clears the
// stored token and surfaces ErrTokenExpired so the user is prompted to reconnect.
func TestRefreshUserToken_InvalidGrantIsTerminal(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"Invalid or unknown refresh token provided."}`))
	}))
	defer server.Close()

	store, state := newStatefulStore(expiredToken())
	p, _ := newOAuthTestPlugin(server.URL, store)

	_, err := p.getPagerDutyClientForUser("user-1")
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrTokenExpired), "invalid_grant must be terminal")
	assert.False(t, errors.Is(err, ErrTokenRefreshUnavailable))

	state.mu.Lock()
	assert.True(t, state.deleted, "token must be deleted on invalid_grant")
	assert.Nil(t, state.token)
	state.mu.Unlock()
}

// TestRefreshUserToken_ServerErrorIsTransient verifies a 5xx is retryable and does
// not discard the stored token or force a reconnect.
func TestRefreshUserToken_ServerErrorIsTransient(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"server_error"}`))
	}))
	defer server.Close()

	store, state := newStatefulStore(expiredToken())
	p, _ := newOAuthTestPlugin(server.URL, store)

	_, err := p.getPagerDutyClientForUser("user-1")
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrTokenRefreshUnavailable), "5xx must be transient")
	assert.False(t, errors.Is(err, ErrTokenExpired))

	state.mu.Lock()
	assert.False(t, state.deleted, "token must be preserved on transient error")
	require.NotNil(t, state.token)
	assert.Equal(t, "old-refresh", state.token.RefreshToken)
	state.mu.Unlock()
}

// TestRefreshUserToken_NetworkErrorIsTransient verifies a network failure reaching
// the token endpoint is treated as transient and preserves the token.
func TestRefreshUserToken_NetworkErrorIsTransient(t *testing.T) {
	// Point at a server that is immediately closed so the request fails to connect.
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := server.URL
	server.Close()

	store, state := newStatefulStore(expiredToken())
	p, _ := newOAuthTestPlugin(url, store)

	_, err := p.getPagerDutyClientForUser("user-1")
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrTokenRefreshUnavailable))

	state.mu.Lock()
	assert.False(t, state.deleted)
	require.NotNil(t, state.token)
	state.mu.Unlock()
}

// TestRefreshUserToken_PreservesRefreshTokenWhenOmitted verifies that when the
// refresh response omits a refresh_token, the existing one is retained.
func TestRefreshUserToken_PreservesRefreshTokenWhenOmitted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"new-access","token_type":"bearer","expires_in":3600}`))
	}))
	defer server.Close()

	initial := expiredToken()
	initial.RefreshToken = "keep-me"
	store, state := newStatefulStore(initial)
	p, _ := newOAuthTestPlugin(server.URL, store)

	client, err := p.getPagerDutyClientForUser("user-1")
	require.NoError(t, err)
	assert.NotNil(t, client)

	state.mu.Lock()
	require.NotNil(t, state.token)
	assert.Equal(t, "new-access", state.token.AccessToken)
	assert.Equal(t, "keep-me", state.token.RefreshToken)
	state.mu.Unlock()
}

// TestGetPagerDutyClientForUser_NotConnected verifies the no-token path is unchanged.
func TestGetPagerDutyClientForUser_NotConnected(t *testing.T) {
	store, _ := newStatefulStore(nil)
	p, locks := newOAuthTestPlugin("http://127.0.0.1:0", store)

	_, err := p.getPagerDutyClientForUser("user-1")
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrNotConnected))
	assert.Empty(t, locks.recorded(), "no refresh lock should be taken when not connected")
}

// TestRefreshUserToken_GuardedByPerUserClusterLock verifies the refresh is guarded by a
// cluster-wide mutex keyed per user, so the lock spans nodes in a clustered deployment.
func TestRefreshUserToken_GuardedByPerUserClusterLock(t *testing.T) {
	t.Run("acquires and releases a per-user lock", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"new-access","refresh_token":"new-refresh","token_type":"bearer","expires_in":3600}`))
		}))
		defer server.Close()

		store, _ := newStatefulStore(expiredToken())
		p, locks := newOAuthTestPlugin(server.URL, store)

		_, err := p.getPagerDutyClientForUser("user-1")
		require.NoError(t, err)

		// cluster.Mutex namespaces its KV key with a "mutex_" prefix, writing once to
		// acquire the lock and once to release it.
		keys := locks.recorded()
		require.Len(t, keys, 2, "expected one KV write to acquire the lock and one to release it")
		for _, key := range keys {
			assert.Equal(t, "mutex_"+tokenRefreshLockPrefix+"user-1", key)
		}
	})

	t.Run("times out and preserves the token when the lock is held elsewhere", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			t.Error("token endpoint must not be called without the refresh lock")
		}))
		defer server.Close()

		store, state := newStatefulStore(expiredToken())
		p, locks := newOAuthTestPluginWithLock(server.URL, store, false)
		// cluster.Mutex retries roughly every second, so a sub-second budget makes the
		// timeout fire on the first retry.
		p.refreshLockTimeoutOverride = 200 * time.Millisecond

		_, err := p.getPagerDutyClientForUser("user-1")
		require.Error(t, err)
		assert.True(t, errors.Is(err, ErrTokenRefreshUnavailable), "a contended lock must be transient")
		assert.False(t, errors.Is(err, ErrTokenExpired), "a contended lock must not force a reconnect")

		// One write to attempt the lock and none to release it, since it was never held.
		assert.Equal(t, []string{"mutex_" + tokenRefreshLockPrefix + "user-1"}, locks.recorded())

		state.mu.Lock()
		defer state.mu.Unlock()
		assert.False(t, state.deleted, "token must be preserved when the lock is unavailable")
		require.NotNil(t, state.token)
		assert.Equal(t, "old-access", state.token.AccessToken)
		assert.Equal(t, "old-refresh", state.token.RefreshToken)
		assert.Zero(t, state.setCount, "token must not be rewritten when the lock is unavailable")
	})
}

// TestRefreshUserTokenSingleFlight_SkipsLockWhenTokenAlreadyFresh verifies a caller whose
// token was refreshed by someone else reuses it without locking or calling PagerDuty.
func TestRefreshUserTokenSingleFlight_SkipsLockWhenTokenAlreadyFresh(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("token endpoint must not be called for a fresh token")
	}))
	defer server.Close()

	fresh := expiredToken()
	fresh.AccessToken = "fresh-access"
	fresh.ExpiresAt = time.Now().Add(time.Hour)
	store, _ := newStatefulStore(fresh)
	p, locks := newOAuthTestPlugin(server.URL, store)

	token, err := p.refreshUserTokenSingleFlight("user-1")
	require.NoError(t, err)
	assert.Equal(t, "fresh-access", token.AccessToken)
	assert.Empty(t, locks.recorded(), "cluster lock must be skipped when the token is already fresh")
}
