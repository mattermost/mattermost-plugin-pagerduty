// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/svelle/mattermost-pagerduty-plugin/server/pagerduty"
)

const (
	testAdminID   = "admin-user-id"
	testUserID    = "regular-user-id"
	testResource  = "abcdefghijklmnopqrstuvwxyz"
	testPluginTyp = "com.mattermost.plugin-pagerduty:plugin"
)

// allowAllAccess makes every ABAC evaluation report "no policy" (everyone has access).
func allowAllAccess(api *plugintest.API) {
	decision := model.NewNoPolicyAccessDecision()
	api.On("EvaluateAccessControl", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(&decision, (*model.AppError)(nil)).Maybe()
}

// newAccessTestPlugin returns a plugin with a bare mock API (log calls allowed) and a fixed
// resource ID. Unlike newTestPlugin it does not allow EvaluateAccessControl; tests set it.
func newAccessTestPlugin(t *testing.T) (*Plugin, *plugintest.API) {
	t.Helper()
	api := &plugintest.API{}
	for _, level := range []string{"LogDebug", "LogInfo", "LogWarn", "LogError"} {
		api.On(level, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On(level, mock.Anything, mock.Anything, mock.Anything).Return().Maybe()
		api.On(level, mock.Anything).Return().Maybe()
	}
	p := &Plugin{}
	p.SetAPI(api)
	p.client = pluginapi.NewClient(api, nil)
	p.botID = "bot-user-id"
	p.kvstore = &mockKVStore{accessResourceID: testResource}
	p.configuration = &configuration{}
	p.createPagerDutyClient = pagerduty.NewOAuthClient
	p.router = p.initRouter()
	t.Cleanup(func() { api.AssertExpectations(t) })
	return p, api
}

func mockAdmin(api *plugintest.API) {
	api.On("GetUser", testAdminID).Return(&model.User{Id: testAdminID, Roles: model.SystemAdminRoleId + " " + model.SystemUserRoleId}, nil).Maybe()
	api.On("GetUser", testUserID).Return(&model.User{Id: testUserID, Roles: model.SystemUserRoleId}, nil).Maybe()
}

func doAccessRequest(p *Plugin, method, path, userID, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if userID != "" {
		r.Header.Set("Mattermost-User-ID", userID)
	}
	w := httptest.NewRecorder()
	p.ServeHTTP(nil, w, r)
	return w
}

func decodeBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out), w.Body.String())
	return out
}

func TestAccessResourceType(t *testing.T) {
	assert.Equal(t, testPluginTyp, accessResourceType())
	assert.True(t, model.IsPluginAccessControlPolicyType(accessResourceType()))
}

func TestGetAccessResourceID(t *testing.T) {
	t.Run("creates a valid ID once and caches it", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t)
		creates := 0
		store := &mockKVStore{}
		store.createAccessResourceIDFunc = func(id string) (bool, error) {
			creates++
			store.accessResourceID = id
			return true, nil
		}
		p.kvstore = store

		id, err := p.getAccessResourceID()
		require.NoError(t, err)
		assert.True(t, model.IsValidId(id), "expected a valid 26-char ID, got %q", id)
		assert.Len(t, id, 26)

		again, err := p.getAccessResourceID()
		require.NoError(t, err)
		assert.Equal(t, id, again)
		assert.Equal(t, 1, creates)
	})

	t.Run("reuses an existing ID without creating", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t)
		p.kvstore = &mockKVStore{
			accessResourceID:           testResource,
			createAccessResourceIDFunc: func(string) (bool, error) { t.Fatal("must not create"); return false, nil },
		}

		id, err := p.getAccessResourceID()
		require.NoError(t, err)
		assert.Equal(t, testResource, id)
	})

	t.Run("loses the creation race and adopts the winner's ID", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t)
		reads := 0
		p.kvstore = &mockKVStore{
			getAccessResourceIDFunc: func() (string, error) {
				reads++
				if reads == 1 {
					return "", nil
				}
				return testResource, nil
			},
			createAccessResourceIDFunc: func(string) (bool, error) { return false, nil },
		}

		id, err := p.getAccessResourceID()
		require.NoError(t, err)
		assert.Equal(t, testResource, id)
	})

	t.Run("read error", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t)
		p.kvstore = &mockKVStore{getAccessResourceIDFunc: func() (string, error) { return "", errors.New("kv down") }}

		_, err := p.getAccessResourceID()
		require.Error(t, err)
	})

	t.Run("create error", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t)
		p.kvstore = &mockKVStore{createAccessResourceIDFunc: func(string) (bool, error) { return false, errors.New("kv down") }}

		_, err := p.getAccessResourceID()
		require.Error(t, err)
	})
}

