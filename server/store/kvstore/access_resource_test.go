// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package kvstore

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAccessResourceID(t *testing.T) {
	t.Run("create is an atomic set-if-absent", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)
		api.On("KVSetWithOptions", "pagerduty_access_resource_id", []byte(`"abc"`), model.PluginKVSetOptions{Atomic: true}).
			Return(true, (*model.AppError)(nil)).Once()
		store := NewKVStore(pluginapi.NewClient(api, nil))

		written, err := store.CreateAccessResourceID("abc")
		require.NoError(t, err)
		assert.True(t, written)
	})

	t.Run("create reports a lost race", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)
		api.On("KVSetWithOptions", "pagerduty_access_resource_id", []byte(`"abc"`), model.PluginKVSetOptions{Atomic: true}).
			Return(false, (*model.AppError)(nil)).Once()
		store := NewKVStore(pluginapi.NewClient(api, nil))

		written, err := store.CreateAccessResourceID("abc")
		require.NoError(t, err)
		assert.False(t, written)
	})

	t.Run("get returns the stored ID or empty", func(t *testing.T) {
		api := &plugintest.API{}
		defer api.AssertExpectations(t)
		api.On("KVGet", "pagerduty_access_resource_id").Return([]byte(`"abc"`), (*model.AppError)(nil)).Once()
		api.On("KVGet", "pagerduty_access_resource_id").Return([]byte(nil), (*model.AppError)(nil)).Once()
		store := NewKVStore(pluginapi.NewClient(api, nil))

		id, err := store.GetAccessResourceID()
		require.NoError(t, err)
		assert.Equal(t, "abc", id)

		id, err = store.GetAccessResourceID()
		require.NoError(t, err)
		assert.Equal(t, "", id)
	})
}
