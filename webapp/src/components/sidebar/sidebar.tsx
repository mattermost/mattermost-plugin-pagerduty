// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useRef, useState} from 'react';

import IncidentDetails from './incident_details';
import IncidentList from './incident_list';
import OnCallList from './oncall_list';
import {PagingDialog} from './paging_dialog';
import ScheduleDetails from './schedule_details';
import ScheduleList from './schedule_list';

import client from '@/client/client';
import type {Incident, IncidentFilters, OnCall, Schedule, User, CreateIncidentResponse} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

type TabName = 'oncall' | 'schedules' | 'incidents';

const REFRESH_INTERVAL_MS = 30000;
const CONNECTION_POLL_INTERVAL_MS = 1000;

interface Props {
    theme: Theme;
}

const formatTimeAgo = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) {
        return 'just now';
    }
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
};

const PagerDutySidebar: React.FC<Props> = ({theme}) => {
    // Connection state: null = checking, true = connected, false = not connected
    const [connected, setConnected] = useState<boolean | null>(null);

    // Tab state
    const [activeTab, setActiveTab] = useState<TabName>('oncall');

    // On-Call tab state
    const [onCalls, setOnCalls] = useState<OnCall[]>([]);

    // Schedules tab state
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);

    // Incidents tab state
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
    const [incidentFilters, setIncidentFilters] = useState<IncidentFilters>({});
    const [filterSchedules, setFilterSchedules] = useState<Schedule[]>([]);
    const [filterUsers, setFilterUsers] = useState<User[]>([]);
    const [userScheduleMap, setUserScheduleMap] = useState<Record<string, string>>({});

    // Shared state
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

    // Paging dialog state (shared between On-Call and Schedules tabs)
    const [showPagingDialog, setShowPagingDialog] = useState(false);
    const [pagingTarget, setPagingTarget] = useState<{type: 'user'; target: User} | null>(null);
    const [pagingSuccess, setPagingSuccess] = useState<string | null>(null);

    // Track if user is interacting with a form (to skip auto-refresh)
    const isInteractingRef = useRef(false);

    // Check connection status
    const checkConnection = useCallback(async () => {
        try {
            const status = await client.getConnectionStatus();
            setConnected(status.connected);
            return status.connected;
        } catch {
            setConnected(false);
            return false;
        }
    }, []);

    // Initial connection check
    useEffect(() => {
        checkConnection();
    }, [checkConnection]);

    // Handle connect button — open popup and poll for connection
    const handleConnect = useCallback(() => {
        const connectUrl = client.getConnectUrl();
        const popup = window.open(connectUrl, 'pagerduty-oauth', 'width=600,height=700');

        const pollInterval = setInterval(async () => {
            // Check if popup was closed
            if (popup && popup.closed) {
                clearInterval(pollInterval);
                const isConnected = await checkConnection();
                if (isConnected) {
                    setLoading(true);
                }
            }
        }, CONNECTION_POLL_INTERVAL_MS);

        // Safety cleanup after 5 minutes
        setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
    }, [checkConnection]);

    // Handle disconnect
    const handleDisconnect = useCallback(async () => {
        try {
            await client.disconnect();
            setConnected(false);
            setOnCalls([]);
            setSchedules([]);
            setIncidents([]);
            setLastRefreshed(null);
        } catch {
            // Disconnect failed silently
        }
    }, []);

    // Data fetching functions
    const fetchOnCalls = useCallback(async (silent = false) => {
        try {
            if (!silent) {
                setLoading(true);
            }
            setError(null);
            const data = await client.getOnCalls();
            setOnCalls(data.oncalls || []);
            setLastRefreshed(new Date());
        } catch (err) {
            if (!silent) {
                setError(err instanceof Error ? err.message : 'Failed to load on-call users');
            }
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, []);

    const fetchSchedules = useCallback(async (silent = false) => {
        try {
            if (!silent) {
                setLoading(true);
            }
            setError(null);
            const data = await client.getSchedules();
            setSchedules(data.schedules || []);
            setLastRefreshed(new Date());
        } catch (err) {
            if (!silent) {
                setError(err instanceof Error ? err.message : 'Failed to load schedules');
            }
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, []);

    const fetchIncidents = useCallback(async (silent = false, filters?: IncidentFilters) => {
        try {
            if (!silent) {
                setLoading(true);
            }
            setError(null);
            const data = await client.getIncidents(filters);
            setIncidents(data.incidents || []);
            setLastRefreshed(new Date());
        } catch (err) {
            if (!silent) {
                setError(err instanceof Error ? err.message : 'Failed to load incidents');
            }
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, []);

    const loadFilterOptions = useCallback(async () => {
        try {
            const [schedulesData, onCallsData] = await Promise.all([
                client.getSchedules(),
                client.getOnCalls(),
            ]);
            setFilterSchedules(schedulesData.schedules || []);
            const usersMap = new Map<string, User>();
            const scheduleMap: Record<string, string> = {};
            for (const oc of (onCallsData.oncalls || [])) {
                if (oc.user && !usersMap.has(oc.user.id)) {
                    usersMap.set(oc.user.id, oc.user);
                }
                if (oc.user && oc.schedule?.name && !scheduleMap[oc.user.id]) {
                    scheduleMap[oc.user.id] = oc.schedule.name;
                }
            }
            setFilterUsers(Array.from(usersMap.values()));
            setUserScheduleMap(scheduleMap);
        } catch {
            // Filter options failing shouldn't block incidents
        }
    }, []);

    // Initial load for default tab (only when connected)
    useEffect(() => {
        if (connected) {
            fetchOnCalls();
        }
    }, [connected, fetchOnCalls]);

    // Auto-refresh (only when connected)
    useEffect(() => {
        if (!connected) {
            return undefined;
        }
        const interval = setInterval(() => {
            if (isInteractingRef.current) {
                return;
            }
            switch (activeTab) {
            case 'oncall':
                fetchOnCalls(true);
                break;
            case 'schedules':
                if (!selectedSchedule) {
                    fetchSchedules(true);
                }
                break;
            case 'incidents':
                if (!selectedIncident) {
                    fetchIncidents(true, incidentFilters);
                }
                break;
            }
        }, REFRESH_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [connected, activeTab, selectedSchedule, selectedIncident, incidentFilters, fetchOnCalls, fetchSchedules, fetchIncidents]);

    // Tab change handler
    const handleTabChange = (tab: TabName) => {
        if (tab === activeTab) {
            return;
        }
        setActiveTab(tab);
        setError(null);
        setSelectedSchedule(null);
        setSelectedIncident(null);
        switch (tab) {
        case 'oncall':
            fetchOnCalls();
            break;
        case 'schedules':
            fetchSchedules();
            break;
        case 'incidents':
            fetchIncidents(false, incidentFilters);
            loadFilterOptions();
            break;
        }
    };

    // Schedule handlers
    const handleScheduleClick = async (scheduleId: string) => {
        if (selectedSchedule?.id === scheduleId) {
            setSelectedSchedule(null);
            return;
        }
        setLoadingDetails(true);
        try {
            const scheduleDetails = await client.getScheduleDetails(scheduleId);
            setSelectedSchedule(scheduleDetails.schedule);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load schedule details');
        } finally {
            setLoadingDetails(false);
        }
    };

    // Incident handlers
    const handleIncidentClick = (incident: Incident) => {
        setSelectedIncident(incident);
    };

    const handleAcknowledge = async (incidentId: string) => {
        await client.updateIncident(incidentId, 'acknowledged');
        await fetchIncidents(true, incidentFilters);
    };

    const handleResolve = async (incidentId: string) => {
        await client.updateIncident(incidentId, 'resolved');
        await fetchIncidents(true, incidentFilters);
    };

    const handleIncidentFiltersChange = useCallback((newFilters: IncidentFilters) => {
        setIncidentFilters(newFilters);
        fetchIncidents(false, newFilters);
    }, [fetchIncidents]);

    const handleIncidentUpdated = (updatedIncident: Incident) => {
        setSelectedIncident(updatedIncident);
        setIncidents((prev) =>
            prev.map((inc) => (inc.id === updatedIncident.id ? updatedIncident : inc)),
        );
    };

    // Paging handlers
    const handlePageUser = (user: User) => {
        setPagingTarget({type: 'user', target: user});
        setShowPagingDialog(true);
    };

    const handlePagingSuccess = (incident: CreateIncidentResponse) => {
        setShowPagingDialog(false);
        setPagingTarget(null);
        setPagingSuccess(`Incident created: ${incident.incident.title}`);
        setTimeout(() => setPagingSuccess(null), 5000);
    };

    const handleClosePagingDialog = () => {
        setShowPagingDialog(false);
        setPagingTarget(null);
    };

    // Back handler for detail views
    const handleBack = () => {
        if (selectedSchedule) {
            setSelectedSchedule(null);
        } else if (selectedIncident) {
            setSelectedIncident(null);
            fetchIncidents(true, incidentFilters);
        }
    };

    // Refresh handler
    const handleRefresh = () => {
        switch (activeTab) {
        case 'oncall':
            fetchOnCalls();
            break;
        case 'schedules':
            if (selectedSchedule) {
                handleScheduleClick(selectedSchedule.id);
            } else {
                fetchSchedules();
            }
            break;
        case 'incidents':
            if (selectedIncident) {
                // Refresh notes by re-selecting
                setSelectedIncident({...selectedIncident});
            } else {
                fetchIncidents(false, incidentFilters);
            }
            break;
        }
    };

    // Determine header title
    const getHeaderTitle = (): string => {
        if (selectedSchedule) {
            return selectedSchedule.name || 'Schedule Details';
        }
        if (selectedIncident) {
            return 'Incident Details';
        }
        return 'PagerDuty';
    };

    const showBackButton = selectedSchedule !== null || selectedIncident !== null;

    const tabs: Array<{key: TabName; label: string}> = [
        {key: 'oncall', label: 'On-Call'},
        {key: 'schedules', label: 'Schedules'},
        {key: 'incidents', label: 'Incidents'},
    ];

    // Connection check loading state
    if (connected === null) {
        return (
            <div
                className='pagerduty-sidebar'
                style={{height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}
            >
                <p style={{color: theme.centerChannelColor, opacity: 0.6}}>{'Loading...'}</p>
            </div>
        );
    }

    // Not connected — show connect screen
    if (!connected) {
        return (
            <div
                className='pagerduty-sidebar'
                style={{height: '100%', display: 'flex', flexDirection: 'column'}}
            >
                <div
                    style={{
                        padding: '12px 16px',
                        borderBottom: `1px solid ${theme.centerChannelColor}20`,
                    }}
                >
                    <h3 style={{margin: 0, color: theme.centerChannelColor, fontSize: '16px'}}>
                        {'PagerDuty'}
                    </h3>
                </div>
                <div
                    className='pagerduty-connect-screen'
                    style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '32px 24px',
                        textAlign: 'center',
                    }}
                >
                    <svg
                        width='48'
                        height='48'
                        viewBox='0 0 64 64'
                        xmlns='http://www.w3.org/2000/svg'
                        style={{marginBottom: '16px'}}
                    >
                        <circle
                            cx='32'
                            cy='32'
                            r='32'
                            fill='#06AC38'
                        />
                        <path
                            d='M 16 12 L 32 12 Q 40 12 44 16 Q 48 20 48 28 Q 48 36 44 40 Q 40 44 32 44 L 24 44 L 24 52 L 16 52 Z M 24 20 L 24 36 L 32 36 Q 36 36 38 34 Q 40 32 40 28 Q 40 24 38 22 Q 36 20 32 20 Z'
                            fill='white'
                        />
                    </svg>
                    <h4 style={{color: theme.centerChannelColor, margin: '0 0 8px 0', fontSize: '16px'}}>
                        {'Connect to PagerDuty'}
                    </h4>
                    <p style={{color: theme.centerChannelColor, opacity: 0.6, fontSize: '13px', margin: '0 0 24px 0', lineHeight: 1.5}}>
                        {'Connect your PagerDuty account to view on-call schedules, manage incidents, and page team members.'}
                    </p>
                    <button
                        className='pagerduty-connect-button'
                        onClick={handleConnect}
                        style={{
                            backgroundColor: theme.buttonBg,
                            color: theme.buttonColor,
                            border: 'none',
                            borderRadius: '4px',
                            padding: '10px 24px',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        {'Connect to PagerDuty'}
                    </button>
                </div>
            </div>
        );
    }

    // Connected — show normal sidebar
    return (
        <div
            className='pagerduty-sidebar'
            style={{height: '100%', display: 'flex', flexDirection: 'column'}}
        >
            {/* Header */}
            <div
                style={{
                    padding: '12px 16px',
                    borderBottom: `1px solid ${theme.centerChannelColor}20`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    {showBackButton && (
                        <button
                            onClick={handleBack}
                            style={{
                                backgroundColor: 'transparent',
                                color: theme.linkColor,
                                border: 'none',
                                padding: '4px',
                                cursor: 'pointer',
                                fontSize: '18px',
                                lineHeight: 1,
                            }}
                            title='Back'
                        >
                            {'←'}
                        </button>
                    )}
                    <h3 style={{margin: 0, color: theme.centerChannelColor, fontSize: '16px'}}>
                        {getHeaderTitle()}
                    </h3>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    {lastRefreshed && (
                        <span style={{fontSize: '11px', color: theme.centerChannelColor, opacity: 0.4}}>
                            {formatTimeAgo(lastRefreshed)}
                        </span>
                    )}
                    <button
                        onClick={handleRefresh}
                        style={{
                            backgroundColor: 'transparent',
                            color: theme.linkColor,
                            border: 'none',
                            padding: '4px 8px',
                            cursor: 'pointer',
                            fontSize: '14px',
                        }}
                    >
                        {'Refresh'}
                    </button>
                    <button
                        className='pagerduty-disconnect-button'
                        onClick={handleDisconnect}
                        title='Disconnect PagerDuty'
                        style={{
                            backgroundColor: 'transparent',
                            color: theme.centerChannelColor,
                            opacity: 0.4,
                            border: 'none',
                            padding: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                        }}
                    >
                        {'Disconnect'}
                    </button>
                </div>
            </div>

            {/* Tab Bar */}
            {!showBackButton && (
                <div
                    className='pagerduty-tab-bar'
                    style={{
                        display: 'flex',
                        borderBottom: `1px solid ${theme.centerChannelColor}20`,
                    }}
                >
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            className={`pagerduty-tab ${activeTab === tab.key ? 'active' : ''}`}
                            data-testid={`tab-${tab.key}`}
                            onClick={() => handleTabChange(tab.key)}
                            style={{
                                flex: 1,
                                padding: '10px 0',
                                backgroundColor: 'transparent',
                                color: activeTab === tab.key ? theme.buttonBg : theme.centerChannelColor,
                                border: 'none',
                                borderBottom: activeTab === tab.key ?
                                    `2px solid ${theme.buttonBg}` :
                                    '2px solid transparent',
                                cursor: 'pointer',
                                fontWeight: activeTab === tab.key ? 600 : 400,
                                fontSize: '13px',
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Paging success message */}
            {pagingSuccess && (
                <div
                    className='success-message'
                    style={{
                        backgroundColor: theme.onlineIndicator || '#28a745',
                        color: 'white',
                        padding: '8px 16px',
                        fontSize: '14px',
                    }}
                >
                    {pagingSuccess}
                </div>
            )}

            {/* Tab Content */}
            <div style={{flex: 1, overflow: 'auto', padding: '16px'}}>
                {/* On-Call Tab */}
                {activeTab === 'oncall' && (
                    <OnCallList
                        onCalls={onCalls}
                        theme={theme}
                        loading={loading}
                        error={error}
                        onPageUser={handlePageUser}
                    />
                )}

                {/* Schedules Tab */}
                {activeTab === 'schedules' && (
                    selectedSchedule || loadingDetails ? (
                        <ScheduleDetails
                            schedule={selectedSchedule}
                            onBack={handleBack}
                            theme={theme}
                            loading={loadingDetails}
                        />
                    ) : (
                        <ScheduleList
                            schedules={schedules}
                            onScheduleClick={handleScheduleClick}
                            theme={theme}
                            loading={loading}
                            error={error}
                        />
                    )
                )}

                {/* Incidents Tab */}
                {activeTab === 'incidents' && (
                    selectedIncident ? (
                        <div
                            onFocus={() => {
                                isInteractingRef.current = true;
                            }}
                            onBlur={() => {
                                isInteractingRef.current = false;
                            }}
                        >
                            <IncidentDetails
                                incident={selectedIncident}
                                onBack={handleBack}
                                theme={theme}
                                onIncidentUpdated={handleIncidentUpdated}
                            />
                        </div>
                    ) : (
                        <IncidentList
                            incidents={incidents}
                            theme={theme}
                            loading={loading}
                            error={error}
                            onIncidentClick={handleIncidentClick}
                            onAcknowledge={handleAcknowledge}
                            onResolve={handleResolve}
                            schedules={filterSchedules}
                            users={filterUsers}
                            filters={incidentFilters}
                            onFiltersChange={handleIncidentFiltersChange}
                            userScheduleMap={userScheduleMap}
                        />
                    )
                )}
            </div>

            {/* Paging Dialog */}
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

export default PagerDutySidebar;