func TestUserHasAccess(t *testing.T) {
	noPolicy := model.NewNoPolicyAccessDecision()

	tests := []struct {
		name     string
		decision *model.AccessDecision
		appErr   *model.AppError
		want     bool
	}{
		{name: "no policy allows", decision: &noPolicy, want: true},
		{name: "explicit allow", decision: &model.AccessDecision{Decision: true}, want: true},
		{name: "explicit deny", decision: &model.AccessDecision{Decision: false}, want: false},
		{name: "error denies", appErr: model.NewAppError("test", "err", nil, "boom", http.StatusInternalServerError), want: false},
		{name: "error with allow decision still denies", decision: &model.AccessDecision{Decision: true}, appErr: model.NewAppError("test", "err", nil, "boom", http.StatusInternalServerError), want: false},
		{name: "nil decision denies", decision: nil, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, api := newAccessTestPlugin(t)
			api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").Return(tt.decision, tt.appErr).Once()

			assert.Equal(t, tt.want, p.userHasAccess(testUserID))
		})
	}

	t.Run("resource ID failure denies without evaluating", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t)
		p.kvstore = &mockKVStore{getAccessResourceIDFunc: func() (string, error) { return "", errors.New("kv down") }}

		assert.False(t, p.userHasAccess(testUserID))
	})
}

func TestAccessControlRequiredMiddleware(t *testing.T) {
	t.Run("denied user gets 403 on gated routes", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").Return(&model.AccessDecision{Decision: false}, (*model.AppError)(nil))

		for _, route := range []struct{ method, path string }{
			{http.MethodGet, "/api/v1/schedules"},
			{http.MethodGet, "/api/v1/oauth/status"},
			{http.MethodPost, "/api/v1/incidents"},
			{http.MethodGet, "/api/v1/subscriptions"},
			{http.MethodPost, "/api/v1/webhook/setup"},
			{http.MethodPut, "/api/v1/notification-prefs"},
		} {
			w := doAccessRequest(p, route.method, route.path, testUserID, "{}")
			assert.Equal(t, http.StatusForbidden, w.Code, route.path)
			body := decodeBody(t, w)
			assert.Equal(t, "api.pagerduty.access.forbidden", body["id"], route.path)
			assert.NotEmpty(t, body["message"])
		}
	})

	t.Run("evaluation error denies", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").
			Return((*model.AccessDecision)(nil), model.NewAppError("test", "err", nil, "boom", http.StatusInternalServerError))

		w := doAccessRequest(p, http.MethodGet, "/api/v1/schedules", testUserID, "")
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("allowed user reaches the handler", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").Return(&model.AccessDecision{Decision: true}, (*model.AppError)(nil))

		w := doAccessRequest(p, http.MethodGet, "/api/v1/schedules", testUserID, "")
		assert.NotEqual(t, http.StatusForbidden, w.Code)
		assert.Equal(t, http.StatusUnauthorized, w.Code) // handler runs: user has no PagerDuty connection
	})

	t.Run("missing user header is 401 before any evaluation", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t)

		w := doAccessRequest(p, http.MethodGet, "/api/v1/schedules", "", "")
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("webhook is not ABAC gated", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t) // no EvaluateAccessControl expectation: a call would panic

		w := doAccessRequest(p, http.MethodPost, "/api/v1/webhook", "", "{}")
		assert.NotEqual(t, http.StatusForbidden, w.Code)
	})
}

func TestHandleGetAccess(t *testing.T) {
	tests := []struct {
		name     string
		decision *model.AccessDecision
		want     bool
	}{
		{name: "allowed", decision: &model.AccessDecision{Decision: true}, want: true},
		{name: "denied", decision: &model.AccessDecision{Decision: false}, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, api := newAccessTestPlugin(t)
			api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").Return(tt.decision, (*model.AppError)(nil))

			w := doAccessRequest(p, http.MethodGet, "/api/v1/access", testUserID, "")
			require.Equal(t, http.StatusOK, w.Code)
			assert.Equal(t, map[string]any{"allowed": tt.want}, decodeBody(t, w))
		})
	}

	t.Run("evaluation error is allowed false with 200", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").
			Return((*model.AccessDecision)(nil), model.NewAppError("test", "err", nil, "boom", http.StatusInternalServerError))

		w := doAccessRequest(p, http.MethodGet, "/api/v1/access", testUserID, "")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, map[string]any{"allowed": false}, decodeBody(t, w))
	})

	t.Run("requires authentication", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t)
		w := doAccessRequest(p, http.MethodGet, "/api/v1/access", "", "")
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

