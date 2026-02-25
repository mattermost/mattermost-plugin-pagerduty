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
    onRetry?: () => void;
}

const LoadingSkeleton: React.FC<{theme: Theme}> = ({theme}) => (
    <div aria-busy='true'>
        {[1, 2, 3].map((i) => (
            <div
                key={i}
                className='skeleton-item'
                style={{
                    height: '56px',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    backgroundColor: theme.centerChannelColor + '10',
                    animation: 'pagerduty-skeleton-pulse 1.5s ease-in-out infinite',
                }}
            />
        ))}
    </div>
);

const OnCallList: React.FC<Props> = ({onCalls, theme, loading, error, onPageUser, onRetry}) => {
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

    // Group on-calls by schedule
    const oncallsBySchedule = onCalls.reduce((acc, oncall) => {
        const scheduleName = oncall.schedule?.name || 'Unknown Schedule';
        if (!acc[scheduleName]) {
            acc[scheduleName] = [];
        }
        acc[scheduleName].push(oncall);
        return acc;
    }, {} as Record<string, OnCall[]>);

    // Filter by search query
    const filteredEntries = Object.entries(oncallsBySchedule).filter(([scheduleName, scheduleOncalls]) => {
        if (!searchQuery) {
            return true;
        }
        const query = searchQuery.toLowerCase();
        if (scheduleName.toLowerCase().includes(query)) {
            return true;
        }
        return scheduleOncalls.some((oc) =>
            oc.user.name?.toLowerCase().includes(query) ||
            oc.user.email?.toLowerCase().includes(query),
        );
    });

    const showSearch = Object.keys(oncallsBySchedule).length > 5;

    return (
        <div className='oncall-list'>
            <div
                style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: theme.centerChannelColor,
                    marginBottom: '16px',
                }}
            >
                {'Currently On-Call'}
            </div>
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
            {filteredEntries.length === 0 && searchQuery && (
                <div style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '14px'}}>
                    {'No on-call users match your search.'}
                </div>
            )}
            {filteredEntries.map(([scheduleName, scheduleOncalls]) => (
                <div
                    key={scheduleName}
                    style={{marginBottom: '16px'}}
                >
                    <div
                        style={{
                            fontSize: '13px',
                            fontWeight: 500,
                            color: theme.centerChannelColor,
                            opacity: 0.8,
                            marginBottom: '8px',
                        }}
                    >
                        {scheduleName}
                    </div>
                    {scheduleOncalls.map((oncall, index) => (
                        <div
                            key={`${oncall.user.id}-${index}`}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '8px',
                                backgroundColor: theme.centerChannelBg,
                                border: `1px solid ${theme.centerChannelColor}20`,
                                borderRadius: '4px',
                                marginBottom: '8px',
                            }}
                        >
                            {oncall.user.avatar_url && (
                                <img
                                    src={oncall.user.avatar_url}
                                    alt={oncall.user.name}
                                    style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '50%',
                                        marginRight: '12px',
                                    }}
                                />
                            )}
                            <div style={{flex: 1, minWidth: 0}}>
                                <div style={{fontWeight: 500, color: theme.centerChannelColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const}}>
                                    {oncall.user.name}
                                </div>
                                <div style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.7}}>
                                    {oncall.user.email}
                                </div>
                                {oncall.escalation_level > 0 && (
                                    <div style={{fontSize: '11px', color: theme.centerChannelColor, opacity: 0.5}}>
                                        {`Level ${oncall.escalation_level}`}
                                    </div>
                                )}
                            </div>
                            {onPageUser && (
                                <button
                                    className='page-oncall-button'
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onPageUser(oncall.user);
                                    }}
                                    aria-label={`Page ${oncall.user.name}`}
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
                                    }}
                                >
                                    {'Page'}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

export default OnCallList;
