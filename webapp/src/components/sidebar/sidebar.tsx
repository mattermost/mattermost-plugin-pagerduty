// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import IncidentDetails from './incident_details';
import IncidentList from './incident_list';
import NotificationSettings from './notification_settings';
import OnCallList from './oncall_list';
import {PagingDialog} from './paging_dialog';
import ScheduleDetails from './schedule_details';
import ScheduleList from './schedule_list';
import SubscriptionManager from './subscription_manager';

import client from '@/client/client';
import {ClientError} from '@/client/client';
import type {Incident, IncidentFilters, OnCall, Schedule, User, CreateIncidentResponse} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

type TabName = 'oncall' | 'schedules' | 'incidents';

// Get the current channel ID from Mattermost's global Redux store
const getCurrentChannelId = (): string => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = (window as any).store?.getState();
        return state?.entities?.channels?.currentChannelId || '';
    } catch {
        return '';
    }
};

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

    // Current PagerDuty user identity
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    // Filter mode: 'mine' shows only user's schedules/on-calls, 'all' shows everything
    const [filterMode, setFilterMode] = useState<'mine' | 'all'>('mine');
    const [myScheduleIds, setMyScheduleIds] = useState<Set<string>>(new Set());

    // Shared state
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

    // Settings view state: null = normal view, 'notifications' = notification prefs, 'subscriptions' = channel subscriptions
    const [settingsView, setSettingsView] = useState<'notifications' | 'subscriptions' | null>(null);

    // Paging dialog state (shared between On-Call and Schedules tabs)
    const [showPagingDialog, setShowPagingDialog] = useState(false);
    const [pagingTarget, setPagingTarget] = useState<{type: 'user'; target: User} | null>(null);
    const [pagingSuccess, setPagingSuccess] = useState<string | null>(null);

    // Timeout ref for auto-clearing paging success message
    const pagingSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (pagingSuccessTimeoutRef.current) {
                clearTimeout(pagingSuccessTimeoutRef.current);
            }
        };
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

    // Handle disconnect — optimistic: clear local state first, then call API
    const handleDisconnect = useCallback(async () => {
        setConnected(false);
        setCurrentUser(null);
        setOnCalls([]);
        setSchedules([]);
        setIncidents([]);
        setIncidentFilters({});
        setLastRefreshed(null);
        try {
            await client.disconnect();
        } catch (err) {
            // API call failed but we already cleared local state so the user
            // can re-authenticate. Show the error for debugging.
            // eslint-disable-next-line no-console
            console.warn('PagerDuty disconnect API call failed:', err);
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

    // Fetch current PagerDuty user identity when connected
    useEffect(() => {
        if (!connected) {
            return;
        }
        (async () => {
            try {
                const data = await client.getCurrentUser();
                setCurrentUser(data.user || null);
            } catch {
                // Non-blocking: user identity is optional for core functionality
            }
        })();
    }, [connected]);

    // Derive myScheduleIds from onCalls whenever onCalls or currentUser changes
    useEffect(() => {
        if (!currentUser) {
            return;
        }
        const ids = new Set<string>();
        for (const oc of onCalls) {
            if (oc.user?.id === currentUser.id && oc.schedule?.id) {
                ids.add(oc.schedule.id);
            }
        }
        setMyScheduleIds(ids);
    }, [onCalls, currentUser]);

    // Compute effective incident filters (merges "mine" filter with user-selected filters)
    const effectiveIncidentFilters = useMemo((): IncidentFilters => {
        if (filterMode === 'mine' && currentUser) {
            return {...incidentFilters, userIds: [currentUser.id]};
        }
        return incidentFilters;
    }, [filterMode, currentUser, incidentFilters]);

    // Re-fetch incidents when filter mode changes while on the incidents tab
    const prevFilterModeRef = useRef(filterMode);
    useEffect(() => {
        if (prevFilterModeRef.current !== filterMode) {
            prevFilterModeRef.current = filterMode;
            if (connected && activeTab === 'incidents' && !selectedIncident) {
                fetchIncidents(false, effectiveIncidentFilters);
            }
        }
    }, [filterMode, connected, activeTab, selectedIncident, effectiveIncidentFilters, fetchIncidents]);

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
                    fetchIncidents(true, effectiveIncidentFilters);
                }
                break;
            }
        }, REFRESH_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [connected, activeTab, selectedSchedule, selectedIncident, effectiveIncidentFilters, fetchOnCalls, fetchSchedules, fetchIncidents]);

    // Tab change handler — preserves incident filters across tab switches
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
            fetchIncidents(false, effectiveIncidentFilters);
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
        try {
            await client.updateIncident(incidentId, 'acknowledged');
            await fetchIncidents(true, effectiveIncidentFilters);
        } catch (err) {
            if (err instanceof ClientError && err.status === 401) {
                setConnected(false);
                setError('Your PagerDuty session has expired. Please reconnect.');
            } else {
                setError(err instanceof Error ? err.message : 'Failed to acknowledge incident');
            }
        }
    };

    const handleResolve = async (incidentId: string) => {
        try {
            await client.updateIncident(incidentId, 'resolved');
            await fetchIncidents(true, effectiveIncidentFilters);
        } catch (err) {
            if (err instanceof ClientError && err.status === 401) {
                setConnected(false);
                setError('Your PagerDuty session has expired. Please reconnect.');
            } else {
                setError(err instanceof Error ? err.message : 'Failed to resolve incident');
            }
        }
    };

    const handleIncidentFiltersChange = useCallback((newFilters: IncidentFilters) => {
        setIncidentFilters(newFilters);
        const effective = filterMode === 'mine' && currentUser ?
            {...newFilters, userIds: [currentUser.id]} :
            newFilters;
        fetchIncidents(false, effective);
    }, [fetchIncidents, filterMode, currentUser]);

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
        if (pagingSuccessTimeoutRef.current) {
            clearTimeout(pagingSuccessTimeoutRef.current);
        }
        pagingSuccessTimeoutRef.current = setTimeout(() => setPagingSuccess(null), 5000);
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
            fetchIncidents(true, effectiveIncidentFilters);
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
                fetchIncidents(false, effectiveIncidentFilters);
            }
            break;
        }
    };

    // Retry handler for list components
    const handleRetry = useCallback(() => {
        switch (activeTab) {
        case 'oncall':
            fetchOnCalls();
            break;
        case 'schedules':
            fetchSchedules();
            break;
        case 'incidents':
            fetchIncidents(false, effectiveIncidentFilters);
            break;
        }
    }, [activeTab, effectiveIncidentFilters, fetchOnCalls, fetchSchedules, fetchIncidents]);

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
                aria-busy='true'
            >
                <style>
                    {`@keyframes pagerduty-skeleton-pulse {
                        0%, 100% { opacity: 0.4; }
                        50% { opacity: 1; }
                    }
                    .pagerduty-sidebar button:focus-visible,
                    .pagerduty-sidebar [role="tab"]:focus-visible,
                    .pagerduty-sidebar input:focus-visible,
                    .pagerduty-sidebar select:focus-visible,
                    .pagerduty-sidebar textarea:focus-visible {
                        outline: 2px solid currentColor;
                        outline-offset: 2px;
                    }`}
                </style>
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
                <style>
                    {`@keyframes pagerduty-skeleton-pulse {
                        0%, 100% { opacity: 0.4; }
                        50% { opacity: 1; }
                    }
                    .pagerduty-sidebar button:focus-visible,
                    .pagerduty-sidebar [role="tab"]:focus-visible,
                    .pagerduty-sidebar input:focus-visible,
                    .pagerduty-sidebar select:focus-visible,
                    .pagerduty-sidebar textarea:focus-visible {
                        outline: 2px solid currentColor;
                        outline-offset: 2px;
                    }`}
                </style>
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
                        aria-hidden='true'
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
            {/* Global styles for skeleton animations and focus outlines */}
            <style>
                {`@keyframes pagerduty-skeleton-pulse {
                    0%, 100% { opacity: 0.4; }
                    50% { opacity: 1; }
                }
                .pagerduty-sidebar button:focus-visible,
                .pagerduty-sidebar [role="tab"]:focus-visible,
                .pagerduty-sidebar input:focus-visible,
                .pagerduty-sidebar select:focus-visible,
                .pagerduty-sidebar textarea:focus-visible {
                    outline: 2px solid currentColor;
                    outline-offset: 2px;
                }`}
            </style>

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
                            aria-label='Go back'
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
                            {'\u2190'}
                        </button>
                    )}
                    <h3 style={{margin: 0, color: theme.centerChannelColor, fontSize: '16px'}}>
                        {getHeaderTitle()}
                    </h3>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                    <button
                        onClick={handleRefresh}
                        aria-label='Refresh data'
                        title={lastRefreshed ? `Updated ${formatTimeAgo(lastRefreshed)}` : 'Refresh'}
                        style={{
                            backgroundColor: 'transparent',
                            color: theme.linkColor,
                            border: 'none',
                            padding: '4px 6px',
                            cursor: 'pointer',
                            lineHeight: 1,
                            display: 'flex',
                            alignItems: 'center',
                        }}
                    >
                        <svg
                            width='14'
                            height='14'
                            viewBox='0 0 24 24'
                            fill='currentColor'
                            aria-hidden='true'
                        >
                            <path d='M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z'/>
                        </svg>
                    </button>
                    <button
                        className='pagerduty-settings-button'
                        onClick={() => setSettingsView(settingsView ? null : 'notifications')}
                        aria-label='Settings'
                        title='Settings'
                        style={{
                            backgroundColor: settingsView ? `${theme.buttonBg}20` : 'transparent',
                            color: settingsView ? theme.buttonBg : theme.centerChannelColor,
                            opacity: settingsView ? 1 : 0.6,
                            border: 'none',
                            padding: '4px 6px',
                            cursor: 'pointer',
                            lineHeight: 1,
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: '4px',
                        }}
                    >
                        <svg
                            width='14'
                            height='14'
                            viewBox='0 0 24 24'
                            fill='currentColor'
                            aria-hidden='true'
                        >
                            <path d='M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z'/>
                        </svg>
                    </button>
                    <button
                        className='pagerduty-disconnect-button'
                        onClick={handleDisconnect}
                        aria-label='Disconnect PagerDuty account'
                        title='Disconnect PagerDuty'
                        style={{
                            backgroundColor: 'transparent',
                            color: theme.centerChannelColor,
                            opacity: 0.4,
                            border: 'none',
                            padding: '4px 6px',
                            cursor: 'pointer',
                            lineHeight: 1,
                            display: 'flex',
                            alignItems: 'center',
                        }}
                    >
                        <svg
                            width='14'
                            height='14'
                            viewBox='0 0 24 24'
                            fill='currentColor'
                            aria-hidden='true'
                        >
                            <path d='M14.08,15.59L16.67,13H7V11H16.67L14.08,8.41L15.5,7L20.5,12L15.5,17L14.08,15.59M19,3A2,2 0 0,1 21,5V9.67L19,7.67V5H5V19H19V16.33L21,14.33V19A2,2 0 0,1 19,21H5C3.89,21 3,20.1 3,19V5C3,3.89 3.89,3 5,3H19Z'/>
                        </svg>
                    </button>
                </div>
            </div>

            {/* Tab Bar */}
            {!showBackButton && (
                <div
                    className='pagerduty-tab-bar'
                    role='tablist'
                    aria-label='PagerDuty views'
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
                            role='tab'
                            aria-selected={activeTab === tab.key}
                            aria-controls={`tabpanel-${tab.key}`}
                            id={`tab-${tab.key}`}
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

            {/* Mine / All Filter Toggle */}
            {!showBackButton && currentUser && (
                <div
                    className='pagerduty-filter-toggle'
                    style={{
                        display: 'flex',
                        justifyContent: 'center',
                        padding: '8px 16px',
                        borderBottom: `1px solid ${theme.centerChannelColor}20`,
                    }}
                >
                    {(['mine', 'all'] as const).map((mode) => (
                        <button
                            key={mode}
                            className={`pagerduty-filter-${mode}`}
                            onClick={() => setFilterMode(mode)}
                            style={{
                                backgroundColor: filterMode === mode ? theme.buttonBg : 'transparent',
                                color: filterMode === mode ? theme.buttonColor : theme.centerChannelColor,
                                border: filterMode === mode ? 'none' : `1px solid ${theme.centerChannelColor}30`,
                                borderRadius: mode === 'mine' ? '4px 0 0 4px' : '0 4px 4px 0',
                                padding: '4px 16px',
                                fontSize: '12px',
                                fontWeight: filterMode === mode ? 600 : 400,
                                cursor: 'pointer',
                            }}
                        >
                            {mode === 'mine' ? 'Mine' : 'All'}
                        </button>
                    ))}
                </div>
            )}

            {/* Paging success message */}
            {pagingSuccess && (
                <div
                    className='success-message'
                    role='status'
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
            <div
                id={`tabpanel-${activeTab}`}
                role='tabpanel'
                aria-labelledby={`tab-${activeTab}`}
                style={{flex: 1, overflow: 'auto', padding: '16px'}}
            >
                {/* Settings Views */}
                {settingsView === 'notifications' && (
                    <NotificationSettings
                        theme={theme}
                        onBack={() => setSettingsView(null)}
                        onOpenSubscriptions={() => setSettingsView('subscriptions')}
                    />
                )}

                {settingsView === 'subscriptions' && (
                    <SubscriptionManager
                        theme={theme}
                        channelId={getCurrentChannelId()}
                        onBack={() => setSettingsView('notifications')}
                    />
                )}

                {/* Normal Tab Content (hidden when settings view is active) */}
                {!settingsView && (
                    <>
                        {/* On-Call Tab */}
                        {activeTab === 'oncall' && (
                            <OnCallList
                                onCalls={filterMode === 'mine' && currentUser ?
                                    onCalls.filter((oc) => oc.user?.id === currentUser.id) :
                                    onCalls}
                                theme={theme}
                                loading={loading}
                                error={error}
                                onPageUser={handlePageUser}
                                onRetry={handleRetry}
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
                                    currentUser={currentUser || undefined}
                                    onOverrideCreated={() => {
                                        if (selectedSchedule) {
                                            handleScheduleClick(selectedSchedule.id);
                                        }
                                    }}
                                />
                            ) : (
                                <ScheduleList
                                    schedules={filterMode === 'mine' && currentUser ?
                                        schedules.filter((s) => myScheduleIds.has(s.id)) :
                                        schedules}
                                    onScheduleClick={handleScheduleClick}
                                    theme={theme}
                                    loading={loading}
                                    error={error}
                                    onRetry={handleRetry}
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
                                    onRetry={handleRetry}
                                />
                            )
                        )}
                    </>
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
