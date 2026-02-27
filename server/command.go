package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/pkg/errors"
)

const commandTrigger = "pagerduty"

// registerCommand registers the /pagerduty slash command.
func (p *Plugin) registerCommand() error {
	p.client.Log.Info("registerCommand: attempting to register /pagerduty slash command")

	// Optimistically unregister before registering to clear stale state,
	// following the pattern used by the Jira plugin.
	_ = p.client.SlashCommand.Unregister("", commandTrigger)

	cmd := &model.Command{
		Trigger:          commandTrigger,
		DisplayName:      "PagerDuty",
		Description:      "Manage PagerDuty notifications and channel subscriptions",
		AutoComplete:     true,
		AutoCompleteHint: "[subscribe|unsubscribe|list|notify|webhook]",
		AutoCompleteDesc: "PagerDuty integration commands",
	}

	if err := p.client.SlashCommand.Register(cmd); err != nil {
		p.client.Log.Error("registerCommand: RegisterCommand API call FAILED", "error", err, "trigger", commandTrigger)
		return err
	}

	p.client.Log.Info("registerCommand: RegisterCommand API call SUCCEEDED", "trigger", commandTrigger)
	return nil
}

// ExecuteCommand handles /pagerduty slash commands.
// The return type must be *model.AppError (not error) to match the Hooks interface
// exactly. The Mattermost plugin RPC layer uses reflection to check the method
// signature; returning plain error causes the hook to be treated as unimplemented.
func (p *Plugin) ExecuteCommand(_ *plugin.Context, args *model.CommandArgs) (*model.CommandResponse, *model.AppError) {
	p.client.Log.Info("ExecuteCommand: slash command received",
		"command", args.Command,
		"user_id", args.UserId,
		"channel_id", args.ChannelId,
	)

	resp, err := p.handleCommand(args)
	if err != nil {
		p.client.Log.Error("ExecuteCommand: internal error", "error", err)
		return ephemeral("An internal error occurred: " + err.Error()), nil
	}
	return resp, nil
}

// handleCommand dispatches the slash command to the appropriate subcommand handler.
func (p *Plugin) handleCommand(args *model.CommandArgs) (*model.CommandResponse, error) {
	parts := strings.Fields(args.Command)
	if len(parts) < 2 {
		return p.commandHelp(), nil
	}

	subcommand := parts[1]
	switch subcommand {
	case "subscribe":
		return p.executeSubscribe(args, parts[2:])
	case "unsubscribe":
		return p.executeUnsubscribe(args)
	case "list":
		return p.executeList(args)
	case "notify":
		return p.executeNotify(args, parts[2:])
	case "webhook":
		return p.executeWebhook(args, parts[2:])
	case "help":
		return p.commandHelp(), nil
	default:
		return p.commandHelp(), nil
	}
}

func (p *Plugin) commandHelp() *model.CommandResponse {
	text := `#### PagerDuty Plugin Commands

| Command | Description |
|---------|-------------|
| ` + "`/pagerduty subscribe [events] [--service ID]`" + ` | Subscribe this channel to PagerDuty events |
| ` + "`/pagerduty unsubscribe`" + ` | Unsubscribe this channel from PagerDuty events |
| ` + "`/pagerduty list`" + ` | Show this channel's subscription details |
| ` + "`/pagerduty notify on`" + ` | Enable personal on-call DM notifications |
| ` + "`/pagerduty notify off`" + ` | Disable personal on-call DM notifications |
| ` + "`/pagerduty notify status`" + ` | Show your notification preferences |
| ` + "`/pagerduty webhook setup`" + ` | Register PagerDuty webhook (admin only) |
| ` + "`/pagerduty webhook status`" + ` | Show webhook registration status |
| ` + "`/pagerduty webhook teardown`" + ` | Remove PagerDuty webhook (admin only) |

**Event types:** ` + "`incident.triggered`" + `, ` + "`incident.acknowledged`" + `, ` + "`incident.resolved`" + `, ` + "`incident.escalated`" + `, ` + "`oncall.change`" + `

**Examples:**
- ` + "`/pagerduty subscribe`" + ` — Subscribe with default events (all incident events + on-call changes)
- ` + "`/pagerduty subscribe incident.triggered,incident.resolved`" + ` — Subscribe to specific events
- ` + "`/pagerduty subscribe --service PSERVICE1`" + ` — Subscribe filtered to a specific service`
	return &model.CommandResponse{
		ResponseType: model.CommandResponseTypeEphemeral,
		Text:         text,
	}
}

