// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState, useRef, useEffect} from 'react';

import type {Schedule} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    schedules: Schedule[];
    onScheduleClick: (scheduleId: string) => void;
    theme: Theme;
    loading: boolean;
    error: string | null;
    onRetry?: () => void;
}

const LoadingSkeleton: React.FC<{theme: Theme}> = ({theme}) => (
    <div aria-busy='true'>
        {[1, 2, 3].map((i) => (
            <div
                key={i}
                className='skeleton-item'
                style={{
                    height: '68px',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    backgroundColor: theme.centerChannelColor + '10',
                    animation: 'pagerduty-skeleton-pulse 1.5s ease-in-out infinite',
                }}
            />
        ))}
    </div>
);

const ScheduleList: React.FC<Props> = ({schedules, onScheduleClick, theme, loading, error, onRetry}) => {
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [searchQuery, setSearchQuery] = useState('');
    const scheduleRefs = useRef<Array<HTMLDivElement | null>>([]);

    useEffect(() => {
        // Reset refs array when schedules change
        scheduleRefs.current = scheduleRefs.current.slice(0, schedules.length);
    }, [schedules.length]);

    const filteredSchedules = searchQuery ?
        schedules.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase())) :
        schedules;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = focusedIndex < filteredSchedules.length - 1 ? focusedIndex + 1 : 0;
            setFocusedIndex(nextIndex);
            scheduleRefs.current[nextIndex]?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = focusedIndex > 0 ? focusedIndex - 1 : filteredSchedules.length - 1;
            setFocusedIndex(prevIndex);
            scheduleRefs.current[prevIndex]?.focus();
        } else if (e.key === 'Enter' && focusedIndex >= 0) {
            e.preventDefault();
            onScheduleClick(filteredSchedules[focusedIndex].id);
        }
    };

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
                        aria-label='Retry loading schedules'
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

    if (schedules.length === 0) {
        return (
            <div style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '14px', textAlign: 'center', padding: '24px 16px'}}>
                {'No schedules found. Verify your PagerDuty configuration.'}
            </div>
        );
    }

    const showSearch = schedules.length > 5;

    return (
        <div
            className='schedule-list'
            onKeyDown={handleKeyDown}
        >
            {showSearch && (
                <input
                    type='text'
                    placeholder='Search schedules...'
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setFocusedIndex(-1);
                    }}
                    aria-label='Search schedules'
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
            <div style={{marginBottom: '12px', color: theme.centerChannelColor, fontSize: '14px', opacity: 0.7}}>
                {`${filteredSchedules.length} schedule${filteredSchedules.length === 1 ? '' : 's'}`}
            </div>
            {filteredSchedules.length === 0 && searchQuery && (
                <div style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '14px'}}>
                    {'No schedules match your search.'}
                </div>
            )}
            {filteredSchedules.map((schedule, index) => (
                <div
                    key={schedule.id}
                    ref={(el) => {
                        scheduleRefs.current[index] = el;
                    }}
                    data-testid={`schedule-${schedule.id}`}
                    tabIndex={0}
                    role='button'
                    aria-label={`View schedule: ${schedule.name}`}
                    onClick={() => onScheduleClick(schedule.id)}
                    onFocus={() => setFocusedIndex(index)}
                    style={{
                        padding: '12px',
                        marginBottom: '8px',
                        backgroundColor: theme.centerChannelBg,
                        border: `1px solid ${theme.centerChannelColor}20`,
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        outline: focusedIndex === index ? `2px solid ${theme.buttonBg}` : 'none',
                        outlineOffset: '-1px',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = `${theme.centerChannelColor}10`;
                        e.currentTarget.style.borderColor = theme.buttonBg;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = theme.centerChannelBg;
                        e.currentTarget.style.borderColor = `${theme.centerChannelColor}20`;
                    }}
                >
                    <div style={{fontWeight: 500, color: theme.centerChannelColor, marginBottom: '4px'}}>
                        {schedule.name}
                    </div>
                    {schedule.description && (
                        <div style={{fontSize: '13px', color: theme.centerChannelColor, opacity: 0.7}}>
                            {schedule.description}
                        </div>
                    )}
                    <div style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.5, marginTop: '4px'}}>
                        {schedule.time_zone}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default ScheduleList;
