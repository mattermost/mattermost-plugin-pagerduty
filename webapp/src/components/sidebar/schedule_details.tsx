// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';

import {PagingDialog} from './paging_dialog';

import type {Schedule, User, CreateIncidentResponse} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    schedule: Schedule | null;
    onBack: () => void;
    theme: Theme;
    loading: boolean;
}

const ScheduleDetails: React.FC<Props> = ({schedule, theme, loading}) => {
    const [showPagingDialog, setShowPagingDialog] = useState(false);
    const [pagingTarget, setPagingTarget] = useState<{type: 'schedule' | 'user'; target: Schedule | User} | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
        setTimeout(() => setSuccessMessage(null), 5000);
    };

    const handleClosePagingDialog = () => {
        setShowPagingDialog(false);
        setPagingTarget(null);
    };

    if (loading) {
        return (
            <div style={{padding: '20px', color: theme.centerChannelColor}}>
                {'Loading schedule details...'}
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

    const entries = schedule.final_schedule?.rendered_schedule_entries || [];

    return (
        <div
            className='schedule-details-container'
            style={{padding: '20px'}}
        >
            {successMessage && (
                <div
                    className='success-message'
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
                                    display: 'flex',
                                    alignItems: 'center',
                                    boxShadow: isCurrentlyOnCall ? `0 2px 8px ${theme.onlineIndicator}30` : 'none',
                                    position: 'relative' as const,
                                    opacity: isPastEntry ? 0.6 : 1,
                                }}
                            >
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
                                    style={{flex: 1}}
                                >
                                    <div
                                        className='user-name-row'
                                        style={{display: 'flex', alignItems: 'center', gap: '8px', margin: '0 auto 0 0'}}
                                    >
                                        <div
                                            className='user-name'
                                            style={{fontWeight: 500, color: theme.centerChannelColor, fontSize: '14px'}}
                                        >
                                            {entry.user.name || entry.user.summary}
                                        </div>
                                        {isCurrentlyOnCall && (
                                            <div
                                                className='oncall-badge'
                                                style={{
                                                    fontSize: '10px',
                                                    fontWeight: 600,
                                                    color: 'white',
                                                    padding: '2px 6px',
                                                    backgroundColor: theme.onlineIndicator,
                                                    borderRadius: '4px',
                                                    textTransform: 'uppercase' as const,
                                                    letterSpacing: '0.5px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '2px',
                                                }}
                                            >
                                                {'🕐 ON-CALL'}
                                            </div>
                                        )}
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
                                {isCurrentlyOnCall && (
                                    <button
                                        className='page-button'
                                        onClick={handlePageSchedule}
                                        style={{
                                            backgroundColor: theme.buttonBg,
                                            color: theme.buttonColor,
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '8px 12px',
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            marginLeft: '12px',
                                            whiteSpace: 'nowrap' as const,
                                            boxShadow: `0 2px 4px ${theme.centerChannelColor}20`,
                                        }}
                                    >
                                        {'📟 Page Now'}
                                    </button>
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
        </div>
    );
};

export default ScheduleDetails;
