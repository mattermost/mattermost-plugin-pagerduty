// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import type {Store, Action} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import CreateIncidentMenuItem from './components/create_incident_menu_item';
import CreateIncidentPostModal from './components/create_incident_post_modal';
import PagerDutySidebar from './components/sidebar/sidebar';

import client from '@/client/client';
import AccessPolicySetting from '@/components/admin/access_policy_setting';
import manifest from '@/manifest';
import type {PluginRegistry} from '@/types/mattermost-webapp';

// Define the icon as an inline SVG component
const Icon = () => (
    <svg
        width='18'
        height='18'
        viewBox='0 0 64 64'
        xmlns='http://www.w3.org/2000/svg'
        style={{fill: 'currentColor'}}
    >
        <circle
            cx='32'
            cy='32'
            r='32'
            fill='#06AC38'
        />
        <path
            d='M 16 12 L 32 12 Q 40 12 44 16 Q 48 20 48 28 Q 48 36 44 40 Q 40 44 32 44 L 24 44 L 24 52 L 16 52 Z M 24 20 L 24 36 L 32 36 Q 36 36 38 34 Q 40 32 40 28 Q 40 24 38 22 Q 36 20 32 20 Z'
            fill='white'
        />
    </svg>
);

export const ACCESS_POLICY_CHANGED_EVENT = `custom_${manifest.id}_access_policy_changed`;

const ACCESS_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];
const ACCESS_RECHECK_JITTER_MS = 3000;

interface Registered {
    rhsId: string;
    headerButtonId: string;
    rootId: string;
    postMenuId: string;
    hideRHS: Action;
}

export default class Plugin {
    private registry: PluginRegistry | null = null;
    private store: Store<GlobalState, Action<Record<string, unknown>>> | null = null;

    // IDs returned by the registry for the UI that is currently registered, or
    // null when the user has no access. Registration is always done through
    // setAllowed so it can never be registered twice.
    private registered: Registered | null = null;

    // Incremented per access check so a slow, stale response cannot overwrite a newer one.
    private checkSeq = 0;

    // Pending timers: a retry after a failed check, and the jittered delay before
    // the re-check that follows a policy-changed event. A newer check cancels both.
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private jitterTimer: ReturnType<typeof setTimeout> | null = null;

    public async initialize(registry: PluginRegistry, store: Store<GlobalState, Action<Record<string, unknown>>>) {
        this.registry = registry;
        this.store = store;

        // The admin setting is always available: admins need it even if the rule excludes them.
        registry.registerAdminConsoleCustomSetting('AccessPolicy', AccessPolicySetting, {showTitle: true});

        // Converge on server-side policy changes and after reconnects.
        registry.registerWebSocketEventHandler(ACCESS_POLICY_CHANGED_EVENT, () => {
            if (!this.registry) {
                return;
            }

            // Spread the re-checks of all connected clients over a few seconds.
            this.cancelPending();
            this.jitterTimer = setTimeout(() => {
                this.jitterTimer = null;
                this.refreshAccess();
            }, Math.random() * ACCESS_RECHECK_JITTER_MS);
        });
        registry.registerReconnectHandler(() => {
            if (!this.registry) {
                return;
            }
            this.cancelPending();
            this.refreshAccess();
        });

        // Do not block plugin initialization on the network.
        this.refreshAccess();
    }

    // Called by Mattermost when the plugin is disabled or the webapp unloads it.
    // Mattermost removes the components this plugin registered itself, so nothing is
    // unregistered here; this only makes sure no pending timer or in-flight access
    // check registers UI afterwards.
    public uninitialize() {
        this.cancelPending();

        // Any response still in flight now has a stale sequence number and is discarded,
        // and a stale failure cannot schedule a retry.
        this.checkSeq++;
        this.registry = null;
        this.store = null;
        this.registered = null;
    }

    private cancelPending() {
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        if (this.jitterTimer !== null) {
            clearTimeout(this.jitterTimer);
            this.jitterTimer = null;
        }
    }

    // Asks the server whether the current user may use the plugin and registers or
    // unregisters the UI accordingly. Only an explicit answer changes the UI: on an
    // error the current state is kept and the check is retried with capped backoff,
    // after which the next reconnect or websocket event retries.
    private async refreshAccess(attempt = 0) {
        if (!this.registry) {
            // Unloaded: never start a check or schedule a retry.
            return;
        }
        this.cancelPending();
        const seq = ++this.checkSeq;
        let allowed: boolean;
        try {
            const response = await client.getAccess();
            allowed = response.allowed === true;
        } catch {
            if (seq === this.checkSeq && attempt < ACCESS_RETRY_DELAYS_MS.length) {
                this.retryTimer = setTimeout(() => {
                    this.retryTimer = null;
                    this.refreshAccess(attempt + 1);
                }, ACCESS_RETRY_DELAYS_MS[attempt]);
            }
            return;
        }
        if (seq !== this.checkSeq) {
            return;
        }
        this.setAllowed(allowed);
    }

    private setAllowed(allowed: boolean) {
        const registry = this.registry;
        const store = this.store;
        if (!registry || !store) {
            return;
        }

        if (allowed && !this.registered) {
            const rhs = registry.registerRightHandSidebarComponent(PagerDutySidebar, 'PagerDuty');
            const headerButtonId = registry.registerChannelHeaderButtonAction(
                <Icon/>,
                () => store.dispatch(rhs.toggleRHSPlugin),
                'View PagerDuty on-call schedules',
            );

            // Root component for the incident creation modal (rendered at app root)
            const rootId = registry.registerRootComponent(CreateIncidentPostModal);

            // Post dropdown menu component to create a PagerDuty incident from a post
            const postMenuId = registry.registerPostDropdownMenuComponent(CreateIncidentMenuItem);

            this.registered = {rhsId: rhs.id, headerButtonId, rootId, postMenuId, hideRHS: rhs.hideRHSPlugin};
        } else if (!allowed && this.registered) {
            const {rhsId, headerButtonId, rootId, postMenuId, hideRHS} = this.registered;
            this.registered = null;

            // Close the RHS first in case it is showing this plugin.
            store.dispatch(hideRHS);
            registry.unregisterComponent(rhsId);
            registry.unregisterComponent(headerButtonId);
            registry.unregisterComponent(rootId);
            registry.unregisterComponent(postMenuId);
        }
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