func TestAdminRoutesRequireSystemAdmin(t *testing.T) {
	p, api := newAccessTestPlugin(t)
	mockAdmin(api)

	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/admin/access-policy"},
		{http.MethodPut, "/api/v1/admin/access-policy"},
		{http.MethodDelete, "/api/v1/admin/access-policy"},
		{http.MethodPost, "/api/v1/admin/access-policy/check"},
		{http.MethodPost, "/api/v1/admin/access-policy/visual-ast"},
		{http.MethodGet, "/api/v1/admin/access-policy/fields"},
		{http.MethodPost, "/api/v1/admin/access-policy/test-users"},
	} {
		w := doAccessRequest(p, route.method, route.path, testUserID, `{"expression":"true"}`)
		assert.Equal(t, http.StatusForbidden, w.Code, route.method+" "+route.path)
		assert.Equal(t, "api.pagerduty.access_policy.forbidden", decodeBody(t, w)["id"])

		w = doAccessRequest(p, route.method, route.path, "", `{"expression":"true"}`)
		assert.Equal(t, http.StatusUnauthorized, w.Code, route.method+" "+route.path)
	}
}

func TestAdminRoutesAreNotABACGated(t *testing.T) {
	p, api := newAccessTestPlugin(t)
	mockAdmin(api)
	// A denying policy must not lock the admin out of the policy routes.
	api.On("EvaluateAccessControl", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(&model.AccessDecision{Decision: false}, (*model.AppError)(nil)).Maybe()
	api.On("GetLicense").Return(&model.License{SkuShortName: model.LicenseShortSkuEnterpriseAdvanced})
	api.On("GetConfig").Return(abacConfig(true))
	api.On("GetAccessControlPolicy", testResource).Return((*model.AccessControlPolicy)(nil), model.NewAppError("t", "nf", nil, "", http.StatusNotFound))

	w := doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy", testAdminID, "")
	assert.Equal(t, http.StatusOK, w.Code)
	api.AssertNotCalled(t, "EvaluateAccessControl", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func abacConfig(enabled bool) *model.Config {
	cfg := &model.Config{}
	cfg.AccessControlSettings.EnableAttributeBasedAccessControl = model.NewPointer(enabled)
	return cfg
}

func TestHandleGetAccessPolicy(t *testing.T) {
	enterprise := &model.License{SkuShortName: model.LicenseShortSkuEnterpriseAdvanced}

	t.Run("available with policy", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("GetLicense").Return(enterprise)
		api.On("GetConfig").Return(abacConfig(true))
		api.On("GetAccessControlPolicy", testResource).Return(&model.AccessControlPolicy{
			ID:    testResource,
			Rules: []model.AccessControlPolicyRule{{Actions: []string{"view"}, Expression: `user.attributes.team == "sre"`}},
		}, (*model.AppError)(nil))

		w := doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy", testAdminID, "")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, map[string]any{
			"available":          true,
			"unavailable_reason": "",
			"has_policy":         true,
			"policy_unknown":     false,
			"expression":         `user.attributes.team == "sre"`,
		}, decodeBody(t, w))
	})

	t.Run("no policy when not found", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("GetLicense").Return(enterprise)
		api.On("GetConfig").Return(abacConfig(true))
		api.On("GetAccessControlPolicy", testResource).Return((*model.AccessControlPolicy)(nil), model.NewAppError("t", "nf", nil, "", http.StatusNotFound))

		w := doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy", testAdminID, "")
		require.Equal(t, http.StatusOK, w.Code)
		body := decodeBody(t, w)
		assert.Equal(t, false, body["has_policy"])
		assert.Equal(t, false, body["policy_unknown"])
		assert.Equal(t, "", body["expression"])
		assert.Equal(t, true, body["available"])
	})

	t.Run("policy unknown when engine not implemented", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("GetLicense").Return((*model.License)(nil))
		api.On("GetConfig").Return(abacConfig(true)).Maybe()
		api.On("GetAccessControlPolicy", testResource).Return((*model.AccessControlPolicy)(nil), model.NewAppError("t", "ni", nil, "", http.StatusNotImplemented))

		w := doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy", testAdminID, "")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, map[string]any{
			"available":          false,
			"unavailable_reason": "Attribute-based access control requires a Mattermost Enterprise Advanced or Entry license.",
			"has_policy":         false,
			"policy_unknown":     true,
			"expression":         "",
		}, decodeBody(t, w))
	})

	t.Run("unavailable without license", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("GetLicense").Return((*model.License)(nil))
		api.On("GetConfig").Return(abacConfig(true)).Maybe()
		api.On("GetAccessControlPolicy", testResource).Return((*model.AccessControlPolicy)(nil), model.NewAppError("t", "nf", nil, "", http.StatusNotFound))

		body := decodeBody(t, doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy", testAdminID, ""))
		assert.Equal(t, false, body["available"])
		assert.Contains(t, body["unavailable_reason"], "license")
	})

	t.Run("unavailable when setting is off", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("GetLicense").Return(enterprise)
		api.On("GetConfig").Return(abacConfig(false))
		api.On("GetAccessControlPolicy", testResource).Return((*model.AccessControlPolicy)(nil), model.NewAppError("t", "nf", nil, "", http.StatusNotFound))

		body := decodeBody(t, doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy", testAdminID, ""))
		assert.Equal(t, false, body["available"])
		assert.Contains(t, body["unavailable_reason"], "not enabled")
	})

	t.Run("other upstream errors pass through", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("GetLicense").Return(enterprise)
		api.On("GetConfig").Return(abacConfig(true))
		api.On("GetAccessControlPolicy", testResource).Return((*model.AccessControlPolicy)(nil), &model.AppError{Message: "db exploded", StatusCode: http.StatusInternalServerError})

		w := doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy", testAdminID, "")
		assert.Equal(t, http.StatusInternalServerError, w.Code)
		assert.Equal(t, "db exploded", decodeBody(t, w)["message"])
	})
}

