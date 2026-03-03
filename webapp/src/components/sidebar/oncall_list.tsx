// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';

import type {OnCall, User} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    onCalls: OnCall[];
    theme: Theme;
    loading: boolean;
    error: string | null;
    onPageUser?: (user: User) => void;
    onScheduleClick?: (scheduleId: string) => void;
    onRetry?: () => void;
}

interface ScheduleInfo {
    id?: string;
    name: string;
    escalationLevel: number;
}

interface GroupedUser {
    user: User;
    schedules: ScheduleInfo[];
}

const LoadingSkeleton: React.FC<{theme: Theme}> = ({theme}) => (
    <div aria-busy='true'>
        {[1, 2, 3].map((i) => (
            <div
                key={i}
                className='skeleton-item'
                style={{
                    height: '44px',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    backgroundColor: theme.centerChannelColor + '10',
                    animation: 'pagerduty-skeleton-pulse 1.5s ease-in-out infinite',
                }}
            />
        ))}
    </div>
);

const groupByUser = (onCalls: OnCall[]): GroupedUser[] => {
    const userMap = new Map<string, GroupedUser>();

    for (const oncall of onCalls) {
        const existing = userMap.get(oncall.user.id);
        const scheduleInfo: ScheduleInfo = {
            id: oncall.schedule?.id,
            name: oncall.schedule?.name || 'Unknown Schedule',
            escalationLevel: oncall.escalation_level,
        };

        if (existing) {
            // Avoid duplicate schedule entries for the same user
            const alreadyHas = existing.schedules.some(
                (s) => s.name === scheduleInfo.name && s.escalationLevel === scheduleInfo.escalationLevel,
            );
            if (!alreadyHas) {
                existing.schedules.push(scheduleInfo);
            }
        } else {
            userMap.set(oncall.user.id, {
                user: oncall.user,
                schedules: [scheduleInfo],
            });
        }
    }

    return Array.from(userMap.values());
};

const OnCallList: React.FC<Props> = ({onCalls, theme, loading, error, onPageUser, onScheduleClick, onRetry}) => {
    const [searchQuery, setSearchQuery] = useState('');

    if (loading) {
        return <LoadingSkeleton theme={theme}/>;
    }

    if (error) {
        return (
            <div
                role='alert'
                style={{color: theme.errorTextColor, fontSize: '14px'}}
            >
                {`Error: ${error}`}
                {onRetry && (
                    <button
                        className='retry-button'
                        onClick={onRetry}
                        aria-label='Retry loading on-call users'
                        style={{
                            display: 'block',
                            marginTop: '8px',
                            backgroundColor: 'transparent',
                            color: theme.linkColor,
                            border: `1px solid ${theme.linkColor}`,
                            borderRadius: '4px',
                            padding: '4px 12px',
                            fontSize: '13px',
                            cursor: 'pointer',
                        }}
                    >
                        {'Retry'}
                    </button>
                )}
            </div>
        );
    }

    if (!onCalls || onCalls.length === 0) {
        return (
            <div style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '14px', textAlign: 'center', padding: '24px 16px'}}>
                <div style={{fontSize: '24px', marginBottom: '8px'}}>{'No one is currently on-call across your schedules.'}</div>
            </div>
        );
    }

    const groupedUsers = groupByUser(onCalls);

    // Filter by search query
    const filteredUsers = groupedUsers.filter((entry) => {
        if (!searchQuery) {
            return true;
        }
        const query = searchQuery.toLowerCase();
        if (entry.user.name?.toLowerCase().includes(query)) {
            return true;
        }
        if (entry.user.email?.toLowerCase().includes(query)) {
            return true;
        }
        return entry.schedules.some((s) => s.name.toLowerCase().includes(query));
    });

    const showSearch = groupedUsers.length > 5;

    return (
        <div className='oncall-list'>
            {showSearch && (
                <input
                    type='text'
                    placeholder='Search on-call users...'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label='Search on-call users'
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        marginBottom: '12px',
                        border: `1px solid ${theme.centerChannelColor}20`,
                        borderRadius: '4px',
                        fontSize: '13px',
                        backgroundColor: theme.centerChannelBg,
                        color: theme.centerChannelColor,
                        boxSizing: 'border-box',
                    }}
                />
            )}
            {filteredUsers.length === 0 && searchQuery && (
                <div style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '14px'}}>
                    {'No on-call users match your search.'}
                </div>
            )}
            {filteredUsers.map((entry, index) => (
                <div
                    key={entry.user.id}
                    className='oncall-user-row'
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '10px 0',
                        borderBottom: index < filteredUsers.length - 1 ? `1px solid ${theme.centerChannelColor}10` : 'none',
                    }}
                >
                    {entry.user.avatar_url ? (
                        <img
                            src={entry.user.avatar_url}
                            alt={entry.user.name}
                            style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                marginRight: '10px',
                                flexShrink: 0,
                            }}
                        />
                    ) : (
                        <div
                            style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                marginRight: '10px',
                                flexShrink: 0,
                                backgroundColor: theme.centerChannelColor + '20',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: theme.centerChannelColor,
                            }}
                        >
                            {entry.user.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                    )}
                    <div style={{flex: 1, minWidth: 0}}>
                        <div
                            title={entry.user.email || entry.user.name}
                            style={{
                                fontWeight: 500,
                                fontSize: '13px',
                                color: theme.centerChannelColor,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap' as const,
                            }}
                        >
                            {entry.user.name}
                        </div>
                        <div
                            style={{
                                fontSize: '12px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap' as const,
                            }}
                        >
                            {entry.schedules.map((s, i) => (
                                <React.Fragment key={s.id || s.name}>
                                    {i > 0 && (
                                        <span style={{color: theme.centerChannelColor, opacity: 0.4}}>
                                            {' \u00B7 '}
                                        </span>
                                    )}
                                    {onScheduleClick && s.id ? (
                                        <button
                                            className='oncall-schedule-link'
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onScheduleClick(s.id!);
                                            }}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                padding: 0,
                                                fontSize: '12px',
                                                color: theme.linkColor,
                                                cursor: 'pointer',
                                                textDecoration: 'none',
                                            }}
                                        >
                                            {s.name}
                                        </button>
                                    ) : (
                                        <span style={{color: theme.centerChannelColor, opacity: 0.6}}>
                                            {s.name}
                                        </span>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                    {onPageUser && (
                        <button
                            className='page-oncall-button'
                            onClick={(e) => {
                                e.stopPropagation();
                                onPageUser(entry.user);
                            }}
                            aria-label={`Page ${entry.user.name}`}
                            style={{
                                backgroundColor: theme.buttonBg,
                                color: theme.buttonColor,
                                border: 'none',
                                borderRadius: '4px',
                                padding: '4px 10px',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                marginLeft: '8px',
                                whiteSpace: 'nowrap' as const,
                                flexShrink: 0,
                            }}
                        >
                            {'Page'}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
};

export default OnCallList;
