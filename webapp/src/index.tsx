// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import type {Store, Action} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import PagerDutySidebar from './components/sidebar/sidebar';

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

export default class Plugin {
    public async initialize(registry: PluginRegistry, store: Store<GlobalState, Action<Record<string, unknown>>>) {
        // Register the RHS component
        const {toggleRHSPlugin} = registry.registerRightHandSidebarComponent(
            PagerDutySidebar,
            'PagerDuty',
        );

        // Register channel header button
        registry.registerChannelHeaderButtonAction(
            <Icon/>,
            () => store.dispatch(toggleRHSPlugin),
            'View PagerDuty on-call schedules',
        );
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
