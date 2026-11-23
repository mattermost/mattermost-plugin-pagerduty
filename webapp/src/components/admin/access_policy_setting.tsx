// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useState} from 'react';

import {
    celEditorActions,
    getEditorComponents,
    hasUsableAttributes,
    tableEditorActions,
    toCELEditorAttributes,
} from './access_control_editors';

import client from '@/client/client';
import type {AccessPolicyField, AccessPolicyState} from '@/types/pagerduty';

type EditorMode = 'simple' | 'advanced';

const FIELDS_PAGE_SIZE = 100;

// Upper bound on pages so a server that keeps returning full pages cannot loop forever.
export const MAX_FIELD_PAGES = 50;

// Loads every attribute field, following the `after` cursor until a short page.
async function loadAllFields(isCancelled: () => boolean): Promise<AccessPolicyField[]> {
    const all: AccessPolicyField[] = [];
    let after = '';
    for (let page = 0; page < MAX_FIELD_PAGES; page++) {
        // eslint-disable-next-line no-await-in-loop
        const batch = (await client.getAccessPolicyFields(after, FIELDS_PAGE_SIZE)) || [];
        if (isCancelled()) {
            return all;
        }
        all.push(...batch);
        if (batch.length < FIELDS_PAGE_SIZE) {
            break;
        }
        after = batch[batch.length - 1].id;
    }
    return all;
}