// --- Subscribe ---

func (p *Plugin) executeSubscribe(args *model.CommandArgs, params []string) (*model.CommandResponse, error) {
	eventTypes := AllEventTypes
	var serviceIDs []string

	// Parse parameters
	for i := 0; i < len(params); i++ {
		param := params[i]
		if param == "--service" && i+1 < len(params) {
			i++
			serviceIDs = append(serviceIDs, params[i])
		} else if !strings.HasPrefix(param, "--") {
			// Treat as comma-separated event types
			eventTypes = strings.Split(param, ",")
		}
	}

	// Validate event types
	for _, et := range eventTypes {
		if !isValidEventType(et) {
			return ephemeral(fmt.Sprintf("Unknown event type: `%s`. Valid types: %s", et, strings.Join(AllEventTypes, ", "))), nil
		}
	}

	sub := &ChannelSubscription{
		ChannelID:  args.ChannelId,
		CreatorID:  args.UserId,
		EventTypes: eventTypes,
		ServiceIDs: serviceIDs,
		CreatedAt:  time.Now(),
	}

	if err := p.saveSubscription(sub); err != nil {
		return ephemeral("Failed to save subscription: " + err.Error()), nil
	}

	msg := fmt.Sprintf(":white_check_mark: This channel is now subscribed to PagerDuty events: `%s`",
		strings.Join(eventTypes, "`, `"))
	if len(serviceIDs) > 0 {
		msg += fmt.Sprintf("\nFiltered to services: `%s`", strings.Join(serviceIDs, "`, `"))
	}

	return ephemeral(msg), nil
}

// --- Unsubscribe ---

func (p *Plugin) executeUnsubscribe(args *model.CommandArgs) (*model.CommandResponse, error) {
	if err := p.removeSubscription(args.ChannelId); err != nil {
		return ephemeral("Failed to unsubscribe: " + err.Error()), nil
	}

	return ephemeral(":white_check_mark: This channel has been unsubscribed from PagerDuty events."), nil
}

// --- List ---

func (p *Plugin) executeList(args *model.CommandArgs) (*model.CommandResponse, error) {
	sub, err := p.kvstore.GetChannelSubscription(args.ChannelId)
	if err != nil {
		return ephemeral("Failed to retrieve subscription: " + err.Error()), nil
	}

	if sub == nil {
		return ephemeral("This channel is not subscribed to any PagerDuty events. Use `/pagerduty subscribe` to set one up."), nil
	}

	msg := fmt.Sprintf("#### PagerDuty Subscription for this Channel\n**Event types:** `%s`",
		strings.Join(sub.EventTypes, "`, `"))
	if len(sub.ServiceIDs) > 0 {
		msg += fmt.Sprintf("\n**Service filter:** `%s`", strings.Join(sub.ServiceIDs, "`, `"))
	}
	msg += fmt.Sprintf("\n**Created:** %s", sub.CreatedAt.Format("Jan 2, 2006 3:04 PM MST"))

	return ephemeral(msg), nil
}

// --- Notify ---

