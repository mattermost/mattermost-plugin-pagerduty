// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useRef, useState} from 'react';

import client from '@/client/client';
import type {BulkOverridePreviewResponse, BulkOverrideResponse, ScheduleEntry, User} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    theme: Theme;
    scheduleId: string;
    scheduleName: string;
    entries: ScheduleEntry[];
    currentUser?: User;
    onClose: () => void;
    onSuccess: (response: BulkOverrideResponse) => void;
}

const formatDateTimeLocal = (date: Date): string => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const BulkOverrideDialog: React.FC<Props> = ({
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

    // Date range defaults: start = now, end = 1 week from now
    const [startLocal, setStartLocal] = useState(() => formatDateTimeLocal(new Date()));
    const [endLocal, setEndLocal] = useState(() => {
        const weekFromNow = new Date();
        weekFromNow.setDate(weekFromNow.getDate() + 7);
        return formatDateTimeLocal(weekFromNow);
    });

    // Cover user search
    const [coverQuery, setCoverQuery] = useState(currentUser?.name || '');
    const [searchResults, setSearchResults] = useState<User[]>([]);
    const [loadingSearch, setLoadingSearch] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedCoverUser, setSelectedCoverUser] = useState<User | null>(currentUser || null);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<BulkOverrideResponse | null>(null);

    // Live preview from server
    const [preview, setPreview] = useState<BulkOverridePreviewResponse | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Fetch live preview when target user + date range are set
    const fetchPreview = useCallback(async (target: string, start: string, end: string) => {
        if (!target || !start || !end) {
            setPreview(null);
            return;
        }

        const startDate = new Date(start);
        const endDate = new Date(end);

        if (endDate <= startDate) {
            setPreview(null);
            return;
        }

        setLoadingPreview(true);
        try {
            const data = await client.getBulkOverridePreview(scheduleId, startDate.toISOString(), endDate.toISOString(), target);
            setPreview(data);
        } catch {
            setPreview(null);
        } finally {
            setLoadingPreview(false);
        }
    }, [scheduleId]);

    // Debounce preview fetches when inputs change
    useEffect(() => {
        if (previewDebounceRef.current) {
            clearTimeout(previewDebounceRef.current);
        }
        previewDebounceRef.current = setTimeout(() => {
            fetchPreview(targetUserId, startLocal, endLocal);
        }, 500);

        return () => {
            if (previewDebounceRef.current) {
                clearTimeout(previewDebounceRef.current);
            }
        };
    }, [targetUserId, startLocal, endLocal, fetchPreview]);

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
        if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
        }
        searchDebounceRef.current = setTimeout(() => searchUsers(value), 300);
    };

    const handleSelectCoverUser = (user: User) => {
        setSelectedCoverUser(user);
        setCoverQuery(user.name);
        setShowDropdown(false);
    };

    const coverUserId = selectedCoverUser?.id || '';

    const handleSubmit = async () => {
        if (!targetUserId) {
            setError('Please select the person to override');
            return;
        }
        if (!selectedCoverUser) {
            setError('Please select a cover person');
            return;
        }
        if (targetUserId === selectedCoverUser.id) {
            setError('Cover person must be different from the person being overridden');
            return;
        }

        const start = new Date(startLocal).toISOString();
        const end = new Date(endLocal).toISOString();

        setSubmitting(true);
        setError(null);
        try {
            const response = await client.createBulkOverride(scheduleId, start, end, targetUserId, selectedCoverUser.id);
            setResult(response);
            if (response.created > 0) {
                onSuccess(response);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create overrides');
        } finally {
            setSubmitting(false);
        }
    };

    // Clean up search debounce on unmount (preview debounce is cleaned up by its own effect)
    useEffect(() => {
        return () => {
            if (searchDebounceRef.current) {
                clearTimeout(searchDebounceRef.current);
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
            className='bulk-override-dialog-overlay'
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
                className='bulk-override-dialog'
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
                    {'Bulk Override'}
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
                        {/* Person to override */}
                        <label style={{display: 'block', marginBottom: '12px'}}>
                            <span style={labelStyle}>{'Person to override'}</span>
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
                                        className='bulk-override-user-dropdown'
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
                            <span style={labelStyle}>{'Start'}</span>
                            <input
                                type='datetime-local'
                                value={startLocal}
                                onChange={(e) => setStartLocal(e.target.value)}
                                style={inputStyle}
                            />
                        </label>

                        {/* End date */}
                        <label style={{display: 'block', marginBottom: '12px'}}>
                            <span style={labelStyle}>{'End'}</span>
                            <input
                                type='datetime-local'
                                value={endLocal}
                                onChange={(e) => setEndLocal(e.target.value)}
                                style={inputStyle}
                            />
                        </label>

                        {/* Live shift count preview from server */}
                        {targetUserId && (
                            <div
                                className='bulk-override-shift-preview'
                                style={{
                                    backgroundColor: `${theme.centerChannelColor}08`,
                                    padding: '10px 12px',
                                    borderRadius: '4px',
                                    marginBottom: '16px',
                                    fontSize: '13px',
                                    color: theme.centerChannelColor,
                                }}
                            >
                                {loadingPreview && (
                                    <span style={{opacity: 0.6}}>{'Loading shift preview...'}</span>
                                )}
                                {!loadingPreview && preview && preview.total_shifts === 0 && (
                                    <span style={{opacity: 0.6}}>
                                        {'No shifts found for this person in the selected date range.'}
                                    </span>
                                )}
                                {!loadingPreview && preview && preview.total_shifts > 0 && (
                                    <span>
                                        {`${preview.total_shifts} shift${preview.total_shifts !== 1 ? 's' : ''} will be overridden.`}
                                    </span>
                                )}
                                {!loadingPreview && !preview && (
                                    <span style={{opacity: 0.6}}>
                                        {'Select a valid date range to preview affected shifts.'}
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
                            {submitting ? 'Creating overrides...' : 'Create Bulk Override'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BulkOverrideDialog;
