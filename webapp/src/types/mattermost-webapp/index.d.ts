// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type React from 'react';
import type {Action} from 'redux';

export interface PluginRegistry {
    registerPostTypeComponent(typeName: string, component: React.ElementType): void;

    registerRightHandSidebarComponent(component: React.ComponentType<any>, title: string): {
        toggleRHSPlugin: Action;
    };

    registerChannelHeaderButtonAction(
        icon: React.ReactElement,
        action: () => void,
        dropdownText: string,
        tooltipText?: string
    ): void;

    registerPostDropdownMenuComponent(component: React.ComponentType<{postId: string}>): {id: string};

    registerRootComponent(component: React.ComponentType): void;

    // Add more if needed from https://developers.mattermost.com/extend/plugins/webapp/reference
}