func (p *Plugin) executeNotify(args *model.CommandArgs, params []string) (*model.CommandResponse, error) {
	if len(params) == 0 {
		return ephemeral("Usage: `/pagerduty notify [on|off|status]`"), nil
	}

	switch params[0] {
	case "on":
		prefs := AllEnabledNotificationPrefs()
		if err := p.kvstore.SetUserNotificationPrefs(args.UserId, prefs); err != nil {
			return ephemeral("Failed to save notification preferences: " + err.Error()), nil
		}
		return ephemeral(":white_check_mark: On-call DM notifications are now **enabled**. You'll receive DMs when:\n- You go on-call\n- Your shift ends\n- Your shift is starting soon (30 min reminder)\n- Someone takes your shift"), nil

	case "off":
		prefs := DefaultNotificationPrefs()
		if err := p.kvstore.SetUserNotificationPrefs(args.UserId, prefs); err != nil {
			return ephemeral("Failed to save notification preferences: " + err.Error()), nil
		}
		return ephemeral(":white_check_mark: On-call DM notifications are now **disabled**."), nil

	case "status":
		prefs, err := p.kvstore.GetUserNotificationPrefs(args.UserId)
		if err != nil {
			return ephemeral("Failed to retrieve notification preferences: " + err.Error()), nil
		}

		status := "disabled"
		if prefs.Enabled {
			status = "enabled"
		}

		msg := fmt.Sprintf("#### Your PagerDuty Notification Preferences\n**Notifications:** %s\n", status)
		if prefs.Enabled {
			msg += fmt.Sprintf("- On-call start: %s\n", boolEmoji(prefs.OnCallStart))
			msg += fmt.Sprintf("- On-call end: %s\n", boolEmoji(prefs.OnCallEnd))
			msg += fmt.Sprintf("- Shift reminder (30 min): %s\n", boolEmoji(prefs.ShiftReminder))
			msg += fmt.Sprintf("- Shift taken (override): %s\n", boolEmoji(prefs.ShiftTaken))
		}

		return ephemeral(msg), nil

	default:
		return ephemeral("Usage: `/pagerduty notify [on|off|status]`"), nil
	}
}

// --- Webhook ---

func (p *Plugin) executeWebhook(args *model.CommandArgs, params []string) (*model.CommandResponse, error) {
	if len(params) == 0 {
		return ephemeral("Usage: `/pagerduty webhook [setup|status|teardown]`"), nil
	}

	switch params[0] {
	case "setup":
		return p.executeWebhookSetup(args)
	case "status":
		return p.executeWebhookStatus()
	case "teardown":
		return p.executeWebhookTeardown(args)
	default:
		return ephemeral("Usage: `/pagerduty webhook [setup|status|teardown]`"), nil
	}
}

func (p *Plugin) executeWebhookSetup(args *model.CommandArgs) (*model.CommandResponse, error) {
	if !p.isUserSystemAdmin(args.UserId) {
		return ephemeral("Only system administrators can set up the PagerDuty webhook."), nil
	}

	// Check if a webhook is already registered
	existing, err := p.kvstore.GetWebhookRegistration()
	if err == nil && existing != nil {
		return ephemeral(fmt.Sprintf("A PagerDuty webhook is already registered (ID: `%s`). Run `/pagerduty webhook teardown` first to remove it.", existing.SubscriptionID)), nil
	}

	// Get user's PD client
	pdClient, clientErr := p.getPagerDutyClientForUser(args.UserId)
	if clientErr != nil {
		return ephemeral("Please connect your PagerDuty account first. Click the PagerDuty icon in the channel header."), nil
	}

	// Generate a random secret for HMAC verification
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		return ephemeral("Failed to generate webhook secret: " + err.Error()), nil
	}
	secret := hex.EncodeToString(secretBytes)

	// Build the webhook URL
	webhookURL := fmt.Sprintf("%s/plugins/%s/api/v1/webhook", p.siteURL, pluginID)

	// Webhook event types to subscribe to
	events := IncidentEventTypes

	// Create the webhook subscription in PagerDuty
	result, createErr := pdClient.CreateWebhookSubscription(
		webhookURL,
		secret,
		"Mattermost PagerDuty Plugin",
		events,
		"account_reference",
		"",
	)
	if createErr != nil {
		p.client.Log.Error("Failed to create PagerDuty webhook subscription", "error", createErr.Error())
		return ephemeral("Failed to create webhook subscription in PagerDuty: " + createErr.Error()), nil
	}

	// Store the registration
	reg := &WebhookRegistration{
		SubscriptionID: result.ID,
		Secret:         secret,
		CreatedBy:      args.UserId,
		CreatedAt:      time.Now(),
	}
	if err := p.kvstore.SetWebhookRegistration(reg); err != nil {
		return ephemeral("Webhook created in PagerDuty but failed to save registration locally: " + err.Error()), nil
	}

	p.client.Log.Info("PagerDuty webhook subscription created",
		"subscription_id", result.ID,
		"url", webhookURL,
		"created_by", args.UserId,
	)

	return ephemeral(fmt.Sprintf(":white_check_mark: PagerDuty webhook registered successfully!\n**Subscription ID:** `%s`\n**Webhook URL:** `%s`\n**Events:** `%s`",
		result.ID, webhookURL, strings.Join(events, "`, `"))), nil
}

