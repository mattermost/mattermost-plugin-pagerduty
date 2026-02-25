// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react';

import {OverrideDialog} from './override_dialog';
import {PagingDialog} from './paging_dialog';

import client from '@/client/client';
import type {Schedule, User, CreateIncidentResponse} from '@/types/pagerduty';
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

    const handlePagingSuccess = (incident: CreateIncidentResponse) => {
        setSuccessMessage(`Incident created: ${incident.incident.title}`);
        setShowPagingDialog(false);
        setPagingTarget(null);

        // Clear success message after 5 seconds
        if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current);
        }
        successTimeoutRef.current = setTimeout(() => setSuccessMessage(null), 5000);
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
            setSuccessMessage('Shift taken successfully');
            if (successTimeoutRef.current) {
                clearTimeout(successTimeoutRef.current);
            }
            successTimeoutRef.current = setTimeout(() => setSuccessMessage(null), 5000);
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
        setSuccessMessage('Override created successfully');
        if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current);
        }
        successTimeoutRef.current = setTimeout(() => setSuccessMessage(null), 5000);
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
            style={{padding: '20px'}}
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
                        marginBottom: '16px',
                        fontSize: '14px',
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
                        marginBottom: '16px',
                        fontSize: '14px',
                    }}
                >
                    {error}
                </div>
            )}

            <div
                className='schedule-entries-section'
                style={{marginBottom: '20px'}}
            >
                <h4
                    className='schedule-section-title'
                    style={{color: theme.centerChannelColor, marginBottom: '16px', fontSize: '16px', fontWeight: 600}}
                >
                    {'On-Call Schedule'}
                </h4>

                {!schedule.final_schedule && (
                    <div
                        className='no-schedule-message'
                        style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '14px'}}
                    >
                        {'No on-call schedule available'}
                    </div>
                )}

                {schedule.final_schedule && entries.length === 0 && (
                    <div
                        className='no-entries-message'
                        style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '14px'}}
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
                                        borderTop: `1px solid ${theme.centerChannelColor}30`,
                                        marginTop: '16px',
                                        marginBottom: '16px',
                                        paddingTop: '12px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        color: theme.centerChannelColor,
                                        opacity: 0.7,
                                        textTransform: 'uppercase' as const,
                                        letterSpacing: '0.5px',
                                    }}
                                >
                                    {'Upcoming Shifts'}
                                </div>
                            )}
                            <div
                                className={`schedule-entry ${isCurrentlyOnCall ? 'current-oncall' : ''} ${isPastEntry ? 'past-entry' : ''}`}
                                data-testid={`schedule-entry-${index}`}
                                style={{
                                    padding: '16px',
                                    backgroundColor: isCurrentlyOnCall ? theme.onlineIndicator + '15' : theme.centerChannelBg,
                                    border: `2px solid ${isCurrentlyOnCall ? theme.onlineIndicator : theme.centerChannelColor + '20'}`,
                                    borderRadius: '8px',
                                    marginBottom: '12px',
                                    boxShadow: isCurrentlyOnCall ? `0 2px 8px ${theme.onlineIndicator}30` : 'none',
                                    position: 'relative' as const,
                                    opacity: isPastEntry ? 0.6 : 1,
                                }}
                            >
                                <div style={{display: 'flex', alignItems: 'center'}}>
                                    {entry.user.avatar_url && (
                                        <img
                                            className='user-avatar'
                                            src={entry.user.avatar_url}
                                            alt={entry.user.name}
                                            style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                marginRight: '12px',
                                            }}
                                        />
                                    )}
                                    <div
                                        className='user-info'
                                        style={{flex: 1, minWidth: 0}}
                                    >
                                        <div
                                            className='user-name'
                                            style={{fontWeight: 500, color: theme.centerChannelColor, fontSize: '14px'}}
                                        >
                                            {entry.user.name || entry.user.summary}
                                        </div>
                                        {entry.user.email && (
                                            <div
                                                className='user-email'
                                                style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.7}}
                                            >
                                                {entry.user.email}
                                            </div>
                                        )}
                                        <div className='time-info'>
                                            <div
                                                className='relative-time'
                                                style={{fontSize: '12px', color: isCurrentlyOnCall ? theme.onlineIndicator : theme.centerChannelColor, fontWeight: isCurrentlyOnCall ? 600 : 400}}
                                            >
                                                {formatRelativeTime(startTime, endTime, now)}
                                            </div>
                                            <div
                                                className='absolute-time'
                                                style={{fontSize: '11px', color: theme.centerChannelColor, opacity: 0.5, marginTop: '2px'}}
                                            >
                                                {`${startTime.toLocaleDateString()} ${startTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} - ${endTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {/* Action buttons */}
                                {!isPastEntry && (
                                    <div
                                        className='entry-actions'
                                        style={{display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '10px'}}
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
                                                    padding: '5px 10px',
                                                    fontSize: '11px',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    whiteSpace: 'nowrap' as const,
                                                }}
                                            >
                                                {'Page Now'}
                                            </button>
                                        )}
                                        {currentUser && entry.user.id !== currentUser.id && (
                                            <button
                                                className='take-shift-button'
                                                onClick={() => handleTakeShift(entry.start, entry.end)}
                                                disabled={takingShift === `${entry.start}-${entry.end}`}
                                                aria-label='Take this shift'
                                                style={{
                                                    backgroundColor: theme.buttonBg,
                                                    color: theme.buttonColor,
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '5px 10px',
                                                    fontSize: '11px',
                                                    fontWeight: 600,
                                                    cursor: takingShift === `${entry.start}-${entry.end}` ? 'not-allowed' : 'pointer',
                                                    opacity: takingShift === `${entry.start}-${entry.end}` ? 0.6 : 1,
                                                    whiteSpace: 'nowrap' as const,
                                                }}
                                            >
                                                {takingShift === `${entry.start}-${entry.end}` ? 'Taking...' : 'Take'}
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
                                                    border: `1px solid ${theme.linkColor}50`,
                                                    borderRadius: '4px',
                                                    padding: '5px 10px',
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
                        </React.Fragment>
                    );
                })}
            </div>

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
        </div>
    );
};

export default ScheduleDetails;
