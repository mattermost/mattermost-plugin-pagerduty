// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useRef, useState} from 'react';

import client from '@/client/client';
import type {PTOOverrideResponse, ScheduleEntry, User} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    theme: Theme;
    scheduleId: string;
    scheduleName: string;
    entries: ScheduleEntry[];
    currentUser?: User;
    onClose: () => void;
    onSuccess: (response: PTOOverrideResponse) => void;
}

const formatDateTimeLocal = (date: Date): string => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const PTOOverrideDialog: React.FC<Props> = ({
    theme,
    scheduleId,
    scheduleName,
    entries,
    currentUser,
    onClose,
    onSuccess,
}) => {
    // Derive unique users from the schedule entries
    const scheduleUsers = React.useMemo(() => {
        const seen = new Map<string, User>();
        for (const entry of entries) {
            if (entry.user && !seen.has(entry.user.id)) {
                seen.set(entry.user.id, entry.user);
            }
        }
        return Array.from(seen.values());
    }, [entries]);

    const [targetUserId, setTargetUserId] = useState('');
    const [coverUserId, setCoverUserId] = useState(currentUser?.id || '');

    // Date range defaults: start = now, end = 1 week from now
    const now = new Date();
    const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [startLocal, setStartLocal] = useState(formatDateTimeLocal(now));
    const [endLocal, setEndLocal] = useState(formatDateTimeLocal(oneWeekLater));

    // Cover user search
    const [coverQuery, setCoverQuery] = useState(currentUser?.name || '');
    const [searchResults, setSearchResults] = useState<User[]>([]);
    const [loadingSearch, setLoadingSearch] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedCoverUser, setSelectedCoverUser] = useState<User | null>(currentUser || null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PTOOverrideResponse | null>(null);

    // Count how many shifts the target user has in the selected range
    const affectedShiftCount = React.useMemo(() => {
        if (!targetUserId) {
            return 0;
        }
        const start = new Date(startLocal);
        const end = new Date(endLocal);
        let count = 0;
        for (const entry of entries) {
            if (entry.user.id !== targetUserId) {
                continue;
            }
            const entryStart = new Date(entry.start);
            const entryEnd = new Date(entry.end);
            // Shift overlaps with the selected range
            if (entryStart < end && entryEnd > start) {
                count++;
            }
        }
        return count;
    }, [targetUserId, startLocal, endLocal, entries]);

    const searchUsers = useCallback(async (query: string) => {
        if (!query || query.length < 2) {
            setSearchResults([]);
            setShowDropdown(false);
            return;
        }
        setLoadingSearch(true);
        try {
            const data = await client.getUsers(query);
            setSearchResults(data.users || []);
            setShowDropdown(true);
        } catch {
            setSearchResults([]);
        } finally {
            setLoadingSearch(false);
        }
    }, []);

    const handleCoverQueryChange = (value: string) => {
        setCoverQuery(value);
        setSelectedCoverUser(null);
        setCoverUserId('');
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => searchUsers(value), 300);
    };

    const handleSelectCoverUser = (user: User) => {
        setSelectedCoverUser(user);
        setCoverUserId(user.id);
        setCoverQuery(user.name);
        setShowDropdown(false);
    };

    const handleSubmit = async () => {
        if (!targetUserId) {
            setError('Please select the person going on PTO');
            return;
        }
        if (!coverUserId) {
            setError('Please select a cover person');
            return;
        }
        if (targetUserId === coverUserId) {
            setError('Cover person must be different from the PTO person');
            return;
        }

        const start = new Date(startLocal).toISOString();
        const end = new Date(endLocal).toISOString();

        setSubmitting(true);
        setError(null);
        try {
            const response = await client.createPTOOverride(scheduleId, start, end, targetUserId, coverUserId);
            setResult(response);
            if (response.created > 0) {
                onSuccess(response);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create PTO overrides');
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

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '8px 12px',
        border: `1px solid ${theme.centerChannelColor}30`,
        borderRadius: '4px',
        fontSize: '13px',
        backgroundColor: theme.centerChannelBg,
        color: theme.centerChannelColor,
        boxSizing: 'border-box',
    };

    const labelStyle: React.CSSProperties = {
        fontSize: '13px',
        fontWeight: 500,
        color: theme.centerChannelColor,
        display: 'block',
        marginBottom: '4px',
    };

    return (
        <div
            className='pto-override-dialog-overlay'
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
                className='pto-override-dialog'
                style={{
                    backgroundColor: theme.centerChannelBg,
                    borderRadius: '8px',
                    padding: '24px',
                    width: '400px',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 style={{margin: '0 0 4px 0', color: theme.centerChannelColor, fontSize: '16px'}}>
                    {'PTO Override'}
                </h3>
                <div style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.6, marginBottom: '16px'}}>
                    {`Override all shifts for a person on ${scheduleName}`}
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

                {/* Show result summary if we have one */}
                {result && (
                    <div
                        role='status'
                        style={{
                            backgroundColor: result.failed === 0 ?
                                (theme.onlineIndicator || '#28a745') + '15' :
                                (theme.errorTextColor || '#d32f2f') + '15',
                            color: result.failed === 0 ?
                                (theme.onlineIndicator || '#28a745') :
                                (theme.errorTextColor || '#d32f2f'),
                            padding: '12px',
                            borderRadius: '4px',
                            marginBottom: '12px',
                            fontSize: '13px',
                        }}
                    >
                        {result.total_shifts === 0 && (
                            <span>{'No shifts found for this person in the selected date range.'}</span>
                        )}
                        {result.total_shifts > 0 && result.failed === 0 && (
                            <span>{`Successfully overrode ${result.created} shift${result.created !== 1 ? 's' : ''}.`}</span>
                        )}
                        {result.total_shifts > 0 && result.failed > 0 && (
                            <span>{`Created ${result.created} of ${result.total_shifts} overrides. ${result.failed} failed.`}</span>
                        )}
                    </div>
                )}

                {!result && (
                    <>
                        {/* Person going on PTO */}
                        <label style={{display: 'block', marginBottom: '12px'}}>
                            <span style={labelStyle}>{'Person on PTO'}</span>
                            <select
                                value={targetUserId}
                                onChange={(e) => setTargetUserId(e.target.value)}
                                style={inputStyle}
                            >
                                <option value=''>{'Select person...'}</option>
                                {scheduleUsers.map((user) => (
                                    <option
                                        key={user.id}
                                        value={user.id}
                                    >
                                        {user.name || user.summary}
                                    </option>
                                ))}
                            </select>
                        </label>

                        {/* Cover person (user search) */}
                        <label style={{display: 'block', marginBottom: '12px'}}>
                            <span style={labelStyle}>{'Covering person'}</span>
                            <div style={{position: 'relative'}}>
                                <input
                                    type='text'
                                    value={coverQuery}
                                    onChange={(e) => handleCoverQueryChange(e.target.value)}
                                    onFocus={() => {
                                        if (searchResults.length > 0 && !selectedCoverUser) {
                                            setShowDropdown(true);
                                        }
                                    }}
                                    placeholder='Search users...'
                                    style={inputStyle}
                                />
                                {loadingSearch && (
                                    <div style={{position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: theme.centerChannelColor, opacity: 0.5}}>
                                        {'...'}
                                    </div>
                                )}
                                {showDropdown && searchResults.length > 0 && (
                                    <div
                                        className='pto-user-dropdown'
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
                                        {searchResults.map((user) => (
                                            <button
                                                key={user.id}
                                                onClick={() => handleSelectCoverUser(user)}
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

                        {/* Start date */}
                        <label style={{display: 'block', marginBottom: '12px'}}>
                            <span style={labelStyle}>{'PTO starts'}</span>
                            <input
                                type='datetime-local'
                                value={startLocal}
                                onChange={(e) => setStartLocal(e.target.value)}
                                style={inputStyle}
                            />
                        </label>

                        {/* End date */}
                        <label style={{display: 'block', marginBottom: '12px'}}>
                            <span style={labelStyle}>{'PTO ends'}</span>
                            <input
                                type='datetime-local'
                                value={endLocal}
                                onChange={(e) => setEndLocal(e.target.value)}
                                style={inputStyle}
                            />
                        </label>

                        {/* Shift count preview */}
                        {targetUserId && (
                            <div
                                className='pto-shift-preview'
                                style={{
                                    backgroundColor: `${theme.centerChannelColor}08`,
                                    padding: '10px 12px',
                                    borderRadius: '4px',
                                    marginBottom: '16px',
                                    fontSize: '13px',
                                    color: theme.centerChannelColor,
                                }}
                            >
                                {affectedShiftCount === 0 ? (
                                    <span style={{opacity: 0.6}}>
                                        {'No shifts found in the selected range. The server will check the full schedule.'}
                                    </span>
                                ) : (
                                    <span>
                                        {`${affectedShiftCount} shift${affectedShiftCount !== 1 ? 's' : ''} will be overridden in the visible 48h window. `}
                                        <span style={{opacity: 0.6}}>{'The full date range will be checked server-side.'}</span>
                                    </span>
                                )}
                            </div>
                        )}
                    </>
                )}

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
                        {result ? 'Close' : 'Cancel'}
                    </button>
                    {!result && (
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !targetUserId || !coverUserId}
                            style={{
                                backgroundColor: theme.buttonBg,
                                color: theme.buttonColor,
                                border: 'none',
                                borderRadius: '4px',
                                padding: '8px 16px',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: submitting || !targetUserId || !coverUserId ? 'not-allowed' : 'pointer',
                                opacity: submitting || !targetUserId || !coverUserId ? 0.6 : 1,
                            }}
                        >
                            {submitting ? 'Creating overrides...' : 'Create PTO Override'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PTOOverrideDialog;