// This component is registered as a System Console custom setting but it does NOT
// use the setting's value/onChange/setSaveNeeded props: the rule is stored in
// Mattermost's access control policy store (through the plugin server), never in
// the plugin configuration, so it has its own Save and Remove buttons.
const AccessPolicySetting: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [policy, setPolicy] = useState<AccessPolicyState | null>(null);
    const [fields, setFields] = useState<AccessPolicyField[]>([]);
    const [fieldsLoaded, setFieldsLoaded] = useState(false);
    const [fieldsError, setFieldsError] = useState<string | null>(null);
    const [expression, setExpression] = useState('');
    const [mode, setMode] = useState<EditorMode>('simple');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const applyPolicy = useCallback((next: AccessPolicyState) => {
        setPolicy(next);
        setExpression(next.expression || '');
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const state = await client.getAccessPolicy();
                if (cancelled) {
                    return;
                }
                applyPolicy(state);
                if (state.available) {
                    try {
                        const loaded = await loadAllFields(() => cancelled);
                        if (!cancelled) {
                            setFields(loaded);
                            setFieldsLoaded(true);
                        }
                    } catch (err) {
                        if (!cancelled) {
                            setFieldsError(err instanceof Error ? err.message : String(err));
                        }
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err instanceof Error ? err.message : String(err));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [applyPolicy]);

    const handleChange = useCallback((value: string) => {
        setExpression(value);
        setError(null);
        setNotice(null);
    }, []);

    const handleSave = async () => {
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            applyPolicy(await client.saveAccessPolicy(expression.trim()));
            setNotice('Access rule saved.');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async () => {
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            applyPolicy(await client.deleteAccessPolicy());
            setNotice('Access rule removed. Everyone can use the plugin.');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    const {Table, Cel} = getEditorComponents();
    const savedExpression = policy?.expression || '';
    const dirty = expression !== savedExpression;
    const noUsableAttributes = fieldsLoaded && !fieldsError && !hasUsableAttributes(fields, false);
    const ruleMayBlock = Boolean(policy?.has_policy || policy?.policy_unknown);

    const renderEditor = () => {
        const Editor = mode === 'simple' ? Table : Cel;
        if (!Editor) {
            return (
                <Banner
                    kind='warning'
                    testId='pagerduty-access-editor-missing'
                >
                    {'The access rule editor is not available. It requires Mattermost 11.11 or later, which provides the attribute-based access control editor components to plugins. Update Mattermost, then reload this page.'}
                </Banner>
            );
        }

        return (
            <React.Suspense fallback={<p className='pagerduty-access-loading'>{'Loading editor...'}</p>}>
                {mode === 'simple' && Table ? (
                    <Table
                        value={expression}
                        onChange={handleChange}
                        disabled={busy || noUsableAttributes}
                        userAttributes={fields}
                        enableUserManagedAttributes={false}
                        onParseError={() => setMode('advanced')}
                        actions={tableEditorActions}
                    />
                ) : null}
                {mode === 'advanced' && Cel ? (
                    <Cel
                        value={expression}
                        onChange={handleChange}
                        disabled={busy || noUsableAttributes}
                        userAttributes={toCELEditorAttributes(fields, false)}
                        actions={celEditorActions}
                    />
                ) : null}
            </React.Suspense>
        );
    };

    const feedback = (
        <>
            {error && (
                <Banner
                    kind='error'
                    testId='pagerduty-access-error'
                >
                    {error}
                </Banner>
            )}
            {notice && (
                <Banner
                    kind='success'
                    testId='pagerduty-access-notice'
                >
                    {notice}
                </Banner>
            )}
        </>
    );

    const removeButton = (
        <button
            type='button'
            className='btn btn-danger'
            onClick={handleRemove}
            disabled={busy || !ruleMayBlock}
        >
            {'Remove rule'}
        </button>
    );

    if (loading) {
        return <div className='pagerduty-access-policy'>{'Loading access rule...'}</div>;
    }

    if (loadError || !policy) {
        return (
            <div className='pagerduty-access-policy'>
                <Banner
                    kind='error'
                    testId='pagerduty-access-load-error'
                >
                    {`Could not load the access rule: ${loadError || 'unknown error'}`}
                </Banner>
            </div>
        );
    }

    return (
        <div
            className='pagerduty-access-policy'
            style={{maxWidth: 900}}
        >
            <p style={{marginTop: 0}}>
                {'With no rule, everyone can use the PagerDuty plugin. With a rule, only users who match it get the PagerDuty button, sidebar and commands. The rule also applies to system admins; they can always change it here.'}
            </p>

            {!policy.available && (
                <Banner
                    kind='warning'
                    testId='pagerduty-access-unavailable'
                >
                    <strong>{'Access rules are not available. '}</strong>
                    {policy.unavailable_reason || 'Attribute-based access control is not licensed or enabled on this server.'}
                </Banner>
            )}

            {!policy.available && ruleMayBlock && (
                <Banner
                    kind='error'
                    testId='pagerduty-access-blocking'
                >
                    <strong>{'A stored access rule may currently be blocking all users. '}</strong>
                    {'A rule that cannot be evaluated denies access to everyone. Re-enable attribute-based access control or remove the rule to restore access.'}
                </Banner>
            )}

            {!policy.available && feedback}

            {!policy.available && ruleMayBlock && (
                <div style={{display: 'flex', gap: 8, marginTop: 12}}>
                    {removeButton}
                </div>
            )}

            {policy.available && (
                <>
                    <p
                        className='pagerduty-access-status'
                        style={{fontWeight: 600}}
                    >
                        {policy.has_policy ? 'An access rule is active.' : 'No access rule is set. Everyone can use the plugin.'}
                    </p>

                    {fieldsError && (
                        <Banner
                            kind='warning'
                            testId='pagerduty-access-fields-error'
                        >
                            {`Could not load user attributes: ${fieldsError}`}
                        </Banner>
                    )}

                    {noUsableAttributes && (
                        <Banner
                            kind='warning'
                            testId='pagerduty-access-no-attributes'
                        >
                            {'No usable user attributes are available. Configure attributes (for example synced from LDAP or SAML, or admin-managed) before writing a rule.'}
                        </Banner>
                    )}

                    <div style={{marginBottom: 8}}>
                        <button
                            type='button'
                            className='btn btn-tertiary btn-sm'
                            onClick={() => setMode(mode === 'simple' ? 'advanced' : 'simple')}
                            disabled={busy}
                        >
                            {mode === 'simple' ? 'Switch to advanced mode' : 'Switch to simple mode'}
                        </button>
                    </div>

                    {renderEditor()}

                    {feedback}

                    <div style={{display: 'flex', gap: 8, marginTop: 12}}>
                        <button
                            type='button'
                            className='btn btn-primary'
                            onClick={handleSave}
                            disabled={busy || !dirty || expression.trim() === ''}
                        >
                            {'Save rule'}
                        </button>
                        {removeButton}
                    </div>
                </>
            )}
        </div>
    );
};

const BANNER_COLORS: Record<string, string> = {
    error: 'var(--error-text, #d24b4e)',
    warning: 'var(--away-indicator, #ffbc1f)',
    success: 'var(--online-indicator, #06d6a0)',
};

const Banner: React.FC<{kind: 'error' | 'warning' | 'success'; testId?: string; children: React.ReactNode}> = ({kind, testId, children}) => (
    <div
        role={kind === 'error' ? 'alert' : 'status'}
        data-testid={testId}
        style={{
            margin: '8px 0',
            padding: '10px 12px',
            borderRadius: 4,
            border: `1px solid ${BANNER_COLORS[kind]}`,
            borderLeftWidth: 4,
            fontSize: 13,
        }}
    >
        {children}
    </div>
);

export default AccessPolicySetting;
