# Mattermost PagerDuty Plugin — AI Assistant Guide

## Project Overview

This is a Mattermost plugin that integrates PagerDuty into the Mattermost sidebar. It provides:
- Browse PagerDuty on-call schedules and a 48-hour timeline view
- See who is currently on-call, with relative time indicators
- Page (create incidents) directly from Mattermost with service selection
- Channel header button to open the right-hand sidebar

**Plugin ID:** `com.svelle.pagerduty-plugin`
**Min Mattermost Version:** 6.2.1
**Go version:** 1.22.0

---

## Repository Structure

```
mattermost-pagerduty-plugin/
├── server/                        # Go backend plugin
│   ├── main.go                    # Entry point — calls plugin.ClientMain
│   ├── plugin.go                  # Plugin struct, OnActivate, OnDeactivate
│   ├── api.go                     # HTTP router (gorilla/mux), auth middleware, error helpers
│   ├── api_pagerduty.go           # HTTP handler functions for all API endpoints
│   ├── configuration.go           # Plugin config struct, getConfiguration/setConfiguration
│   ├── api_test.go                # Tests for API handlers
│   ├── plugin_test.go             # Tests for plugin lifecycle
│   ├── pagerduty/
│   │   ├── client.go              # PagerDuty HTTP client (NewClient, all API methods)
│   │   ├── client_test.go         # Client unit tests
│   │   └── types.go               # Go structs for PagerDuty API (Schedule, OnCall, etc.)
│   ├── store/kvstore/
│   │   ├── kvstore.go             # KVStore interface
│   │   └── pagerduty.go           # KV storage implementation
│   └── testutils/
│       └── testutils.go           # Shared test helpers
├── webapp/                        # React/TypeScript frontend
│   ├── src/
│   │   ├── index.tsx              # Plugin init: registers RHS sidebar + channel header button
│   │   ├── client/
│   │   │   ├── client.ts          # Frontend HTTP client wrapper
│   │   │   └── client.test.ts
│   │   ├── components/sidebar/
│   │   │   ├── sidebar.tsx        # Root sidebar container, navigation state
│   │   │   ├── sidebar.test.tsx
│   │   │   ├── schedule_list.tsx  # Lists all PagerDuty schedules
│   │   │   ├── schedule_details.tsx # 48-hour timeline for a schedule
│   │   │   ├── oncall_list.tsx    # Current on-call users view
│   │   │   └── paging_dialog.tsx  # Modal: create incident / page someone
│   │   ├── types/
│   │   │   ├── pagerduty.ts       # TypeScript interfaces mirroring server types
│   │   │   ├── theme.ts           # Mattermost theme type
│   │   │   └── mattermost-webapp/index.d.ts  # PluginRegistry types
│   │   ├── test-utils.tsx         # Mock theme, mock client, render helpers
│   │   └── manifest.test.tsx      # Manifest validation tests
│   ├── tests/
│   │   ├── setup.tsx              # Jest global setup (mocks for fetch, matchMedia)
│   │   └── i18n_mock.json
│   ├── i18n/en.json               # English string table
│   ├── package.json
│   ├── webpack.config.js
│   ├── tsconfig.json
│   ├── babel.config.js
│   └── .eslintrc.json
├── assets/
│   └── pagerduty-icon.svg
├── build/                         # Build tooling (do not edit manually)
│   ├── setup.mk
│   ├── custom.mk
│   └── pluginctl/                 # Plugin deploy/control CLI source
├── plugin.json                    # Plugin manifest (ID, version, settings schema)
├── Makefile                       # All build/test/deploy targets
├── go.mod / go.sum
└── .golangci.yml                  # Go linter config
```

---

## Development Commands

| Command | Purpose |
|---------|---------|
| `make` | Full build: check-style + test + dist |
| `make server` | Build Go server binaries (linux/darwin/windows, amd64/arm64) |
| `make webapp` | Bundle React app via webpack |
| `make dist` | Create distributable `.tar.gz` |
| `make deploy` | Build and deploy to local Mattermost server |
| `make watch` | Watch webapp files and auto-deploy on change |
| `make test` | Run all Go and JS tests |
| `make test-ci` | Run tests with JUnit XML output (for CI) |
| `make coverage` | Generate Go coverage HTML report |
| `make check-style` | Run ESLint (webapp) and golangci-lint (server) |
| `make clean` | Remove all build artifacts |
| `make logs` | View plugin logs from Mattermost |
| `make logs-watch` | Tail plugin logs |
| `make enable` / `make disable` | Toggle plugin on running server |

**Environment variables needed for deploy:**
```bash
export MM_SERVICESETTINGS_SITEURL=http://localhost:8065
export MM_ADMIN_TOKEN=your-admin-token
```

---

## Backend Architecture (Go)

### Plugin Struct (`server/plugin.go`)
```go
type Plugin struct {
    plugin.MattermostPlugin
    kvstore               kvstore.KVStore
    client                *pluginapi.Client       // Mattermost server API
    configurationLock     sync.RWMutex
    configuration         *configuration
    createPagerDutyClient func(apiToken, baseURL string) *pagerduty.Client
}
```
`createPagerDutyClient` is a factory function on the struct — override it in tests to inject mocks.

### Configuration (`server/configuration.go`)
- Two settings: `APIToken` (required) and `APIBaseURL` (optional, defaults to `https://api.pagerduty.com`)
- Access via `p.getConfiguration()` (thread-safe, returns immutable copy)
- Always call `config.IsValid()` before using config in handlers