func expectChangedEvent(api *plugintest.API) {
	api.On("PublishWebSocketEvent", "access_policy_changed", map[string]any{}, &model.WebsocketBroadcast{}).Return().Once()
}

func expectClusterInvalidation(api *plugintest.API) {
	api.On("PublishPluginClusterEvent",
		model.PluginClusterEvent{Id: clusterEventAccessCacheInvalidate},
		model.PluginClusterEventSendOptions{SendType: model.PluginClusterEventSendTypeReliable}).Return(nil).Once()
}

func expectAvailability(api *plugintest.API) {
	api.On("GetLicense").Return(&model.License{SkuShortName: model.LicenseShortSkuEnterpriseAdvanced})
	api.On("GetConfig").Return(abacConfig(true))
}

func TestHandleSaveAccessPolicy(t *testing.T) {
	t.Run("saves a v0.5 policy and publishes the websocket event", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("SaveAccessControlPolicy", testAdminID, mock.MatchedBy(func(policy *model.AccessControlPolicy) bool {
			return policy.ID == testResource &&
				policy.Type == testPluginTyp &&
				policy.Version == model.AccessControlPolicyVersionV0_5 &&
				policy.Active &&
				policy.Name != "" && len(policy.Name) <= model.MaxPolicyNameLength &&
				len(policy.Imports) == 0 && len(policy.Roles) == 0 && policy.Scope == "" &&
				len(policy.Rules) == 1 &&
				assert.ObjectsAreEqual([]string{"view"}, policy.Rules[0].Actions) &&
				policy.Rules[0].Expression == `user.attributes.team == "sre"`
		})).Return(&model.AccessControlPolicy{
			Rules: []model.AccessControlPolicyRule{{Actions: []string{"view"}, Expression: `user.attributes.team == "sre"`}},
		}, (*model.AppError)(nil)).Once()
		expectChangedEvent(api)
		expectClusterInvalidation(api)
		expectAvailability(api)

		w := doAccessRequest(p, http.MethodPut, "/api/v1/admin/access-policy", testAdminID, `{"expression":"  user.attributes.team == \"sre\"  "}`)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		body := decodeBody(t, w)
		assert.Equal(t, true, body["has_policy"])
		assert.Equal(t, `user.attributes.team == "sre"`, body["expression"])
		assert.Equal(t, false, body["policy_unknown"])
		api.AssertNumberOfCalls(t, "PublishWebSocketEvent", 1)
		api.AssertNotCalled(t, "GetAccessControlPolicy", mock.Anything)
	})

	t.Run("nil saved policy falls back to the request expression without re-reading", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("SaveAccessControlPolicy", testAdminID, mock.Anything).Return((*model.AccessControlPolicy)(nil), (*model.AppError)(nil)).Once()
		expectChangedEvent(api)
		expectClusterInvalidation(api)
		expectAvailability(api)

		w := doAccessRequest(p, http.MethodPut, "/api/v1/admin/access-policy", testAdminID, `{"expression":"true"}`)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		body := decodeBody(t, w)
		assert.Equal(t, true, body["has_policy"])
		assert.Equal(t, "true", body["expression"])
		api.AssertNotCalled(t, "GetAccessControlPolicy", mock.Anything)
	})

	t.Run("empty expression is 400", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)

		for _, body := range []string{`{"expression":""}`, `{"expression":"   "}`, `{}`} {
			w := doAccessRequest(p, http.MethodPut, "/api/v1/admin/access-policy", testAdminID, body)
			assert.Equal(t, http.StatusBadRequest, w.Code, body)
		}
		api.AssertNotCalled(t, "SaveAccessControlPolicy", mock.Anything, mock.Anything)
	})

	t.Run("invalid body is 400", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)

		w := doAccessRequest(p, http.MethodPut, "/api/v1/admin/access-policy", testAdminID, `not json`)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("upstream validation failure passes through and publishes nothing", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("SaveAccessControlPolicy", testAdminID, mock.Anything).
			Return((*model.AccessControlPolicy)(nil), &model.AppError{Message: "expression is invalid", StatusCode: http.StatusUnprocessableEntity})

		w := doAccessRequest(p, http.MethodPut, "/api/v1/admin/access-policy", testAdminID, `{"expression":"bogus"}`)
		assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
		assert.Equal(t, "expression is invalid", decodeBody(t, w)["message"])
		api.AssertNotCalled(t, "PublishWebSocketEvent", mock.Anything, mock.Anything, mock.Anything)
	})
}

