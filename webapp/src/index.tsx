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

    public async initialize(registry: PluginRegistry, store: Store<GlobalState, Action<Record<string, unknown>>>) {
        this.registry = registry;
        this.store = store;

        // The admin setting is always available: admins need it even if the rule excludes them.
        registry.registerAdminConsoleCustomSetting('AccessPolicy', AccessPolicySetting, {showTitle: true});

        // Converge on server-side policy changes and after reconnects.
        registry.registerWebSocketEventHandler(ACCESS_POLICY_CHANGED_EVENT, () => {
            this.refreshAccess();
        });
        registry.registerReconnectHandler(() => {
            this.refreshAccess();
        });

        await this.refreshAccess();
    }

    // Asks the server whether the current user may use the plugin and registers or
    // unregisters the UI accordingly. Any failure is treated as "not allowed"; the
    // next reconnect or websocket event retries.
    private async refreshAccess() {
        const seq = ++this.checkSeq;
        let allowed = false;
        try {
            const response = await client.getAccess();
            allowed = response.allowed === true;
        } catch {
            allowed = false;
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
