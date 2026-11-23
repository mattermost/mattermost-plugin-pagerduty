// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type React from 'react';
import type {Action} from 'redux';

// Props of the System Console custom setting component (only what we read).
export interface AdminConsoleCustomSettingProps {
    id: string;
    label?: string;
    helpText?: React.ReactNode;
    disabled?: boolean;
    value?: unknown;
}

// Result shape of the thunks the core editors expect from their action callbacks
// (mattermost-redux ActionResult).
export interface EditorActionResult<T = unknown> {
    data?: T;
    error?: {message?: string; [key: string]: unknown};
}

export interface EditorCELExpressionError {
    message: string;
    line: number;
    column: number;
}

export interface EditorTestResult {
    users: Array<Record<string, unknown>>;
    total: number;
}

// window.Components.AccessControlTableEditor props (mattermost v11.11.0,
// webapp/channels/src/components/admin_console/access_control/editors/table_editor/table_editor.tsx).
// userAttributes is a PropertyField[] (UserPropertyField).
export interface AccessControlTableEditorProps {
    value: string;
    onChange: (value: string) => void;
    onValidate?: (isValid: boolean) => void;
    disabled?: boolean;
    userAttributes: unknown[];
    enableUserManagedAttributes: boolean;
    onParseError: (error: string) => void;
    actions: {
        getVisualAST: (expression: string) => Promise<EditorActionResult>;
        searchUsers?: (expression: string, term: string, after: string, limit: number) => Promise<EditorActionResult<EditorTestResult>>;
    };
}

// window.Components.AccessControlCELEditor props (.../editors/cel_editor/editor.tsx).
export interface AccessControlCELEditorProps {
    value: string;
    onChange: (value: string) => void;
    onValidate?: (isValid: boolean) => void;
    placeholder?: string;
    disabled?: boolean;
    userAttributes: Array<{attribute: string; values: string[]; objectType?: string; isNative?: boolean}>;
    actions?: {
        checkExpression?: (expression: string) => Promise<EditorCELExpressionError[]>;
        searchUsers?: (expression: string, term: string, after: string, limit: number) => Promise<EditorActionResult<EditorTestResult>>;
    };
}

export interface PluginRegistry {
    registerPostTypeComponent(typeName: string, component: React.ElementType): void;

    // Returns the component id plus the RHS actions (mattermost registry.ts).
    registerRightHandSidebarComponent(component: React.ComponentType<any>, title: string): {
        id: string;
        showRHSPlugin: Action;
        hideRHSPlugin: Action;
        toggleRHSPlugin: Action;
    };

    // Returns the unique id of the registered button.
    registerChannelHeaderButtonAction(
        icon: React.ReactElement,
        action: () => void,
        dropdownText: string,
        tooltipText?: string
    ): string;

    // Returns the unique id (a plain string).
    registerPostDropdownMenuComponent(component: React.ComponentType<{postId: string}>): string;

    // Returns the unique id (a plain string).
    registerRootComponent(component: React.ComponentType): string;

    registerAdminConsoleCustomSetting(
        key: string,
        component: React.ComponentType<any>,
        options?: {showTitle: boolean}
    ): void;

    // Removes a component/action registered earlier, by the id it returned.
    unregisterComponent(componentId: string): void;

    registerWebSocketEventHandler(event: string, handler: (msg: {data?: Record<string, unknown>}) => void): void;

    registerReconnectHandler(handler: () => void): void;

    // Add more if needed from https://developers.mattermost.com/extend/plugins/webapp/reference
}

declare global {

    // Window.Components is present on Mattermost 11.11+. Both editors are React.lazy: render inside <React.Suspense>.
    interface Window {
        Components?: {
            AccessControlTableEditor?: React.ComponentType<AccessControlTableEditorProps>;
            AccessControlCELEditor?: React.ComponentType<AccessControlCELEditorProps>;
            [name: string]: unknown;
        };
    }
}
