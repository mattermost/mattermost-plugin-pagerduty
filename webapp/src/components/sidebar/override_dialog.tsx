// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useRef, useState} from 'react';

import client from '@/client/client';
import type {User} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    theme: Theme;
    scheduleId: string;
    scheduleName: string;
    defaultStart: string;
    defaultEnd: string;
    onClose: () => void;
    onSuccess: () => void;
}

export const OverrideDialog: React.FC<Props> = ({
    theme,
    scheduleId,
    scheduleName,
    defaultStart,
    defaultEnd,
    onClose,
    onSuccess,
}) => {
    const [start, setStart] = useState(defaultStart);
    const [end, setEnd] = useState(defaultEnd);
    const [userQuery, setUserQuery] = useState('');
    const [users, setUsers] = useState<User[]>([]);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const formatDateTimeLocal = (isoString: string): string => {
        const d = new Date(isoString);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const [startLocal, setStartLocal] = useState(formatDateTimeLocal(defaultStart));
    const [endLocal, setEndLocal] = useState(formatDateTimeLocal(defaultEnd));

    useEffect(() => {
        setStart(new Date(startLocal).toISOString());
    }, [startLocal]);

    useEffect(() => {
        setEnd(new Date(endLocal).toISOString());
    }, [endLocal]);

    const searchUsers = useCallback(async (query: string) => {
        if (!query || query.length < 2) {
            setUsers([]);
            setShowDropdown(false);
            return;
        }
        setLoadingUsers(true);
        try {
            const data = await client.getUsers(query);
            setUsers(data.users || []);
            setShowDropdown(true);
        } catch {
            setUsers([]);
        } finally {
            setLoadingUsers(false);
        }
    }, []);

    const handleQueryChange = (value: string) => {
        setUserQuery(value);
        setSelectedUser(null);
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => searchUsers(value), 300);
    };

    const handleSelectUser = (user: User) => {
        setSelectedUser(user);
        setUserQuery(user.name);
        setShowDropdown(false);
    };

    const handleSubmit = async () => {
        if (!selectedUser) {
            setError('Please select a user');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await client.createOverride(scheduleId, start, end, selectedUser.id);
            onSuccess();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create override');
        } finally {
            setSubmitting(false);
        }
    };

    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, []);

    return (
        <div
            className='override-dialog-overlay'
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
            }}
            onClick={onClose}
        >
            <div
                className='override-dialog'
                style={{
                    backgroundColor: theme.centerChannelBg,
                    borderRadius: '8px',
                    padding: '24px',
                    width: '360px',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 style={{margin: '0 0 4px 0', color: theme.centerChannelColor, fontSize: '16px'}}>
                    {'Override Shift'}
                </h3>
                <div style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.6, marginBottom: '16px'}}>
                    {scheduleName}
                </div>

                {error && (
                    <div
                        role='alert'
                        style={{
                            backgroundColor: (theme.errorTextColor || '#d32f2f') + '15',
                            color: theme.errorTextColor || '#d32f2f',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            marginBottom: '12px',
                            fontSize: '13px',
                        }}
                    >
                        {error}
                    </div>
                )}

                {/* User search */}
                <label style={{display: 'block', marginBottom: '12px'}}>
                    <span style={{fontSize: '13px', fontWeight: 500, color: theme.centerChannelColor, display: 'block', marginBottom: '4px'}}>
                        {'Assign to'}
                    </span>
                    <div style={{position: 'relative'}}>
                        <input
                            type='text'
                            value={userQuery}
                            onChange={(e) => handleQueryChange(e.target.value)}
                            onFocus={() => {
                                if (users.length > 0 && !selectedUser) {
                                    setShowDropdown(true);
                                }
                            }}
                            placeholder='Search users...'
                            style={{
                                width: '100%',
                                padding: '8px 12px',
                                border: `1px solid ${theme.centerChannelColor}30`,
                                borderRadius: '4px',
                                fontSize: '13px',
                                backgroundColor: theme.centerChannelBg,
                                color: theme.centerChannelColor,
                                boxSizing: 'border-box',
                            }}
                        />
                        {loadingUsers && (
                            <div style={{position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: theme.centerChannelColor, opacity: 0.5}}>
                                {'...'}
                            </div>
                        )}
                        {showDropdown && users.length > 0 && (
                            <div
                                className='override-user-dropdown'
                                style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    backgroundColor: theme.centerChannelBg,
                                    border: `1px solid ${theme.centerChannelColor}30`,
                                    borderRadius: '0 0 4px 4px',
                                    maxHeight: '160px',
                                    overflow: 'auto',
                                    zIndex: 1,
                                    boxShadow: `0 4px 12px ${theme.centerChannelColor}20`,
                                }}
                            >
                                {users.map((user) => (
                                    <button
                                        key={user.id}
                                        onClick={() => handleSelectUser(user)}
                                        style={{
                                            display: 'block',
                                            width: '100%',
                                            padding: '8px 12px',
                                            border: 'none',
                                            backgroundColor: 'transparent',
                                            color: theme.centerChannelColor,
                                            fontSize: '13px',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <div style={{fontWeight: 500}}>{user.name}</div>
                                        {user.email && (
                                            <div style={{fontSize: '11px', opacity: 0.6}}>{user.email}</div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </label>

                {/* Start time */}
                <label style={{display: 'block', marginBottom: '12px'}}>
                    <span style={{fontSize: '13px', fontWeight: 500, color: theme.centerChannelColor, display: 'block', marginBottom: '4px'}}>
                        {'Start'}
                    </span>
                    <input
                        type='datetime-local'
                        value={startLocal}
                        onChange={(e) => setStartLocal(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: `1px solid ${theme.centerChannelColor}30`,
                            borderRadius: '4px',
                            fontSize: '13px',
                            backgroundColor: theme.centerChannelBg,
                            color: theme.centerChannelColor,
                            boxSizing: 'border-box',
                        }}
                    />
                </label>

                {/* End time */}
                <label style={{display: 'block', marginBottom: '16px'}}>
                    <span style={{fontSize: '13px', fontWeight: 500, color: theme.centerChannelColor, display: 'block', marginBottom: '4px'}}>
                        {'End'}
                    </span>
                    <input
                        type='datetime-local'
                        value={endLocal}
                        onChange={(e) => setEndLocal(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: `1px solid ${theme.centerChannelColor}30`,
                            borderRadius: '4px',
                            fontSize: '13px',
                            backgroundColor: theme.centerChannelBg,
                            color: theme.centerChannelColor,
                            boxSizing: 'border-box',
                        }}
                    />
                </label>

                {/* Actions */}
                <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px'}}>
                    <button
                        onClick={onClose}
                        style={{
                            backgroundColor: 'transparent',
                            color: theme.centerChannelColor,
                            border: `1px solid ${theme.centerChannelColor}30`,
                            borderRadius: '4px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            cursor: 'pointer',
                        }}
                    >
                        {'Cancel'}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting || !selectedUser}
                        style={{
                            backgroundColor: theme.buttonBg,
                            color: theme.buttonColor,
                            border: 'none',
                            borderRadius: '4px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: submitting || !selectedUser ? 'not-allowed' : 'pointer',
                            opacity: submitting || !selectedUser ? 0.6 : 1,
                        }}
                    >
                        {submitting ? 'Creating...' : 'Create Override'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OverrideDialog;
