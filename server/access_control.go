// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/pkg/errors"
)

const (
	// accessResourceTypeSuffix is the plugin-local resource type segment.
	accessResourceTypeSuffix = "plugin"

	// accessActionView is the ABAC action evaluated for every plugin request.
	accessActionView = "view"

	// accessPolicyName is the display name of the plugin's access policy.
	accessPolicyName = "PagerDuty plugin access"

	// wsEventAccessPolicyChanged is published to all users when the policy is saved or removed.
	wsEventAccessPolicyChanged = "access_policy_changed"

	// clusterEventAccessCacheInvalidate tells other cluster nodes to drop their cached decisions.
	clusterEventAccessCacheInvalidate = "access_cache_invalidate"

	// accessDecisionTTL is how long a real access decision is cached per user.
	accessDecisionTTL = 30 * time.Second

	// accessDecisionCacheMaxEntries bounds the cache; expired entries are dropped first,
	// and the cache is reset if it is still full.
	accessDecisionCacheMaxEntries = 10000
)

type accessCacheEntry struct {
	allowed bool
	expires time.Time
}

// accessDecisionCache is a small, concurrency-safe, TTL-bounded per-user decision cache.
// The zero value is ready to use. A generation counter makes invalidation race-free: a
// decision computed before an invalidation is never stored after it.
type accessDecisionCache struct {
	mu         sync.Mutex
	entries    map[string]accessCacheEntry
	generation uint64
}

// get returns the cached decision and the current generation (to pass to set).
func (c *accessDecisionCache) get(userID string, now time.Time) (allowed, ok bool, generation uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if e, found := c.entries[userID]; found {
		if now.Before(e.expires) {
			return e.allowed, true, c.generation
		}
		delete(c.entries, userID)
	}
	return false, false, c.generation
}

// set stores a decision unless the cache was invalidated since generation was read.
func (c *accessDecisionCache) set(userID string, allowed bool, now time.Time, generation uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if generation != c.generation {
		return
	}
	if c.entries == nil {
		c.entries = make(map[string]accessCacheEntry)
	}
	if _, exists := c.entries[userID]; !exists && len(c.entries) >= accessDecisionCacheMaxEntries {
		for id, e := range c.entries {
			if !now.Before(e.expires) {
				delete(c.entries, id)
			}
		}
		if len(c.entries) >= accessDecisionCacheMaxEntries {
			c.entries = make(map[string]accessCacheEntry)
		}
	}
	c.entries[userID] = accessCacheEntry{allowed: allowed, expires: now.Add(accessDecisionTTL)}
}

func (c *accessDecisionCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = nil
	c.generation++
}

func (c *accessDecisionCache) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.entries)
}

func (p *Plugin) accessNow() time.Time {
	if p.accessClock != nil {
		return p.accessClock()
	}
	return time.Now()
}

// invalidateAccessCache clears cached decisions on this node and asks other cluster nodes to
// do the same. Cross-node failures are logged only: entries expire after accessDecisionTTL.
func (p *Plugin) invalidateAccessCache() {
	p.accessCache.clear()

	err := p.API.PublishPluginClusterEvent(
		model.PluginClusterEvent{Id: clusterEventAccessCacheInvalidate},
		model.PluginClusterEventSendOptions{SendType: model.PluginClusterEventSendTypeReliable},
	)
	if err != nil {
		p.client.Log.Warn("Access control: failed to notify other nodes to clear the decision cache", "error", err.Error())
	}
}

// OnPluginClusterEvent handles events published by other cluster nodes.
func (p *Plugin) OnPluginClusterEvent(_ *plugin.Context, ev model.PluginClusterEvent) {
	if ev.Id == clusterEventAccessCacheInvalidate {
		p.accessCache.clear()
	}
}

// accessResourceType returns the ABAC resource type, "<pluginID>:<type>".
func accessResourceType() string {
	return manifest.Id + model.PluginAccessControlPolicyTypeSeparator + accessResourceTypeSuffix
}

// getAccessResourceID returns the stable ID shared by the plugin's ABAC resource and policy.
// The ID is generated once and stored in the KV store with an atomic write so that all
// cluster nodes agree on it.
func (p *Plugin) getAccessResourceID() (string, error) {
	p.accessResourceIDLock.Lock()
	defer p.accessResourceIDLock.Unlock()

	if p.accessResourceID != "" {
		return p.accessResourceID, nil
	}

	id, err := p.kvstore.GetAccessResourceID()
	if err != nil {
		return "", errors.Wrap(err, "failed to read access resource ID")
	}

	if id == "" {
		// The write is a no-op when another node created the ID first.
		if _, createErr := p.kvstore.CreateAccessResourceID(model.NewId()); createErr != nil {
			return "", errors.Wrap(createErr, "failed to create access resource ID")
		}
		// Whether we or another node won the race, the stored value is the source of truth.
		id, err = p.kvstore.GetAccessResourceID()
		if err != nil {
			return "", errors.Wrap(err, "failed to re-read access resource ID")
		}
		if id == "" {
			return "", errors.New("access resource ID is empty after creation")
		}
	}

	p.accessResourceID = id
	return id, nil
}

// userHasAccess reports whether the user may use the plugin. With no policy stored everyone
// has access. Any evaluation error, or a missing decision, denies access (fail closed).
// Real decisions (including no-policy) are cached briefly; failures are never cached.
func (p *Plugin) userHasAccess(userID string) bool {
	// The generation is read before evaluating so a concurrent invalidation drops our result.
	allowed, ok, generation := p.accessCache.get(userID, p.accessNow())
	if ok {
		return allowed
	}

	resourceID, err := p.getAccessResourceID()
	if err != nil {
		p.client.Log.Warn("Access control: failed to get resource ID, denying access", "user_id", userID, "error", err.Error())
		return false
	}

	decision, appErr := p.API.EvaluateAccessControl(userID, accessResourceType(), resourceID, accessActionView)
	if appErr != nil {
		p.client.Log.Warn("Access control: evaluation failed, denying access", "user_id", userID, "error", appErr.Error())
		return false
	}
	if decision == nil {
		p.client.Log.Warn("Access control: evaluation returned no decision, denying access", "user_id", userID)
		return false
	}

	allowed = decision.IsNoPolicy() || decision.Decision
	p.accessCache.set(userID, allowed, p.accessNow(), generation)
	return allowed
}

// AccessControlRequired rejects requests from users who fail the plugin's access policy.
// It must run after MattermostAuthorizationRequired.
func (p *Plugin) AccessControlRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !p.userHasAccess(r.Header.Get("Mattermost-User-ID")) {
			p.handleError(w, r, &APIError{
				ID:         "api.pagerduty.access.forbidden",
				Message:    "You do not have access to the PagerDuty plugin.",
				StatusCode: http.StatusForbidden,
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}