func (p *Plugin) executeWebhookStatus() (*model.CommandResponse, error) {
	reg, err := p.kvstore.GetWebhookRegistration()
	if err != nil || reg == nil {
		return ephemeral("No PagerDuty webhook is currently configured. Run `/pagerduty webhook setup` to register one."), nil
	}

	msg := fmt.Sprintf("#### PagerDuty Webhook Status\n**Status:** Active\n**Subscription ID:** `%s`\n**Created:** %s",
		reg.SubscriptionID,
		reg.CreatedAt.Format("Jan 2, 2006 3:04 PM MST"))

	return ephemeral(msg), nil
}

func (p *Plugin) executeWebhookTeardown(args *model.CommandArgs) (*model.CommandResponse, error) {
	if !p.isUserSystemAdmin(args.UserId) {
		return ephemeral("Only system administrators can remove the PagerDuty webhook."), nil
	}

	reg, err := p.kvstore.GetWebhookRegistration()
	if err != nil || reg == nil {
		return ephemeral("No PagerDuty webhook is currently configured."), nil
	}

	// Try to delete the webhook subscription in PagerDuty
	pdClient, clientErr := p.getPagerDutyClientForUser(args.UserId)
	if clientErr == nil {
		if delErr := pdClient.DeleteWebhookSubscription(reg.SubscriptionID); delErr != nil {
			p.client.Log.Warn("Failed to delete PagerDuty webhook subscription (may already be removed)", "error", delErr.Error())
		}
	}

	// Always remove local registration
	if err := p.kvstore.DeleteWebhookRegistration(); err != nil {
		return ephemeral("Failed to remove webhook registration: " + err.Error()), nil
	}

	p.client.Log.Info("PagerDuty webhook subscription removed",
		"subscription_id", reg.SubscriptionID,
		"removed_by", args.UserId,
	)

	return ephemeral(":white_check_mark: PagerDuty webhook has been removed."), nil
}

// --- Subscription Helpers ---

// saveSubscription stores a channel subscription and updates the index.
func (p *Plugin) saveSubscription(sub *ChannelSubscription) error {
	if err := p.kvstore.SetChannelSubscription(sub); err != nil {
		return errors.Wrap(err, "failed to save channel subscription")
	}

	// Update the index
	index, err := p.kvstore.GetSubscriptionIndex()
	if err != nil {
		index = []string{}
	}

	// Add to index if not already present
	found := false
	for _, id := range index {
		if id == sub.ChannelID {
			found = true
			break
		}
	}
	if !found {
		index = append(index, sub.ChannelID)
		if err := p.kvstore.SetSubscriptionIndex(index); err != nil {
			return errors.Wrap(err, "failed to update subscription index")
		}
	}

	return nil
}

// removeSubscription removes a channel subscription and updates the index.
func (p *Plugin) removeSubscription(channelID string) error {
	if err := p.kvstore.DeleteChannelSubscription(channelID); err != nil {
		return errors.Wrap(err, "failed to delete channel subscription")
	}

	// Update the index
	index, err := p.kvstore.GetSubscriptionIndex()
	if err != nil {
		return nil // Index not found is fine
	}

	newIndex := make([]string, 0, len(index))
	for _, id := range index {
		if id != channelID {
			newIndex = append(newIndex, id)
		}
	}

	if err := p.kvstore.SetSubscriptionIndex(newIndex); err != nil {
		return errors.Wrap(err, "failed to update subscription index")
	}

	return nil
}

// --- Utility Helpers ---

func ephemeral(text string) *model.CommandResponse {
	return &model.CommandResponse{
		ResponseType: model.CommandResponseTypeEphemeral,
		Text:         text,
	}
}

func isValidEventType(eventType string) bool {
	for _, et := range AllEventTypes {
		if et == eventType {
			return true
		}
	}
	// Also accept reassigned
	return eventType == EventIncidentReassigned
}

func boolEmoji(b bool) string {
	if b {
		return "enabled"
	}
	return "disabled"
}