### HTTP API (`server/api.go` + `server/api_pagerduty.go`)
All routes are under `/api/v1`, protected by `MattermostAuthorizationRequired` middleware (checks `Mattermost-User-ID` header).

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/v1/schedules` | `handleGetSchedules` | List all schedules (limit 100) |
| GET | `/api/v1/oncalls` | `handleGetOnCalls` | Current on-calls; optional `?schedule_id=` |
| GET | `/api/v1/schedule` | `handleGetScheduleDetails` | 48-hour timeline; requires `?id=` |
| GET | `/api/v1/services` | `handleGetServices` | List services (limit 100) |
| POST | `/api/v1/incidents` | `handleCreateIncident` | Create incident; body: `{title, service_id, description?, assignee_ids?}` |

**Error response format:**
```json
{"id": "api.pagerduty.schedules.error", "message": "Failed to retrieve schedules"}
```

### PagerDuty Client (`server/pagerduty/client.go`)
- `NewClient(apiToken, baseURL string) *Client` — 30s timeout HTTP client
- Auth: `Authorization: Token token=<token>` header
- API version: `Accept: application/vnd.pagerduty+json;version=2`
- Core methods: `GetSchedules`, `GetSchedule`, `GetCurrentOnCalls`, `GetOnCallsForSchedule`, `GetServices`, `CreateIncident`
- `HTTPClient` is an interface — inject a mock in tests

---

## Frontend Architecture (React/TypeScript)

### Plugin Registration (`webapp/src/index.tsx`)
Registers two things with Mattermost:
1. `registerRightHandSidebarComponent(PagerDutySidebar, 'PagerDuty')` — the main sidebar
2. `registerChannelHeaderButtonAction(Icon, handler, tooltip)` — green "P" button that toggles the sidebar

### Component Hierarchy
```
sidebar.tsx                  ← manages navigation state (view + selectedScheduleId)
  ├── oncall_list.tsx         ← default view: current on-calls across all schedules
  ├── schedule_list.tsx       ← view: list of all schedules
  ├── schedule_details.tsx    ← view: 48-hour timeline for one schedule
  └── paging_dialog.tsx       ← modal overlay: incident creation form
```

Navigation is pure React state (no Redux). Views: `oncall | schedules | schedule-details`.

### Frontend API Client (`webapp/src/client/client.ts`)
Wraps `window.fetch` with the plugin base path. All calls are async, authenticated via the browser session cookie.

### TypeScript Types (`webapp/src/types/pagerduty.ts`)
Mirror the Go types in `server/pagerduty/types.go`. Keep both in sync when adding new API fields.

### Styling
Inline styles using Mattermost theme colors (passed as props). No CSS files — all styles are in-component. CSS class names are added to elements for future external customization.

### i18n
Strings live in `webapp/i18n/en.json`. The i18n setup is scaffolded but not fully wired; new user-visible strings should be added here.

---

## Testing

### Go Tests
```bash
make test           # or: cd server && go test ./... -v -race
make coverage       # opens coverage.html
```
- Test files use `_test.go` suffix in same package
- Use `testutils/testutils.go` for shared helpers
- Mock the `HTTPClient` interface to test the PagerDuty client without network calls
- Use `createPagerDutyClient` injection on `Plugin` struct to mock in handler tests

### Jest / React Tests
```bash
cd webapp && npm test         # watch mode
cd webapp && npm run test-ci  # single run with coverage
```
- Test files co-located with components: `*.test.tsx`
- Use `src/test-utils.tsx` for mock theme and render wrappers
- `tests/setup.tsx` mocks `fetch`, `window.matchMedia`, and React globals
- `tests/i18n_mock.json` provides translation fixture data

---

## Key Conventions

### Go
- Error handling: wrap with `errors.Wrap(err, "context message")` from `github.com/pkg/errors`
- Logging: use `p.client.Log.Debug/Info/Warn/Error` with structured key-value pairs
- Configuration is always accessed via `p.getConfiguration()` — never read `p.configuration` directly
- All HTTP handlers validate config with `config.IsValid()` before making PagerDuty API calls
- Schedule timeline window is **48 hours** from now (not 7 days)

### TypeScript / React
- Props include `theme` (Mattermost theme object) for consistent styling
- Components use functional React with hooks
- No global state management — sidebar navigation is local state in `sidebar.tsx`
- All API calls go through `webapp/src/client/client.ts`; never call `fetch` directly in components
- Keep `pagerduty.ts` TypeScript types in sync with Go `types.go`

### File Organization
- New PagerDuty API methods → `server/pagerduty/client.go` + `server/pagerduty/types.go`
- New HTTP endpoints → register in `server/api.go`, implement in `server/api_pagerduty.go`
- New UI views → add component in `webapp/src/components/sidebar/`, add navigation state in `sidebar.tsx`

---

## Plugin Configuration (Mattermost System Console)

Navigate to **System Console → Plugins → PagerDuty Plugin**:

| Setting | Required | Description |
|---------|----------|-------------|
| PagerDuty API Token | Yes | Format: `pdus+_...`. Needs read on schedules/users/services, write on incidents |
| PagerDuty API Base URL | No | Default: `https://api.pagerduty.com`. Set for regional/custom instances |

---

## Build Outputs

```
server/dist/
  plugin-linux-amd64
  plugin-linux-arm64
  plugin-darwin-amd64
  plugin-darwin-arm64
  plugin-windows-amd64.exe

webapp/dist/
  main.js                   ← webpack bundle

dist/
  com.svelle.pagerduty-plugin-<version>.tar.gz   ← distributable
```

---

## Dependency Notes

- **github.com/mattermost/mattermost/server/public v0.1.10** — Mattermost plugin API
- **github.com/gorilla/mux v1.8.1** — HTTP routing
- **github.com/pkg/errors v0.9.1** — error wrapping
- **@mattermost/client / @mattermost/types 10.8.0** — Mattermost frontend types
- **React 17.0.2** — UI framework
- Node version pinned in `.nvmrc`; use `nvm use` before running `npm install`
