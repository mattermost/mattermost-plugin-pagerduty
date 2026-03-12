// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react';

import {OverrideDialog} from './override_dialog';
import {PagingDialog} from './paging_dialog';
import {BulkOverrideDialog} from './pto_override_dialog';

import client from '@/client/client';
import type {BulkOverrideResponse, Schedule, User, CreateIncidentResponse} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    schedule: Schedule | null;
    onBack: () => void;
    theme: Theme;
    loading: boolean;
    currentUser?: User;
    onOverrideCreated?: () => void;
}

const ScheduleDetails: React.FC<Props> = ({schedule, theme, loading, currentUser, onOverrideCreated}) => {
    const [showPagingDialog, setShowPagingDialog] = useState(false);
    const [pagingTarget, setPagingTarget] = useState<{type: 'schedule' | 'user'; target: Schedule | User} | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Override state
    const [showOverrideDialog, setShowOverrideDialog] = useState(false);
    const [overrideEntry, setOverrideEntry] = useState<{start: string; end: string} | null>(null);
    const [takingShift, setTakingShift] = useState<string | null>(null);

    // Bulk override state
    const [showBulkOverrideDialog, setShowBulkOverrideDialog] = useState(false);

    useEffect(() => {
        return () => {
            if (successTimeoutRef.current) {
                clearTimeout(successTimeoutRef.current);
            }
        };
    }, []);

    const entries = schedule?.final_schedule?.rendered_schedule_entries || [];

    const getCurrentOnCallUser = (): User | null => {
        const now = new Date();
        for (const entry of entries) {
            const startTime = new Date(entry.start);
            const endTime = new Date(entry.end);
            if (now >= startTime && now <= endTime) {
                return entry.user;
            }
        }
        return null;
    };

    const formatRelativeTime = (startTime: Date, endTime: Date, now: Date) => {
        if (now >= startTime && now <= endTime) {
            // Currently on-call - show time remaining
            const remaining = endTime.getTime() - now.getTime();
            const hours = Math.floor(remaining / (1000 * 60 * 60));
            const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

            if (hours > 0) {
                return `${hours}h ${minutes}m remaining`;
            } else if (minutes > 0) {
                return `${minutes}m remaining`;
            }
            return 'Ending soon';
        } else if (now < startTime) {
            // Future shift - show when it starts
            const until = startTime.getTime() - now.getTime();
            const hours = Math.floor(until / (1000 * 60 * 60));
            const minutes = Math.floor((until % (1000 * 60 * 60)) / (1000 * 60));

            if (hours > 24) {
                const days = Math.floor(hours / 24);
                return `Starts in ${days}d ${hours % 24}h`;
            } else if (hours > 0) {
                return `Starts in ${hours}h ${minutes}m`;
            } else if (minutes > 0) {
                return `Starts in ${minutes}m`;
            }
            return 'Starting soon';
        }

        // Past shift
        return 'Completed';
    };

    const formatSmartDate = (date: Date, now: Date): string => {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const time = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

        if (diffDays === 0) {
            return `Today ${time}`;
        }
        if (diffDays === 1) {
            return `Tomorrow ${time}`;
        }
        if (diffDays === -1) {
            return `Yesterday ${time}`;
        }
        return `${date.toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'})} ${time}`;
    };

    const formatTimeRange = (startTime: Date, endTime: Date, now: Date): string => {
        const startDay = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
        const endDay = new Date(endTime.getFullYear(), endTime.getMonth(), endTime.getDate());
        const sameDay = startDay.getTime() === endDay.getTime();

        if (sameDay) {
            const startStr = formatSmartDate(startTime, now);
            const endTime2 = endTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            return `${startStr} \u2013 ${endTime2}`;
        }

        return `${formatSmartDate(startTime, now)} \u2013 ${formatSmartDate(endTime, now)}`;
    };

    const handlePageSchedule = () => {
        const currentOnCallUser = getCurrentOnCallUser();
        if (currentOnCallUser) {
            setPagingTarget({type: 'user', target: currentOnCallUser});
            setShowPagingDialog(true);
        } else if (schedule) {
            // Fallback to schedule if no current on-call user found
            setPagingTarget({type: 'schedule', target: schedule});
            setShowPagingDialog(true);
        }
    };

    const showTemporarySuccess = (msg: string, durationMs = 5000) => {
        setSuccessMessage(msg);
        if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current);
        }
        successTimeoutRef.current = setTimeout(() => setSuccessMessage(null), durationMs);
    };

    const handlePagingSuccess = (incident: CreateIncidentResponse) => {
        showTemporarySuccess(`Incident created: ${incident.incident.title}`);
        setShowPagingDialog(false);
        setPagingTarget(null);
    };

    const handleClosePagingDialog = () => {
        setShowPagingDialog(false);
        setPagingTarget(null);
    };

    const handleTakeShift = async (entryStart: string, entryEnd: string) => {
        if (!currentUser || !schedule) {
            return;
        }
        const entryKey = `${entryStart}-${entryEnd}`;
        setTakingShift(entryKey);
        try {
            // For current shift, start from now instead of the entry start
            const now = new Date();
            const start = new Date(entryStart) <= now ? now.toISOString() : entryStart;
            await client.createOverride(schedule.id, start, entryEnd, currentUser.id);
            showTemporarySuccess('Shift taken successfully');
            if (onOverrideCreated) {
                onOverrideCreated();
            }
        } catch (err) {
            setSuccessMessage(null);
            setError(err instanceof Error ? err.message : 'Failed to take shift');
        } finally {
            setTakingShift(null);
        }
    };

    const [error, setError] = useState<string | null>(null);

    const handleOpenOverrideDialog = (entryStart: string, entryEnd: string) => {
        setOverrideEntry({start: entryStart, end: entryEnd});
        setShowOverrideDialog(true);
    };

    const handleOverrideSuccess = () => {
        setShowOverrideDialog(false);
        setOverrideEntry(null);
        showTemporarySuccess('Override created successfully');
        if (onOverrideCreated) {
            onOverrideCreated();
        }
    };

    const handleBulkOverrideSuccess = (response: BulkOverrideResponse) => {
        const msg = response.failed === 0
            ? `Bulk override complete: ${response.created} shift${response.created !== 1 ? 's' : ''} overridden`
            : `Bulk override: ${response.created} created, ${response.failed} failed`;
        showTemporarySuccess(msg, 8000);
        if (onOverrideCreated) {
            onOverrideCreated();
        }
    };

    if (loading) {
        return (
            <div
                style={{padding: '20px', color: theme.centerChannelColor}}
                aria-busy='true'
            >
                {[1, 2, 3].map((i) => (
                    <div
                        key={i}
                        className='skeleton-item'
                        style={{
                            height: '72px',
                            borderRadius: '8px',
                            marginBottom: '12px',
                            backgroundColor: theme.centerChannelColor + '10',
                            animation: 'pagerduty-skeleton-pulse 1.5s ease-in-out infinite',
                        }}
                    />
                ))}
            </div>
        );
    }

    if (!schedule) {
        return (
            <div style={{padding: '20px', color: theme.centerChannelColor}}>
                {'No schedule selected'}
            </div>
        );
    }

    return (
        <div
            className='schedule-details-container'
            data-testid='schedule-details'
        >
            {successMessage && (
                <div
                    className='success-message'
                    role='status'
                    style={{
                        backgroundColor: theme.onlineIndicator || '#28a745',
                        color: 'white',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        marginBottom: '12px',
                        fontSize: '13px',
                    }}
                >
                    {successMessage}
                </div>
            )}
            {error && (
                <div
                    className='error-message'
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

            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px'}}>
                <h4
                    className='schedule-section-title'
                    style={{
                        color: theme.centerChannelColor,
                        margin: 0,
                        fontSize: '14px',
                        fontWeight: 600,
                    }}
                >
                    {schedule.name}
                </h4>
                {currentUser && (
                    <button
                        className='bulk-override-button'
                        onClick={() => setShowBulkOverrideDialog(true)}
                        aria-label='Bulk Override'
                        style={{
                            backgroundColor: 'transparent',
                            color: theme.linkColor,
                            border: `1px solid ${theme.linkColor}40`,
                            borderRadius: '4px',
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap' as const,
                        }}
                    >
                        {'Bulk Override'}
                    </button>
                )}
            </div>

            {!schedule.final_schedule && (
                <div
                    className='no-schedule-message'
                    style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '13px'}}
                >
                    {'No on-call schedule available'}
                </div>
            )}

            {schedule.final_schedule && entries.length === 0 && (
                <div
                    className='no-entries-message'
                    style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '13px'}}
                >
                    {'No on-call entries for this schedule'}
                </div>
            )}

            {entries.map((entry, index) => {
                const now = new Date();
                const startTime = new Date(entry.start);
                const endTime = new Date(entry.end);
                const isCurrentlyOnCall = now >= startTime && now <= endTime;
                const isPastEntry = now > endTime;
                const entryKey = `${entry.start}-${entry.end}`;

                // Add section divider for first future entry after current/past entries
                const prevEntry = index > 0 ? entries[index - 1] : null;
                const prevEndTime = prevEntry ? new Date(prevEntry.end) : null;
                const showUpcomingDivider = !isCurrentlyOnCall && !isPastEntry &&
                    (!prevEndTime || now > prevEndTime || (now >= new Date(prevEntry!.start) && now <= prevEndTime));

                return (
                    <React.Fragment key={`${entry.user.id}-${entry.start}-${index}`}>
                        {showUpcomingDivider && (
                            <div
                                className='upcoming-shifts-divider'
                                style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    color: theme.centerChannelColor,
                                    opacity: 0.5,
                                    textTransform: 'uppercase' as const,
                                    letterSpacing: '0.5px',
                                    padding: '8px 0 4px 0',
                                }}
                            >
                                {'Upcoming'}
                            </div>
                        )}
                        <div
                            className={`schedule-entry ${isCurrentlyOnCall ? 'current-oncall' : ''} ${isPastEntry ? 'past-entry' : ''}`}
                            data-testid={`schedule-entry-${index}`}
                            style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                padding: '10px 0',
                                borderBottom: `1px solid ${theme.centerChannelColor}10`,
                                borderLeft: isCurrentlyOnCall ? `3px solid ${theme.onlineIndicator}` : '3px solid transparent',
                                paddingLeft: '10px',
                                backgroundColor: isCurrentlyOnCall ? theme.onlineIndicator + '08' : 'transparent',
                                opacity: isPastEntry ? 0.5 : 1,
                            }}
                        >
                            {entry.user.avatar_url && (
                                <img
                                    className='user-avatar'
                                    src={entry.user.avatar_url}
                                    alt={entry.user.name}
                                    style={{
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '50%',
                                        marginRight: '10px',
                                        marginTop: '1px',
                                        flexShrink: 0,
                                    }}
                                />
                            )}
                            <div
                                className='user-info'
                                style={{flex: 1, minWidth: 0}}
                            >
                                <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between'}}>
                                    <span
                                        className='user-name'
                                        style={{
                                            fontWeight: 500,
                                            color: theme.centerChannelColor,
                                            fontSize: '13px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                        title={entry.user.email || entry.user.name}
                                    >
                                        {entry.user.name || entry.user.summary}
                                    </span>
                                    <span
                                        className='relative-time'
                                        style={{
                                            fontSize: '12px',
                                            color: isCurrentlyOnCall ? theme.onlineIndicator : theme.centerChannelColor,
                                            fontWeight: isCurrentlyOnCall ? 600 : 400,
                                            opacity: isCurrentlyOnCall ? 1 : 0.6,
                                            whiteSpace: 'nowrap',
                                            marginLeft: '8px',
                                            flexShrink: 0,
                                        }}
                                    >
                                        {formatRelativeTime(startTime, endTime, now)}
                                    </span>
                                </div>
                                <div
                                    className='absolute-time'
                                    style={{
                                        fontSize: '12px',
                                        color: theme.centerChannelColor,
                                        opacity: 0.5,
                                        marginTop: '2px',
                                    }}
                                >
                                    {formatTimeRange(startTime, endTime, now)}
                                </div>
                                {/* Action buttons */}
                                {!isPastEntry && (
                                    <div
                                        className='entry-actions'
                                        style={{display: 'flex', gap: '6px', marginTop: '6px'}}
                                    >
                                        {isCurrentlyOnCall && (
                                            <button
                                                className='page-button'
                                                onClick={handlePageSchedule}
                                                aria-label={`Page ${entry.user.name || entry.user.summary}`}
                                                style={{
                                                    backgroundColor: theme.dndIndicator || '#d32f2f',
                                                    color: '#ffffff',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '4px 8px',
                                                    fontSize: '11px',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    whiteSpace: 'nowrap' as const,
                                                }}
                                            >
                                                {'Page'}
                                            </button>
                                        )}
                                        {currentUser && entry.user.id !== currentUser.id && (
                                            <button
                                                className='take-shift-button'
                                                onClick={() => handleTakeShift(entry.start, entry.end)}
                                                disabled={takingShift === entryKey}
                                                aria-label='Take this shift'
                                                style={{
                                                    backgroundColor: theme.buttonBg,
                                                    color: theme.buttonColor,
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '4px 8px',
                                                    fontSize: '11px',
                                                    fontWeight: 600,
                                                    cursor: takingShift === entryKey ? 'not-allowed' : 'pointer',
                                                    opacity: takingShift === entryKey ? 0.6 : 1,
                                                    whiteSpace: 'nowrap' as const,
                                                }}
                                            >
                                                {takingShift === entryKey ? 'Taking...' : 'Take'}
                                            </button>
                                        )}
                                        {currentUser && (
                                            <button
                                                className='override-button'
                                                onClick={() => handleOpenOverrideDialog(entry.start, entry.end)}
                                                aria-label='Override this shift'
                                                style={{
                                                    backgroundColor: 'transparent',
                                                    color: theme.linkColor,
                                                    border: `1px solid ${theme.linkColor}40`,
                                                    borderRadius: '4px',
                                                    padding: '4px 8px',
                                                    fontSize: '11px',
                                                    fontWeight: 500,
                                                    cursor: 'pointer',
                                                    whiteSpace: 'nowrap' as const,
                                                }}
                                            >
                                                {'Override'}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </React.Fragment>
                );
            })}

            {showPagingDialog && pagingTarget && (
                <div className='paging-dialog-container'>
                    <PagingDialog
                        theme={theme}
                        targetType={pagingTarget.type}
                        target={pagingTarget.target}
                        onClose={handleClosePagingDialog}
                        onSuccess={handlePagingSuccess}
                    />
                </div>
            )}

            {showOverrideDialog && overrideEntry && schedule && (
                <OverrideDialog
                    theme={theme}
                    scheduleId={schedule.id}
                    scheduleName={schedule.name}
                    defaultStart={overrideEntry.start}
                    defaultEnd={overrideEntry.end}
                    onClose={() => {
                        setShowOverrideDialog(false);
                        setOverrideEntry(null);
                    }}
                    onSuccess={handleOverrideSuccess}
                />
            )}

            {showBulkOverrideDialog && schedule && (
                <BulkOverrideDialog
                    theme={theme}
                    scheduleId={schedule.id}
                    scheduleName={schedule.name}
                    entries={entries}
                    currentUser={currentUser}
                    onClose={() => setShowBulkOverrideDialog(false)}
                    onSuccess={handleBulkOverrideSuccess}
                />
            )}
        </div>
    );
};

export default ScheduleDetails;
