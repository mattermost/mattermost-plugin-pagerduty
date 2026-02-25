# Mattermost PagerDuty Plugin

[![Build Status](https://github.com/svelle/mattermost-pagerduty-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/svelle/mattermost-pagerduty-plugin/actions/workflows/ci.yml)

## Overview

The Mattermost PagerDuty Plugin integrates PagerDuty with Mattermost, allowing teams to view on-call schedules and current on-call users directly within Mattermost. This plugin provides quick access to PagerDuty information through a convenient sidebar interface.

## Features

### Core Functionality
- **Schedule Browser**: View all PagerDuty schedules in a clean, organized list
- **Timeline View**: Click any schedule to see a detailed 48-hour timeline showing:
  - Who's currently on-call (highlighted with special styling)
  - Upcoming shifts with countdown timers
  - Smooth transitions between on-call personnel
- **Direct Paging**: Page the current on-call person directly from the schedule view
- **Right-Hand Sidebar**: Dedicated sidebar accessible via channel header button
- **Real-time Data**: Always shows current information - no background syncing needed
- **Secure Configuration**: Per-user OAuth tokens are stored securely and never exposed in the UI

### User Interface
- **Intuitive Navigation**: Easy back button to switch between schedule list and details
- **Visual Indicators**: Current on-call person prominently displayed with colored background and badges
- **Relative Time Display**: Shows human-friendly time format ("2h 30m remaining", "Starts in 1d 4h")
- **Paging Interface**: One-click paging with incident creation dialog
- **Responsive Design**: Clean layout that works well in the Mattermost sidebar
- **Theme Support**: Automatically adapts to your Mattermost theme (light/dark)
- **Enhanced Styling**: Comprehensive CSS classes for customization

### Configuration
- **PagerDuty OAuth**: Per-user OAuth integration with PagerDuty
- **Custom API URL**: Support for self-hosted or regional PagerDuty instances

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
4. Save the app and copy the **Client ID** and **Client Secret**

### Step 2: Configure the Mattermost Plugin

1. In Mattermost, go to **System Console > Plugins > PagerDuty**
2. Paste the **OAuth Client ID** from Step 1
3. Paste the **OAuth Client Secret** from Step 1
4. (Optional) Set a custom **API Base URL** if not using the default `https://api.pagerduty.com`
5. Click **Save**

### Step 3: User Connection

Each Mattermost user connects their own PagerDuty account:

1. Click the PagerDuty icon in the channel header to open the sidebar
2. Click **Connect to PagerDuty** — a popup opens to the PagerDuty authorization page
3. Authorize the application — the popup closes automatically and PagerDuty data loads
4. To disconnect, click the **Disconnect** button in the sidebar header

## Usage

### Opening the Sidebar

1. Look for the PagerDuty icon in the channel header (green icon with "P")
2. Click it to open the right-hand sidebar
3. First-time users will see a **Connect to PagerDuty** prompt — click it to authorize your account
4. Once connected, the sidebar loads and displays your PagerDuty schedules

### Viewing Schedules

1. The main view shows all available schedules with:
   - Schedule name
   - Description (if available)
   - Timezone information
2. Click on any schedule to see detailed on-call information

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

### Navigation

- Use the **← back arrow** to return to the schedule list
- Click **Refresh** to get the latest data
- Click the same schedule again to refresh its details

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

### 🔔 Notifications & Alerts
- **On-call transition notifications**: Notify users when they're about to go on-call (configurable advance notice)
- **Schedule change alerts**: Notify when someone's on-call schedule is modified
- **Incident notifications**: Real-time PagerDuty incident alerts in Mattermost channels
- **Override notifications**: Alert when schedule overrides are created

### 📅 Schedule Management
- **Schedule overrides**: Create temporary schedule overrides directly from Mattermost
- **Shift swapping**: Request and approve shift swaps between team members
- **Multi-schedule view**: View multiple schedules side-by-side for coordination
- **Calendar export**: Export on-call schedules to iCal/Google Calendar format
- **Historical view**: View past on-call schedules and coverage

### 🎯 Enhanced Features
- **User profiles**: Click on users to see their contact info and current status
- **Team filtering**: Filter schedules by team or service
- **Search functionality**: Search for specific users or schedules
- **Timezone support**: Show schedules in user's local timezone with conversion
- **Mobile optimization**: Responsive design for mobile Mattermost apps

### 🤖 Automation & Integration
- **Incident response**: Create Mattermost channels automatically for PagerDuty incidents
- **Status sync**: Sync on-call status to Mattermost user status
- **Escalation policies**: View and understand escalation policies
- **Service dependencies**: Visualize service dependencies and their on-call teams
- **Slack-style reminders**: Set reminders for on-call handoffs

### 📊 Analytics & Reporting
- **On-call metrics**: Time spent on-call, incident load per person
- **Coverage reports**: Identify gaps in on-call coverage
- **Rotation fairness**: Ensure equal distribution of on-call duties
- **Custom dashboards**: Build team-specific on-call dashboards

### 🔧 Administrative Features
- **Bulk configuration**: Configure multiple schedules at once
- **Role-based access**: Restrict who can view certain schedules
- **Audit logging**: Track who viewed or modified schedule information
- **Backup schedules**: Automatic backup of schedule configurations

### 🎨 User Experience
- **Dark mode optimization**: Better contrast and styling for dark themes
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