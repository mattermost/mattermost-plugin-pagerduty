# Mattermost PagerDuty Plugin

[![Build Status](https://github.com/svelle/mattermost-pagerduty-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/svelle/mattermost-pagerduty-plugin/actions/workflows/ci.yml)

## Overview

The Mattermost PagerDuty Plugin integrates PagerDuty with Mattermost, allowing teams to view on-call schedules and current on-call users directly within Mattermost. This plugin provides quick access to PagerDuty information through a convenient sidebar interface, real-time incident notifications, and on-call change alerts.

## Features

### Core Functionality
- **Tabbed Navigation**: Three main views — On-Call, Schedules, and Incidents — accessible via sidebar tabs
- **Schedule Browser**: View all PagerDuty schedules in a clean, organized list with Mine/All filtering
- **Timeline View**: Click any schedule to see a detailed 48-hour timeline showing:
  - Who's currently on-call (highlighted with special styling)
  - Upcoming shifts with countdown timers
  - Smooth transitions between on-call personnel
- **Incident Management**: View, acknowledge, resolve, and add notes to incidents directly from Mattermost
- **Direct Paging**: Page the current on-call person directly from the schedule view
- **Schedule Overrides**: Create temporary schedule overrides to cover shifts
- **Right-Hand Sidebar**: Dedicated sidebar accessible via channel header button
- **Background Monitoring**: Automatic on-call change detection with configurable notifications
- **Secure Authentication**: Per-user OAuth tokens with automatic refresh, stored securely and never exposed in the UI

### User Interface
- **Tabbed Layout**: On-Call, Schedules, and Incidents tabs for quick access to different views
- **Mine/All Filter**: Toggle between viewing all schedules or only those where you're on-call
- **Visual Indicators**: Current on-call person prominently displayed with colored background and badges
- **Relative Time Display**: Shows human-friendly time format ("2h 30m remaining", "Starts in 1d 4h")
- **Paging Interface**: One-click paging with incident creation dialog
- **Settings Panel**: Gear icon to manage notification preferences and channel subscriptions in-sidebar
- **Responsive Design**: Clean layout that works well in the Mattermost sidebar
- **Theme Support**: Automatically adapts to your Mattermost theme (light/dark)
- **Enhanced Styling**: Comprehensive CSS classes for customization

### Notifications & Events
- **PagerDuty Webhooks**: Receive real-time incident notifications via PagerDuty V3 webhooks with HMAC-SHA256 signature verification
- **Channel Subscriptions**: Subscribe channels to specific PagerDuty events (incident triggered/acknowledged/resolved/escalated, on-call changes)
- **Service Filtering**: Filter channel subscriptions to specific PagerDuty services
- **On-Call DM Notifications**: Optional personal DMs when you go on/off-call, shift reminders (30 min), and override alerts
- **On-Call Change Detection**: Background monitoring detects on-call changes and notifies subscribed channels and users
- **Slash Commands**: Full `/pagerduty` command suite for managing subscriptions and notifications

### Configuration
- **PagerDuty OAuth**: Per-user OAuth integration with PagerDuty
- **Custom API URL**: Support for self-hosted or regional PagerDuty instances
- **Webhook Auto-Registration**: One-command setup to register PagerDuty webhook subscriptions

## Requirements

- Mattermost Server v6.2.1 or higher
- PagerDuty account with API access
- PagerDuty OAuth application (Scoped OAuth)

## Installation

1. Download the latest plugin file from the [releases page](https://github.com/svelle/mattermost-pagerduty-plugin/releases)
2. In Mattermost, go to **System Console > Plugins > Plugin Management**
3. Upload the plugin file
4. Enable the plugin

## Configuration

### Step 1: Create a PagerDuty OAuth Application

1. Go to https://developer.pagerduty.com/apps and click **Create New App**
2. Set the app name (e.g., "Mattermost PagerDuty Plugin")
3. Under **OAuth 2.0** settings, configure:
   - **Redirect URL**: `https://<YOUR_MATTERMOST_URL>/plugins/com.svelle.pagerduty-plugin/api/v1/oauth/callback`
   - **Grant Type**: Authorization Code
   - **Scopes** (enable all of these):
     - `incidents.read`
     - `incidents.write`
     - `oncalls.read`
     - `schedules.read`
     - `services.read`
     - `users.read`
     - `webhook_subscriptions.read` (required for webhook setup)
     - `webhook_subscriptions.write` (required for webhook setup)
4. Save the app and copy the **Client ID** and **Client Secret**

### Step 2: Configure the Mattermost Plugin

1. In Mattermost, go to **System Console > Plugins > PagerDuty**
2. Paste the **OAuth Client ID** from Step 1
3. Paste the **OAuth Client Secret** from Step 1
4. (Optional) Set a custom **API Base URL** if not using the default `https://api.pagerduty.com`
5. (Optional) The **Webhook Secret** field is auto-populated when using `/pagerduty webhook setup`. Only set manually if configuring webhooks outside the plugin.
6. Click **Save**

| Setting | Required | Description |
|---------|----------|-------------|
| OAuth Client ID | Yes | Client ID from your PagerDuty OAuth application |
| OAuth Client Secret | Yes | Client Secret from your PagerDuty OAuth application |
| API Base URL | No | Default: `https://api.pagerduty.com`. Set for regional/custom instances |
| Webhook Secret | No | Auto-generated by `/pagerduty webhook setup`. Used for HMAC-SHA256 signature verification |

### Step 3: User Connection

Each Mattermost user connects their own PagerDuty account:

1. Click the PagerDuty icon in the channel header to open the sidebar
2. Click **Connect to PagerDuty** — a popup opens to the PagerDuty authorization page
3. Authorize the application — the popup closes automatically and PagerDuty data loads
4. To disconnect, click the **Disconnect** button in the sidebar header

### Step 4: Set Up Webhook (Admin Only, Optional)

To receive real-time incident notifications from PagerDuty:

1. Ensure at least one admin user has connected their PagerDuty account (Step 3)
2. Run `/pagerduty webhook setup` in any Mattermost channel
3. The plugin automatically creates a webhook subscription in PagerDuty with the correct URL and a randomly generated HMAC secret
4. Check status anytime with `/pagerduty webhook status`

> **Note:** Your Mattermost server must be accessible from the internet for PagerDuty to deliver webhooks. The webhook URL will be `https://<YOUR_MATTERMOST_URL>/plugins/com.svelle.pagerduty-plugin/api/v1/webhook`.

## Usage

### Opening the Sidebar

1. Look for the PagerDuty icon in the channel header (green icon with "P")
2. Click it to open the right-hand sidebar
3. First-time users will see a **Connect to PagerDuty** prompt — click it to authorize your account
4. Once connected, the sidebar loads and displays your PagerDuty schedules

### Viewing Schedules

1. Select the **Schedules** tab to see all available schedules with:
   - Schedule name
   - Description (if available)
   - Timezone information
2. Use the **Mine/All** toggle to filter to schedules where you're on-call
3. Click on any schedule to see detailed on-call information

### Timeline View

When you click on a schedule, you'll see:
- **Current On-Call**: Prominently displayed with colored background and ON-CALL badge
- **Next 48 Hours**: A timeline showing all upcoming on-call transitions
- **Relative Time**: Human-friendly time display ("2h 30m remaining", "Starts in 1d 4h")
- **Visual Timeline**: Color-coded entries with the current on-call highlighted
- **Direct Paging**: "📟 Page Now" button for the current on-call person

### Paging Functionality

The plugin allows you to directly page the current on-call person:
- **One-Click Access**: Page button appears next to the current on-call person
- **Incident Creation**: Creates a PagerDuty incident with customizable title and description
- **Service Selection**: Choose which PagerDuty service to associate with the incident
- **Smart Targeting**: Automatically assigns the incident to the current on-call person
- **Success Feedback**: Visual confirmation when the incident is created

### Incident Management

The Incidents tab shows all triggered and acknowledged incidents:
- **Incident List**: View all open incidents with status, urgency, service, and assignees
- **Incident Details**: Click an incident to see full details including description and timeline
- **Status Actions**: Acknowledge or resolve incidents directly from Mattermost
- **Incident Notes**: View and add notes to incidents for collaboration
- **Direct Links**: Click through to PagerDuty for full incident context

### Schedule Overrides

Create temporary schedule overrides from the timeline view:
- **Quick Override**: Override a shift for a specific time window
- **User Search**: Search for PagerDuty users to assign the override to
- **Flexible Duration**: Set custom start and end times for the override

### Notifications & Subscriptions

#### Channel Subscriptions

Subscribe a Mattermost channel to PagerDuty events using slash commands or the sidebar settings:

```
/pagerduty subscribe                                    # Subscribe with all event types
/pagerduty subscribe incident.triggered,incident.resolved  # Specific events only
/pagerduty subscribe --service PSERVICE1                # Filter to a specific service
/pagerduty unsubscribe                                  # Remove this channel's subscription
/pagerduty list                                         # Show this channel's subscription
```

**Supported event types:**
| Event Type | Description |
|-----------|-------------|
| `incident.triggered` | A new incident is triggered |
| `incident.acknowledged` | An incident is acknowledged |
| `incident.resolved` | An incident is resolved |
| `incident.escalated` | An incident is escalated |
| `oncall.change` | On-call personnel changed for a schedule |

#### Personal DM Notifications

Enable optional personal notifications to receive DMs from the PagerDuty bot:

```
/pagerduty notify on      # Enable all DM notifications
/pagerduty notify off     # Disable all DM notifications
/pagerduty notify status  # View your current preferences
```

When enabled, you'll receive DMs for:
- **On-call start**: When you go on-call for a schedule
- **On-call end**: When your on-call shift ends
- **Shift reminder**: 30 minutes before your shift starts
- **Shift taken**: When someone takes your shift via an override

You can also manage notification preferences from the sidebar by clicking the **gear icon** in the header.

#### Webhook Management (Admin Only)

```
/pagerduty webhook setup     # Register PagerDuty webhook (auto-configures URL and secret)
/pagerduty webhook status    # Check webhook registration status
/pagerduty webhook teardown  # Remove the webhook subscription
```

### All Slash Commands

| Command | Description |
|---------|-------------|
| `/pagerduty connect` | Connect your PagerDuty account via OAuth |
| `/pagerduty disconnect` | Disconnect your PagerDuty account |
| `/pagerduty subscribe [events] [--service ID]` | Subscribe this channel to PagerDuty events |
| `/pagerduty unsubscribe` | Unsubscribe this channel |
| `/pagerduty list` | Show this channel's subscription details |
| `/pagerduty notify on\|off\|status` | Manage personal DM notifications |
| `/pagerduty webhook setup\|status\|teardown` | Manage PagerDuty webhook (admin) |
| `/pagerduty help` | Show command reference |

### Navigation

- Switch between **On-Call**, **Schedules**, and **Incidents** tabs at the top
- Use the **Mine/All** toggle to filter schedules to only those where you're on-call
- Use the **← back arrow** to return from detail views to the list
- Click **Refresh** to get the latest data
- Click the **gear icon** to access notification preferences and channel subscription settings

## Development

### Prerequisites

- Go 1.22 or higher
- Node.js 16 or higher
- npm 8 or higher

### Building the Plugin

1. Clone the repository:
   ```bash
   git clone https://github.com/svelle/mattermost-pagerduty-plugin.git
   cd mattermost-pagerduty-plugin
   ```

2. Build the plugin:
   ```bash
   make
   ```

This will create the plugin file at `dist/com.svelle.pagerduty-plugin.tar.gz`.

### Local Development

For local development with automatic deployment:

```bash
export MM_SERVICESETTINGS_SITEURL=http://localhost:8065
export MM_ADMIN_TOKEN=your-admin-token
make deploy
```

To watch for changes and auto-deploy:

```bash
make watch
```

## Future Enhancements

Here's a list of nice-to-have features that could enhance the PagerDuty plugin:

### Schedule Management
- **Shift swapping**: Request and approve shift swaps between team members
- **Multi-schedule view**: View multiple schedules side-by-side for coordination
- **Calendar export**: Export on-call schedules to iCal/Google Calendar format
- **Historical view**: View past on-call schedules and coverage

### Enhanced Features
- **User profiles**: Click on users to see their contact info and current status
- **Timezone support**: Show schedules in user's local timezone with conversion
- **Mobile optimization**: Responsive design for mobile Mattermost apps

### Automation & Integration
- **Incident response**: Create Mattermost channels automatically for PagerDuty incidents
- **Status sync**: Sync on-call status to Mattermost user status
- **Escalation policies**: View and understand escalation policies
- **Service dependencies**: Visualize service dependencies and their on-call teams

### Analytics & Reporting
- **On-call metrics**: Time spent on-call, incident load per person
- **Coverage reports**: Identify gaps in on-call coverage
- **Rotation fairness**: Ensure equal distribution of on-call duties
- **Custom dashboards**: Build team-specific on-call dashboards

### Administrative Features
- **Bulk configuration**: Configure multiple schedules at once
- **Role-based access**: Restrict who can view certain schedules
- **Audit logging**: Track who viewed or modified schedule information

### User Experience
- **Customizable views**: Save preferred schedule views and filters
- **Keyboard shortcuts**: Navigate schedules quickly with keyboard commands
- **Rich schedule details**: Show more context like team descriptions, runbooks
- **Presence indicators**: Show if on-call person is online in Mattermost

## Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting PRs.

## Security

If you discover a security vulnerability, please email security@mattermost.com instead of using the issue tracker.

## License

This plugin is licensed under the [Apache License 2.0](LICENSE).