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
import type {AdminConsoleCustomSettingProps} from '@/types/mattermost-webapp';
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

// Compass design-system tokens the Mattermost webapp defines as CSS variables at
// runtime (webapp/channels/src/sass/base/_css_variables.scss, applied by applyTheme).
// The System Console passes no theme to custom settings, so this component styles
// itself with these variables instead of a theme object.
const TEXT = 'var(--center-channel-color)';
const TEXT_MUTED = 'rgba(var(--center-channel-color-rgb), 0.72)';
const TEXT_SUBTLE = 'rgba(var(--center-channel-color-rgb), 0.56)';

// The System Console passes the standard custom-setting props. Only `disabled` is
// used. The value/onChange/setSaveNeeded props are deliberately ignored: the rule is
// stored in Mattermost's access control policy store (through the plugin server),
// never in the plugin configuration, so this setting has its own Save and Remove
// buttons. Props are optional so the component also renders on its own.
export type AccessPolicySettingProps = Partial<AdminConsoleCustomSettingProps>;

const AccessPolicySetting: React.FC<AccessPolicySettingProps> = ({disabled = false}) => {
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

    // A stored rule may be denying everyone when it cannot be evaluated (ABAC
    // unavailable) or when the server could not even read whether one is stored.
    const showBlocking = Boolean(policy?.policy_unknown || (!policy?.available && policy?.has_policy));
    const editorDisabled = disabled || busy || noUsableAttributes;

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
            <React.Suspense
                fallback={
                    <p
                        className='pagerduty-access-loading'
                        style={{color: TEXT_SUBTLE}}
                    >
                        {'Loading editor...'}
                    </p>
                }
            >
                {mode === 'simple' && Table ? (
                    <Table
                        value={expression}
                        onChange={handleChange}
                        disabled={editorDisabled}
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
                        disabled={editorDisabled}
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
            disabled={disabled || busy || !ruleMayBlock}
        >
            {'Remove rule'}
        </button>
    );

    if (loading) {
        return (
            <div
                className='pagerduty-access-policy'
                style={{color: TEXT_SUBTLE}}
            >
                {'Loading access rule...'}
            </div>
        );
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
            style={{maxWidth: 900, color: TEXT}}
        >
            <p style={{marginTop: 0, color: TEXT_MUTED}}>
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

            {showBlocking && (
                <Banner
                    kind='error'
                    testId='pagerduty-access-blocking'
                >
                    <strong>{'A stored access rule may currently be blocking all users. '}</strong>
                    {'A rule that cannot be evaluated denies access to everyone. Make sure attribute-based access control is enabled, or remove the rule, to restore access.'}
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
                        style={{fontWeight: 600, color: TEXT}}
                    >
                        {statusText(policy)}
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
                            disabled={disabled || busy || !dirty || expression.trim() === ''}
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

function statusText(policy: AccessPolicyState): string {
    if (policy.has_policy) {
        return 'An access rule is active.';
    }
    if (policy.policy_unknown) {
        return 'The state of the access rule could not be determined. A stored rule may exist.';
    }
    return 'No access rule is set. Everyone can use the plugin.';
}

type BannerKind = 'error' | 'warning' | 'success';

// Mirrors the System Console SectionNotice (webapp/channels/src/components/section_notice,
// used by the built-in access control policy pages): a tinted box whose border and
// background use the semantic indicator colour at 16% and 8%, with a Compass icon.
export const BANNER_TOKENS: Record<BannerKind, {rgb: string; color: string; icon: string}> = {
    error: {rgb: '--dnd-indicator-rgb', color: '--dnd-indicator', icon: 'icon-alert-outline'},
    warning: {rgb: '--away-indicator-rgb', color: '--away-indicator', icon: 'icon-alert-outline'},
    success: {rgb: '--online-indicator-rgb', color: '--online-indicator', icon: 'icon-check'},
};

export const Banner: React.FC<{kind: BannerKind; testId?: string; children: React.ReactNode}> = ({kind, testId, children}) => {
    const tokens = BANNER_TOKENS[kind];
    return (
        <div
            role={kind === 'error' ? 'alert' : 'status'}
            data-testid={testId}
            className={`pagerduty-access-banner pagerduty-access-banner--${kind}`}
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                margin: '8px 0',
                padding: '10px 12px',
                borderRadius: 'var(--radius-s)',
                border: `1px solid rgba(var(${tokens.rgb}), 0.16)`,
                background: `rgba(var(${tokens.rgb}), 0.08)`,
                color: TEXT,
                fontSize: 13,
            }}
        >
            <i
                className={`icon ${tokens.icon}`}
                aria-hidden='true'
                style={{color: `var(${tokens.color})`, fontSize: 16, lineHeight: '20px'}}
            />
            <div style={{lineHeight: '20px'}}>{children}</div>
        </div>
    );
};

export default AccessPolicySetting;
