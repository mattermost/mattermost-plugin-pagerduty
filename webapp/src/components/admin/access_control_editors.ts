// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Thin adapter between Mattermost's embeddable ABAC editors
// (window.Components.AccessControl{Table,CEL}Editor, Mattermost 11.11+) and this
// plugin's own proxy routes. Everything that depends on the editors' prop and
// callback shapes lives here. The editors' defaults would call Mattermost's core
// /api/v4 access-control endpoints, which evaluate core policy types, so every
// network callback is overridden to go through the plugin server instead.

import client from '@/client/client';
import type {
    AccessControlCELEditorProps,
    AccessControlTableEditorProps,
    EditorActionResult,
    EditorCELExpressionError,
    EditorTestResult,
} from '@/types/mattermost-webapp';
import type {AccessPolicyField} from '@/types/pagerduty';

export type TableEditorComponent = React.ComponentType<AccessControlTableEditorProps>;
export type CELEditorComponent = React.ComponentType<AccessControlCELEditorProps>;

export function getEditorComponents(): {Table?: TableEditorComponent; Cel?: CELEditorComponent} {
    const components = window.Components;
    return {
        Table: components?.AccessControlTableEditor,
        Cel: components?.AccessControlCELEditor,
    };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

// Wraps a promise in the {data}|{error} shape of a mattermost-redux ActionResult.
async function toActionResult<T>(promise: Promise<T>): Promise<EditorActionResult<T>> {
    try {
        return {data: await promise};
    } catch (err) {
        return {error: {message: errorMessage(err)}};
    }
}

export const tableEditorActions: AccessControlTableEditorProps['actions'] = {
    getVisualAST: (expression) => toActionResult(client.getAccessPolicyVisualAST(expression)),
    searchUsers: (expression, term, after, limit) => toActionResult<EditorTestResult>(
        client.searchAccessPolicyTestUsers(expression, term, after, limit),
    ),
};

export const celEditorActions: NonNullable<AccessControlCELEditorProps['actions']> = {
    checkExpression: async (expression): Promise<EditorCELExpressionError[]> => {
        const result = await client.checkAccessPolicyExpression(expression);
        return result.errors || [];
    },
    searchUsers: (expression, term, after, limit) => toActionResult<EditorTestResult>(
        client.searchAccessPolicyTestUsers(expression, term, after, limit),
    ),
};

const isNative = (field: AccessPolicyField) => Boolean((field.attrs as {native?: boolean} | undefined)?.native);

function hasControlledValues(field: AccessPolicyField): boolean {
    const attrs = (field.attrs || {}) as {ldap?: unknown; saml?: unknown; managed?: string; protected?: unknown; owners?: unknown[]};
    return Boolean(attrs.ldap || attrs.saml || attrs.managed === 'admin' || attrs.protected || (attrs.owners?.length ?? 0) > 0);
}

// Mirrors toCELEditorAttributes in Mattermost's editors/shared.tsx.
export function toCELEditorAttributes(fields: AccessPolicyField[], enableUserManagedAttributes: boolean): AccessControlCELEditorProps['userAttributes'] {
    return fields.
        filter((field) => isNative(field) || enableUserManagedAttributes || hasControlledValues(field)).
        map((field) => ({
            attribute: field.name,
            values: [],
            isNative: isNative(field),
            objectType: field.object_type,
        }));
}

// Mirrors hasUsableAttributes in Mattermost's editors/shared.tsx.
export function hasUsableAttributes(fields: AccessPolicyField[], enableUserManagedAttributes: boolean): boolean {
    return fields.some((field) => !field.name.includes(' ') && (isNative(field) || hasControlledValues(field) || enableUserManagedAttributes));
}
