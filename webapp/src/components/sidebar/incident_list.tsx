// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';

import type {Incident, IncidentFilters, Schedule, User} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    incidents: Incident[];
    theme: Theme;
    loading: boolean;
    error: string | null;
    onIncidentClick: (incident: Incident) => void;
    onAcknowledge: (incidentId: string) => Promise<void>;
    onResolve: (incidentId: string) => Promise<void>;
    schedules: Schedule[];
    users: User[];
    filters: IncidentFilters;
    onFiltersChange: (filters: IncidentFilters) => void;
    userScheduleMap: Record<string, string>;
}

const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ago`;
    }
    if (hours > 0) {
        return `${hours}h ago`;
    }
    if (minutes > 0) {
        return `${minutes}m ago`;
    }
    return 'Just now';
};

const getStatusColor = (status: string, theme: Theme): string => {
    switch (status) {
    case 'triggered':
        return theme.dndIndicator || '#f74343';
    case 'acknowledged':
        return theme.awayIndicator || '#ffbc42';
    case 'resolved':
        return theme.onlineIndicator || '#06d6a0';
    default:
        return theme.centerChannelColor;
    }
};

const getStatusLabel = (status: string): string => {
    switch (status) {
    case 'triggered':
        return 'Triggered';
    case 'acknowledged':
        return 'Acknowledged';
    case 'resolved':
        return 'Resolved';
    default:
        return status;
    }
};

const IncidentList: React.FC<Props> = ({incidents, theme, loading, error, onIncidentClick, onAcknowledge, onResolve, schedules, users, filters, onFiltersChange, userScheduleMap}) => {
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const hasActiveFilters = Boolean(filters.scheduleId || (filters.userIds && filters.userIds.length > 0));

    const selectStyle: React.CSSProperties = {
        flex: 1,
        minWidth: '0',
        padding: '6px 8px',
        borderRadius: '4px',
        border: `1px solid ${theme.centerChannelColor}20`,
        backgroundColor: theme.centerChannelBg,
        color: theme.centerChannelColor,
        fontSize: '12px',
    };

    const handleAction = async (e: React.MouseEvent, incidentId: string, action: (id: string) => Promise<void>) => {
        e.stopPropagation();
        setActionLoading(incidentId);
        try {
            await action(incidentId);
        } finally {
            setActionLoading(null);
        }
    };

    const filterBar = (
        <div
            className='incident-filters'
            style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '12px',
                alignItems: 'center',
            }}
        >
            <select
                className='incident-filter-schedule'
                value={filters.scheduleId || ''}
                onChange={(e) => onFiltersChange({
                    ...filters,
                    scheduleId: e.target.value || undefined,
                })}
                style={selectStyle}
            >
                <option value=''>{'All Schedules'}</option>
                {schedules.map((s) => (
                    <option
                        key={s.id}
                        value={s.id}
                    >
                        {s.name}
                    </option>
                ))}
            </select>
            <select
                className='incident-filter-user'
                value={(filters.userIds && filters.userIds[0]) || ''}
                onChange={(e) => onFiltersChange({
                    ...filters,
                    userIds: e.target.value ? [e.target.value] : undefined,
                })}
                style={selectStyle}
            >
                <option value=''>{'All Responders'}</option>
                {users.map((u) => (
                    <option
                        key={u.id}
                        value={u.id}
                    >
                        {u.name}
                    </option>
                ))}
            </select>
            {hasActiveFilters && (
                <button
                    className='incident-filter-clear'
                    onClick={() => onFiltersChange({})}
                    style={{
                        backgroundColor: 'transparent',
                        color: theme.linkColor,
                        border: 'none',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        whiteSpace: 'nowrap' as const,
                    }}
                >
                    {'Clear'}
                </button>
            )}
        </div>
    );

    if (loading) {
        return (
            <div>
                {filterBar}
                <div style={{color: theme.centerChannelColor, fontSize: '14px'}}>
                    {'Loading incidents...'}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div>
                {filterBar}
                <div style={{color: theme.errorTextColor, fontSize: '14px'}}>
                    {`Error: ${error}`}
                </div>
            </div>
        );
    }

    if (!incidents || incidents.length === 0) {
        return (
            <div>
                {filterBar}
                <div style={{color: theme.centerChannelColor, opacity: 0.7, fontSize: '14px'}}>
                    {hasActiveFilters ? 'No incidents match the selected filters' : 'No active incidents'}
                </div>
            </div>
        );
    }

    return (
        <div className='incident-list'>
            {filterBar}
            <div
                style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: theme.centerChannelColor,
                    marginBottom: '16px',
                }}
            >
                {'Active Incidents'}
            </div>
            {incidents.map((incident) => {
                const statusColor = getStatusColor(incident.status || '', theme);
                const isLoading = actionLoading === incident.id;
                const assigneeSchedules = (incident.assignments || []).map((a) => userScheduleMap[a.assignee.id]);
                const scheduleName = assigneeSchedules.find(Boolean) || null;

                return (
                    <div
                        key={incident.id}
                        className={`incident-card incident-${incident.status}`}
                        data-testid={`incident-${incident.id}`}
                        onClick={() => onIncidentClick(incident)}
                        style={{
                            padding: '12px',
                            backgroundColor: statusColor + '10',
                            border: `1px solid ${statusColor}40`,
                            borderRadius: '8px',
                            marginBottom: '10px',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = statusColor + '20';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = statusColor + '10';
                        }}
                    >
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px'}}>
                            <span
                                className='incident-status-badge'
                                style={{
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    color: 'white',
                                    padding: '2px 6px',
                                    backgroundColor: statusColor,
                                    borderRadius: '4px',
                                    textTransform: 'uppercase' as const,
                                    letterSpacing: '0.5px',
                                }}
                            >
                                {getStatusLabel(incident.status || '')}
                            </span>
                            {incident.created_at && (
                                <span style={{fontSize: '11px', color: theme.centerChannelColor, opacity: 0.5}}>
                                    {formatTimeAgo(incident.created_at)}
                                </span>
                            )}
                        </div>

                        <div
                            className='incident-title'
                            style={{
                                fontWeight: 500,
                                color: theme.centerChannelColor,
                                fontSize: '14px',
                                marginBottom: '4px',
                            }}
                        >
                            {incident.title}
                        </div>

                        <div style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.7, marginBottom: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap'}}>
                            {incident.service?.summary && (
                                <span>{incident.service.summary}</span>
                            )}
                            {scheduleName && (
                                <span>
                                    {incident.service?.summary ? '·' : ''}
                                    {` ${scheduleName}`}
                                </span>
                            )}
                        </div>

                        <div style={{display: 'flex', gap: '6px'}}>
                            {incident.status === 'triggered' && (
                                <button
                                    className='incident-ack-button'
                                    disabled={isLoading}
                                    onClick={(e) => handleAction(e, incident.id, onAcknowledge)}
                                    style={{
                                        backgroundColor: theme.awayIndicator || '#ffbc42',
                                        color: '#1e1e1e',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '4px 10px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        cursor: isLoading ? 'default' : 'pointer',
                                        opacity: isLoading ? 0.6 : 1,
                                    }}
                                >
                                    {isLoading ? 'Updating...' : 'Acknowledge'}
                                </button>
                            )}
                            {(incident.status === 'triggered' || incident.status === 'acknowledged') && (
                                <button
                                    className='incident-resolve-button'
                                    disabled={isLoading}
                                    onClick={(e) => handleAction(e, incident.id, onResolve)}
                                    style={{
                                        backgroundColor: theme.onlineIndicator || '#06d6a0',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '4px 10px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        cursor: isLoading ? 'default' : 'pointer',
                                        opacity: isLoading ? 0.6 : 1,
                                    }}
                                >
                                    {isLoading ? 'Updating...' : 'Resolve'}
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default IncidentList;