func TestHandleDeleteAccessPolicy(t *testing.T) {
	t.Run("deletes and publishes the websocket event", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("DeleteAccessControlPolicy", testAdminID, testPluginTyp, testResource).Return((*model.AppError)(nil)).Once()
		expectChangedEvent(api)
		expectClusterInvalidation(api)
		expectAvailability(api)

		w := doAccessRequest(p, http.MethodDelete, "/api/v1/admin/access-policy", testAdminID, "")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		body := decodeBody(t, w)
		assert.Equal(t, false, body["has_policy"])
		assert.Equal(t, "", body["expression"])
		api.AssertNumberOfCalls(t, "PublishWebSocketEvent", 1)
		api.AssertNotCalled(t, "GetAccessControlPolicy", mock.Anything)
	})

	t.Run("engine not implemented is an error, rule remains, nothing published", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("DeleteAccessControlPolicy", testAdminID, testPluginTyp, testResource).
			Return(model.NewAppError("t", "ni", nil, "", http.StatusNotImplemented)).Once()

		w := doAccessRequest(p, http.MethodDelete, "/api/v1/admin/access-policy", testAdminID, "")
		require.Equal(t, http.StatusNotImplemented, w.Code)
		body := decodeBody(t, w)
		assert.Equal(t, "api.pagerduty.access_policy.error", body["id"])
		assert.Contains(t, body["message"], "not available on this server")
		assert.Contains(t, body["message"], "still in place")
		api.AssertNotCalled(t, "PublishWebSocketEvent", mock.Anything, mock.Anything, mock.Anything)
		api.AssertNotCalled(t, "PublishPluginClusterEvent", mock.Anything, mock.Anything)
	})

	t.Run("deleting when none exists succeeds", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("DeleteAccessControlPolicy", testAdminID, testPluginTyp, testResource).
			Return(model.NewAppError("t", "nf", nil, "", http.StatusNotFound)).Once()
		expectChangedEvent(api)
		expectClusterInvalidation(api)
		expectAvailability(api)

		w := doAccessRequest(p, http.MethodDelete, "/api/v1/admin/access-policy", testAdminID, "")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, false, decodeBody(t, w)["has_policy"])
	})

	t.Run("other errors pass through and publish nothing", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("DeleteAccessControlPolicy", testAdminID, testPluginTyp, testResource).
			Return(&model.AppError{Message: "nope", StatusCode: http.StatusForbidden}).Once()

		w := doAccessRequest(p, http.MethodDelete, "/api/v1/admin/access-policy", testAdminID, "")
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Equal(t, "nope", decodeBody(t, w)["message"])
		api.AssertNotCalled(t, "PublishWebSocketEvent", mock.Anything, mock.Anything, mock.Anything)
	})
}

