package main

import (
	"fmt"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/pkg/errors"
)

const (
	botUsername    = "pagerduty"
	botDisplayName = "PagerDuty"
	botDescription = "PagerDuty notifications bot"
)

// ensureBot registers or retrieves the PagerDuty bot account.
func (p *Plugin) ensureBot() error {
	botID, err := p.client.Bot.EnsureBot(&model.Bot{
		Username:    botUsername,
		DisplayName: botDisplayName,
		Description: botDescription,
	}, pluginapi.ProfileImagePath("assets/profile.png"))
	if err != nil {
		return errors.Wrap(err, "failed to ensure PagerDuty bot")
	}

	p.botID = botID
	return nil
}

// dmUser sends a direct message from the bot to a Mattermost user.
func (p *Plugin) dmUser(userID, message string) error {
	channel, err := p.client.Channel.GetDirect(userID, p.botID)
	if err != nil {
		return errors.Wrap(err, "failed to get DM channel")
	}

	post := &model.Post{
		UserId:    p.botID,
		ChannelId: channel.Id,
		Message:   message,
	}

	if err := p.client.Post.CreatePost(post); err != nil {
		return errors.Wrap(err, "failed to create DM post")
	}

	return nil
}

// postToChannel sends a message from the bot to a Mattermost channel.
func (p *Plugin) postToChannel(channelID, message string) error {
	post := &model.Post{
		UserId:    p.botID,
		ChannelId: channelID,
		Message:   message,
	}

	if err := p.client.Post.CreatePost(post); err != nil {
		return errors.Wrap(err, "failed to create channel post")
	}

	return nil
}

// getMattermostUserByEmail looks up a Mattermost user by their email address.
// Returns nil if no user is found.
func (p *Plugin) getMattermostUserByEmail(email string) *model.User {
	user, err := p.client.User.GetByEmail(email)
	if err != nil {
		p.client.Log.Debug("Could not find Mattermost user by email", "email", email, "error", err.Error())
		return nil
	}
	return user
}

// isUserSystemAdmin checks whether a Mattermost user has system admin role.
func (p *Plugin) isUserSystemAdmin(userID string) bool {
	user, err := p.client.User.Get(userID)
	if err != nil {
		p.client.Log.Error("Failed to get user for admin check", "user_id", userID, "error", err.Error())
		return false
	}
	return user.IsSystemAdmin()
}

// getConnectedAdminUserID returns the Mattermost user ID of a connected admin
// that can be used for background PagerDuty API calls. It first tries the webhook
// creator, then falls back to any system admin with a connected PD account.
func (p *Plugin) getConnectedAdminUserID() (string, error) {
	// First try the webhook creator
	reg, err := p.kvstore.GetWebhookRegistration()
	if err == nil && reg != nil {
		token, tokenErr := p.kvstore.GetUserToken(reg.CreatedBy)
		if tokenErr == nil && token != nil {
			return reg.CreatedBy, nil
		}
	}

	// If no webhook creator or their token is gone, we can't easily enumerate users.
	// Return an error to indicate no admin is available.
	return "", fmt.Errorf("no connected admin user found; run /pagerduty webhook setup")
}
