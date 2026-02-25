// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useState} from 'react';

import client from '@/client/client';
import type {UserNotificationPrefs} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    theme: Theme;
    onBack: () => void;
    onOpenSubscriptions?: () => void;
}

const NotificationSettings: React.FC<Props> = ({theme, onBack, onOpenSubscriptions}) => {
    const [prefs, setPrefs] = useState<UserNotificationPrefs>({
        enabled: false,
        oncall_start: false,
        oncall_end: false,
        shift_reminder: false,
        shift_taken: false,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const loadPrefs = useCallback(async () => {
        try {
            setLoading(true);
            const data = await client.getNotificationPrefs();
            setPrefs(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load preferences');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPrefs();
    }, [loadPrefs]);

    const handleToggle = async (key: keyof UserNotificationPrefs) => {
        const newPrefs = {...prefs, [key]: !prefs[key]};

        // If disabling master toggle, turn off everything
        if (key === 'enabled' && !newPrefs.enabled) {
            newPrefs.oncall_start = false;
            newPrefs.oncall_end = false;
            newPrefs.shift_reminder = false;
            newPrefs.shift_taken = false;
        }

        // If enabling master toggle, turn on everything
        if (key === 'enabled' && newPrefs.enabled) {
            newPrefs.oncall_start = true;
            newPrefs.oncall_end = true;
            newPrefs.shift_reminder = true;
            newPrefs.shift_taken = true;
        }

        setPrefs(newPrefs);
        setSaving(true);
        setError(null);

        try {
            await client.setNotificationPrefs(newPrefs);
            setSuccessMessage('Preferences saved');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save preferences');
        } finally {
            setSaving(false);
        }
    };

    const toggleStyle = (enabled: boolean): React.CSSProperties => ({
        width: '40px',
        height: '22px',
        borderRadius: '11px',
        backgroundColor: enabled ? theme.onlineIndicator : `${theme.centerChannelColor}30`,
        border: 'none',
        cursor: saving ? 'wait' : 'pointer',
        position: 'relative',
        transition: 'background-color 0.2s',
        flexShrink: 0,
    });

    const knobStyle = (enabled: boolean): React.CSSProperties => ({
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        backgroundColor: 'white',
        position: 'absolute',
        top: '2px',
        left: enabled ? '20px' : '2px',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    });

    const settingItems: Array<{key: keyof UserNotificationPrefs; label: string; description: string}> = [
        {key: 'oncall_start', label: 'Going on-call', description: 'Notify when you start an on-call shift'},
        {key: 'oncall_end', label: 'Shift ended', description: 'Notify when your on-call shift ends'},
        {key: 'shift_reminder', label: '30-minute reminder', description: 'Get a heads-up before your shift starts'},
        {key: 'shift_taken', label: 'Shift taken', description: 'Notify when someone overrides your shift'},
    ];

    if (loading) {
        return (
            <div style={{padding: '16px'}}>
                <p style={{color: theme.centerChannelColor, opacity: 0.6}}>{'Loading preferences...'}</p>
            </div>
        );
    }

    return (
        <div className='pagerduty-notification-settings'>
            {/* Back button */}
            <div style={{marginBottom: '16px'}}>
                <button
                    onClick={onBack}
                    style={{
                        backgroundColor: 'transparent',
                        color: theme.linkColor,
                        border: 'none',
                        padding: '0',
                        cursor: 'pointer',
                        fontSize: '13px',
                    }}
                >
                    {'\u2190 Back'}
                </button>
            </div>

            <h4 style={{color: theme.centerChannelColor, margin: '0 0 16px 0', fontSize: '15px'}}>
                {'On-Call Notifications'}
            </h4>

            <p style={{color: theme.centerChannelColor, opacity: 0.6, fontSize: '12px', margin: '0 0 16px 0', lineHeight: 1.5}}>
                {'Receive direct messages from the PagerDuty bot about your on-call status.'}
            </p>

            {error && (
                <div
                    role='alert'
                    style={{
                        backgroundColor: `${theme.errorTextColor}15`,
                        color: theme.errorTextColor,
                        padding: '8px 12px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        marginBottom: '12px',
                    }}
                >
                    {error}
                </div>
            )}

            {successMessage && (
                <div
                    role='status'
                    style={{
                        backgroundColor: `${theme.onlineIndicator}15`,
                        color: theme.onlineIndicator,
                        padding: '8px 12px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        marginBottom: '12px',
                    }}
                >
                    {successMessage}
                </div>
            )}

            {/* Master toggle */}
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: `1px solid ${theme.centerChannelColor}15`,
                }}
            >
                <div>
                    <div style={{color: theme.centerChannelColor, fontWeight: 600, fontSize: '14px'}}>
                        {'Enable notifications'}
                    </div>
                    <div style={{color: theme.centerChannelColor, opacity: 0.6, fontSize: '12px', marginTop: '2px'}}>
                        {'Master toggle for all on-call DM notifications'}
                    </div>
                </div>
                <button
                    onClick={() => handleToggle('enabled')}
                    disabled={saving}
                    style={toggleStyle(prefs.enabled)}
                    aria-label='Enable notifications'
                    role='switch'
                    aria-checked={prefs.enabled}
                >
                    <div style={knobStyle(prefs.enabled)}/>
                </button>
            </div>

            {/* Individual toggles */}
            {prefs.enabled && settingItems.map((item) => (
                <div
                    key={item.key}
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 0 10px 16px',
                        borderBottom: `1px solid ${theme.centerChannelColor}10`,
                    }}
                >
                    <div>
                        <div style={{color: theme.centerChannelColor, fontSize: '13px'}}>
                            {item.label}
                        </div>
                        <div style={{color: theme.centerChannelColor, opacity: 0.5, fontSize: '11px', marginTop: '2px'}}>
                            {item.description}
                        </div>
                    </div>
                    <button
                        onClick={() => handleToggle(item.key)}
                        disabled={saving}
                        style={toggleStyle(prefs[item.key])}
                        aria-label={item.label}
                        role='switch'
                        aria-checked={prefs[item.key]}
                    >
                        <div style={knobStyle(prefs[item.key])}/>
                    </button>
                </div>
            ))}

            {/* Channel Subscriptions link */}
            {onOpenSubscriptions && (
                <div style={{marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${theme.centerChannelColor}15`}}>
                    <button
                        onClick={onOpenSubscriptions}
                        style={{
                            backgroundColor: 'transparent',
                            color: theme.linkColor,
                            border: 'none',
                            padding: '0',
                            cursor: 'pointer',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                        }}
                    >
                        {'Manage Channel Subscriptions \u2192'}
                    </button>
                    <div style={{color: theme.centerChannelColor, opacity: 0.5, fontSize: '11px', marginTop: '4px'}}>
                        {'Subscribe this channel to PagerDuty event notifications.'}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationSettings;