func TestHandleCheckAccessExpression(t *testing.T) {
	t.Run("valid expression returns an empty array", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("CheckAccessControlExpression", testAdminID, testPluginTyp, "true").Return([]model.CELExpressionError(nil), (*model.AppError)(nil))

		w := doAccessRequest(p, http.MethodPost, "/api/v1/admin/access-policy/check", testAdminID, `{"expression":"true"}`)
		require.Equal(t, http.StatusOK, w.Code)
		assert.JSONEq(t, `{"errors":[]}`, w.Body.String())
	})

	t.Run("expression errors are returned", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("CheckAccessControlExpression", testAdminID, testPluginTyp, "bad").
			Return([]model.CELExpressionError{{Line: 1, Column: 2, Message: "oops"}}, (*model.AppError)(nil))

		w := doAccessRequest(p, http.MethodPost, "/api/v1/admin/access-policy/check", testAdminID, `{"expression":"bad"}`)
		require.Equal(t, http.StatusOK, w.Code)
		assert.JSONEq(t, `{"errors":[{"line":1,"column":2,"message":"oops"}]}`, w.Body.String())
	})

	t.Run("upstream error passes through", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("CheckAccessControlExpression", testAdminID, testPluginTyp, "x").
			Return([]model.CELExpressionError(nil), &model.AppError{Message: "license", StatusCode: http.StatusNotImplemented})

		w := doAccessRequest(p, http.MethodPost, "/api/v1/admin/access-policy/check", testAdminID, `{"expression":"x"}`)
		assert.Equal(t, http.StatusNotImplemented, w.Code)
	})
}

