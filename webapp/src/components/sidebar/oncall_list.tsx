// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {OnCall, User} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    onCalls: OnCall[];
    theme: Theme;
    loading: boolean;
    error: string | null;
    onPageUser?: (user: User) => void;
}

const OnCallList: React.FC<Props> = ({onCalls, theme, loading, error, onPageUser}) => {
    if (loading) {
        return (
            <div style={{color: theme.centerChannelColor, fontSize: '14px'}}>
                {'Loading on-call users...'}
            </div>
        );
    }

    if (error) {
        return (
            <div style={{color: theme.errorTextColor, fontSize: '14px'}}>
                {`Error: ${error}`}
            </div>
        );
    }

    if (!onCalls || onCalls.length === 0) {
        return (
            <div style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '14px'}}>
                {'No one is currently on-call'}
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
            {Object.entries(oncallsBySchedule).map(([scheduleName, scheduleOncalls]) => (
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
                            <div style={{flex: 1}}>
                                <div style={{fontWeight: 500, color: theme.centerChannelColor}}>
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