func TestHandleAccessVisualAST(t *testing.T) {
	p, api := newAccessTestPlugin(t)
	mockAdmin(api)
	ast := &model.VisualExpression{}
	api.On("GetAccessControlVisualAST", testAdminID, testPluginTyp, "true").Return(ast, (*model.AppError)(nil))

	w := doAccessRequest(p, http.MethodPost, "/api/v1/admin/access-policy/visual-ast", testAdminID, `{"expression":"true"}`)
	require.Equal(t, http.StatusOK, w.Code)
	expected, err := json.Marshal(ast)
	require.NoError(t, err)
	assert.JSONEq(t, string(expected), w.Body.String())

	api.On("GetAccessControlVisualAST", testAdminID, testPluginTyp, "bad").
		Return((*model.VisualExpression)(nil), &model.AppError{Message: "cannot parse", StatusCode: http.StatusBadRequest})
	w = doAccessRequest(p, http.MethodPost, "/api/v1/admin/access-policy/visual-ast", testAdminID, `{"expression":"bad"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandleAccessFields(t *testing.T) {
	t.Run("passes after and limit and returns the fields", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("GetAccessControlFieldsAutocomplete", testAdminID, "cursor", 10).
			Return([]*model.PropertyField{{ID: "f1", Name: "team"}}, (*model.AppError)(nil))

		w := doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy/fields?after=cursor&limit=10", testAdminID, "")
		require.Equal(t, http.StatusOK, w.Code)
		var fields []map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &fields))
		require.Len(t, fields, 1)
		assert.Equal(t, "f1", fields[0]["id"])
	})

	t.Run("nil result is an empty array and limit has a default", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("GetAccessControlFieldsAutocomplete", testAdminID, "", accessDefaultLimit).
			Return([]*model.PropertyField(nil), (*model.AppError)(nil))

		w := doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy/fields", testAdminID, "")
		require.Equal(t, http.StatusOK, w.Code)
		assert.JSONEq(t, `[]`, w.Body.String())
	})

	t.Run("limit is capped and invalid limit is 400", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("GetAccessControlFieldsAutocomplete", testAdminID, "", accessMaxLimit).
			Return([]*model.PropertyField(nil), (*model.AppError)(nil))

		w := doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy/fields?limit=100000", testAdminID, "")
		assert.Equal(t, http.StatusOK, w.Code)

		w = doAccessRequest(p, http.MethodGet, "/api/v1/admin/access-policy/fields?limit=abc", testAdminID, "")
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestHandleAccessTestUsers(t *testing.T) {
	t.Run("proxies the query", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		resp := &model.AccessControlPolicyTestResponse{Users: []*model.User{{Id: "u1", Username: "alice"}}, Total: 1}
		api.On("QueryUsersForAccessControlExpression", testAdminID, testPluginTyp, "true", "ali", "cursor", 20).
			Return(resp, (*model.AppError)(nil))

		w := doAccessRequest(p, http.MethodPost, "/api/v1/admin/access-policy/test-users", testAdminID,
			`{"expression":"true","term":"ali","after":"cursor","limit":20}`)
		require.Equal(t, http.StatusOK, w.Code)
		body := decodeBody(t, w)
		assert.EqualValues(t, 1, body["total"])
		assert.Len(t, body["users"], 1)
	})

	t.Run("defaults the limit and passes errors through", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		api.On("QueryUsersForAccessControlExpression", testAdminID, testPluginTyp, "bad", "", "", accessDefaultLimit).
			Return((*model.AccessControlPolicyTestResponse)(nil), &model.AppError{Message: "bad expression", StatusCode: http.StatusBadRequest})

		w := doAccessRequest(p, http.MethodPost, "/api/v1/admin/access-policy/test-users", testAdminID, `{"expression":"bad"}`)
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Equal(t, "bad expression", decodeBody(t, w)["message"])
	})

	t.Run("invalid body is 400", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)

		w := doAccessRequest(p, http.MethodPost, "/api/v1/admin/access-policy/test-users", testAdminID, `nope`)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestExecuteCommandAccessControl(t *testing.T) {
	t.Run("denied user is refused and nothing runs", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").Return(&model.AccessDecision{Decision: false}, (*model.AppError)(nil))

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{Command: "/pagerduty notify on", UserId: testUserID})
		require.Nil(t, appErr)
		assert.Equal(t, model.CommandResponseTypeEphemeral, resp.ResponseType)
		assert.Contains(t, resp.Text, "do not have access")
	})

	t.Run("evaluation error is refused", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").
			Return((*model.AccessDecision)(nil), model.NewAppError("t", "err", nil, "boom", http.StatusInternalServerError))

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{Command: "/pagerduty help", UserId: testUserID})
		require.Nil(t, appErr)
		assert.Contains(t, resp.Text, "do not have access")
	})

	t.Run("allowed user runs the command", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").Return(&model.AccessDecision{Decision: true}, (*model.AppError)(nil))

		resp, appErr := p.ExecuteCommand(nil, &model.CommandArgs{Command: "/pagerduty help", UserId: testUserID})
		require.Nil(t, appErr)
		assert.Contains(t, resp.Text, "PagerDuty Plugin Commands")
	})
}

func fixedClock(now *time.Time) func() time.Time {
	return func() time.Time { return *now }
}

func allowDecision(api *plugintest.API, times int) {
	api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").
		Return(&model.AccessDecision{Decision: true}, (*model.AppError)(nil)).Times(times)
}

func TestAccessDecisionCache(t *testing.T) {
	t.Run("hit avoids a second evaluation", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		now := time.Now()
		p.accessClock = fixedClock(&now)
		allowDecision(api, 1)

		assert.True(t, p.userHasAccess(testUserID))
		assert.True(t, p.userHasAccess(testUserID))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 1)
	})

	t.Run("denials and no-policy allows from real decisions are cached", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		now := time.Now()
		p.accessClock = fixedClock(&now)
		noPolicy := model.NewNoPolicyAccessDecision()
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").
			Return(&model.AccessDecision{Decision: false}, (*model.AppError)(nil)).Once()
		api.On("EvaluateAccessControl", "other", testPluginTyp, testResource, "view").
			Return(&noPolicy, (*model.AppError)(nil)).Once()

		assert.False(t, p.userHasAccess(testUserID))
		assert.False(t, p.userHasAccess(testUserID))
		assert.True(t, p.userHasAccess("other"))
		assert.True(t, p.userHasAccess("other"))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 2)
	})

	t.Run("expiry re-evaluates", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		now := time.Now()
		p.accessClock = fixedClock(&now)
		allowDecision(api, 2)

		assert.True(t, p.userHasAccess(testUserID))
		now = now.Add(accessDecisionTTL - time.Second)
		assert.True(t, p.userHasAccess(testUserID))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 1)

		now = now.Add(2 * time.Second)
		assert.True(t, p.userHasAccess(testUserID))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 2)
	})

	t.Run("errors and nil decisions are not cached", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		now := time.Now()
		p.accessClock = fixedClock(&now)
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").
			Return((*model.AccessDecision)(nil), model.NewAppError("t", "err", nil, "boom", http.StatusInternalServerError)).Once()
		api.On("EvaluateAccessControl", testUserID, testPluginTyp, testResource, "view").
			Return((*model.AccessDecision)(nil), (*model.AppError)(nil)).Once()
		allowDecision(api, 1)

		assert.False(t, p.userHasAccess(testUserID))
		assert.False(t, p.userHasAccess(testUserID))
		assert.True(t, p.userHasAccess(testUserID))
		assert.True(t, p.userHasAccess(testUserID))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 3)
		assert.Equal(t, 1, p.accessCache.len())
	})

	t.Run("resource ID failures are not cached", func(t *testing.T) {
		p, _ := newAccessTestPlugin(t)
		p.kvstore = &mockKVStore{getAccessResourceIDFunc: func() (string, error) { return "", errors.New("kv down") }}

		assert.False(t, p.userHasAccess(testUserID))
		assert.Equal(t, 0, p.accessCache.len())
	})

	t.Run("save and delete invalidate the cache", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		mockAdmin(api)
		now := time.Now()
		p.accessClock = fixedClock(&now)
		allowDecision(api, 3)
		api.On("SaveAccessControlPolicy", testAdminID, mock.Anything).Return(&model.AccessControlPolicy{}, (*model.AppError)(nil)).Once()
		api.On("DeleteAccessControlPolicy", testAdminID, testPluginTyp, testResource).Return((*model.AppError)(nil)).Once()
		api.On("PublishWebSocketEvent", "access_policy_changed", map[string]any{}, &model.WebsocketBroadcast{}).Return().Twice()
		api.On("PublishPluginClusterEvent", mock.Anything, mock.Anything).Return(nil).Twice()
		api.On("GetLicense").Return(&model.License{SkuShortName: model.LicenseShortSkuEnterpriseAdvanced}).Twice()
		api.On("GetConfig").Return(abacConfig(true)).Twice()

		assert.True(t, p.userHasAccess(testUserID))
		assert.True(t, p.userHasAccess(testUserID))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 1)

		w := doAccessRequest(p, http.MethodPut, "/api/v1/admin/access-policy", testAdminID, `{"expression":"true"}`)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.True(t, p.userHasAccess(testUserID))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 2)

		w = doAccessRequest(p, http.MethodDelete, "/api/v1/admin/access-policy", testAdminID, "")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.True(t, p.userHasAccess(testUserID))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 3)
	})

	t.Run("cluster event invalidates the cache", func(t *testing.T) {
		p, api := newAccessTestPlugin(t)
		now := time.Now()
		p.accessClock = fixedClock(&now)
		allowDecision(api, 2)

		assert.True(t, p.userHasAccess(testUserID))
		p.OnPluginClusterEvent(nil, model.PluginClusterEvent{Id: "something_else"})
		assert.True(t, p.userHasAccess(testUserID))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 1)

		p.OnPluginClusterEvent(nil, model.PluginClusterEvent{Id: clusterEventAccessCacheInvalidate})
		assert.True(t, p.userHasAccess(testUserID))
		api.AssertNumberOfCalls(t, "EvaluateAccessControl", 2)
	})

	t.Run("a decision computed before an invalidation is not stored", func(t *testing.T) {
		var c accessDecisionCache
		now := time.Now()
		_, _, gen := c.get(testUserID, now)
		c.clear()
		c.set(testUserID, true, now, gen)
		assert.Equal(t, 0, c.len())
	})

	t.Run("size is bounded and expired entries are dropped", func(t *testing.T) {
		var c accessDecisionCache
		now := time.Now()
		for i := range accessDecisionCacheMaxEntries {
			c.set(fmt.Sprintf("u%d", i), true, now, 0)
		}
		assert.Equal(t, accessDecisionCacheMaxEntries, c.len())

		later := now.Add(accessDecisionTTL + time.Second)
		c.set("fresh", true, later, 0)
		assert.Equal(t, 1, c.len())

		for i := range accessDecisionCacheMaxEntries + 5 {
			c.set(fmt.Sprintf("v%d", i), true, later, 0)
		}
		assert.LessOrEqual(t, c.len(), accessDecisionCacheMaxEntries)
	})
}
