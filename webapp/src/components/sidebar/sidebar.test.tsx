// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import PagerDutySidebar from './sidebar';

import client from '@/client/client';
import {act, render, screen, waitFor, fireEvent, mockTheme} from '@/test-utils';

// Mock the client module
jest.mock('@/client/client');
const mockClient = client as jest.Mocked<typeof client>;

// Mock child components
jest.mock('./oncall_list', () => ({
    __esModule: true,
    default: ({onCalls, loading, error}: any) => (
        <div data-testid='oncall-list'>
            {loading && <div>{'Loading on-call users...'}</div>}
            {error && <div>{'Error: '}{error}</div>}
            {onCalls && onCalls.map((oncall: any) => (
                <div key={oncall.user.id}>{oncall.user.name}</div>
            ))}
        </div>
    ),
}));

jest.mock('./schedule_list', () => ({
    __esModule: true,
    default: ({schedules, onScheduleClick, loading, error}: any) => (
        <div data-testid='schedule-list'>
            {loading && <div>{'Loading schedules...'}</div>}
            {error && <div>{'Error: '}{error}</div>}
            {schedules.map((schedule: any) => (
                <button
                    key={schedule.id}
                    data-testid={`schedule-${schedule.id}`}
                    onClick={() => onScheduleClick(schedule.id)}
                >
                    {schedule.name}
                </button>
            ))}
        </div>
    ),
}));

jest.mock('./schedule_details', () => ({
    __esModule: true,
    default: ({schedule, onBack, loading}: any) => (
        <div data-testid='schedule-details'>
            {loading && <div>{'Loading details...'}</div>}
            {schedule && (
                <>
                    <h2>{schedule.name}</h2>
                    <button onClick={onBack}>{'Back'}</button>
                </>
            )}
        </div>
    ),
}));

jest.mock('./incident_list', () => ({
    __esModule: true,
    default: ({incidents, loading, error, onIncidentClick}: any) => (
        <div data-testid='incident-list'>
            {loading && <div>{'Loading incidents...'}</div>}
            {error && <div>{'Error: '}{error}</div>}
            {incidents && incidents.map((incident: any) => (
                <button
                    key={incident.id}
                    data-testid={`incident-${incident.id}`}
                    onClick={() => onIncidentClick(incident)}
                >
                    {incident.title}
                </button>
            ))}
        </div>
    ),
}));

jest.mock('./incident_details', () => ({
    __esModule: true,
    default: ({incident, onBack}: any) => (
        <div data-testid='incident-details'>
            {incident && (
                <>
                    <h2>{incident.title}</h2>
                    <button onClick={onBack}>{'Back'}</button>
                </>
            )}
        </div>
    ),
}));

jest.mock('./notification_settings', () => ({
    __esModule: true,
    default: ({onBack}: any) => (
        <div data-testid='notification-settings'>
            <button onClick={onBack}>{'Back'}</button>
        </div>
    ),
}));

jest.mock('./subscription_manager', () => ({
    __esModule: true,
    default: () => <div data-testid='subscription-manager'/>,
}));

jest.mock('./paging_dialog', () => ({
    PagingDialog: () => <div data-testid='paging-dialog'/>,
}));

describe('PagerDutySidebar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        mockClient.getCurrentUser.mockResolvedValue({user: {id: 'U1', name: 'Test User', email: 'test@example.com'}});
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should show loading state while checking connection', async () => {
        // Never resolve the connection status
        mockClient.getConnectionStatus.mockReturnValue(new Promise(() => {}));

        render(<PagerDutySidebar theme={mockTheme}/>);

        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('should show connect screen when not connected', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: false});

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Should show the connect button
        await waitFor(() => {
            expect(screen.getByRole('button', {name: 'Connect to PagerDuty'})).toBeInTheDocument();
        });

        // Should NOT show tabs
        expect(screen.queryByTestId('tab-oncall')).not.toBeInTheDocument();
    });

    it('should open popup when connect button is clicked', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: false});
        mockClient.getConnectUrl.mockReturnValue('http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/oauth/connect');

        const mockPopup = {closed: true};
        window.open = jest.fn().mockReturnValue(mockPopup);

        render(<PagerDutySidebar theme={mockTheme}/>);

        await waitFor(() => {
            expect(screen.getByRole('button', {name: 'Connect to PagerDuty'})).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', {name: 'Connect to PagerDuty'}));

        expect(window.open).toHaveBeenCalledWith(
            'http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/oauth/connect',
            'pagerduty-oauth',
            'width=600,height=700',
        );
    });

    it('should show user info row with disconnect link when connected', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: true});
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: []});
        mockClient.getCurrentUser.mockResolvedValueOnce({user: {id: 'U1', name: 'Test User', email: 'test@example.com'}});

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Flush multi-step async chain: connection check → re-render → getCurrentUser effect
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.getByText('Test User')).toBeInTheDocument();
        expect(screen.getByText('Disconnect')).toBeInTheDocument();
    });

    it('should disconnect and show connect screen', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: true});
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: []});
        mockClient.getCurrentUser.mockResolvedValueOnce({user: {id: 'U1', name: 'Test User', email: 'test@example.com'}});
        mockClient.disconnect.mockResolvedValueOnce(undefined);

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Flush multi-step async chain: connection check → re-render → getCurrentUser effect
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        fireEvent.click(screen.getByText('Disconnect'));

        await waitFor(() => {
            expect(screen.getByRole('button', {name: 'Connect to PagerDuty'})).toBeInTheDocument();
        });

        expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should render tabs and load on-calls by default', async () => {
        const mockOnCalls = {
            oncalls: [
                {user: {id: 'U1', name: 'John Doe'}, schedule: {id: 'S1', name: 'Primary'}, escalation_level: 1},
            ],
        };

        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: true});
        mockClient.getOnCalls.mockResolvedValueOnce(mockOnCalls);

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Should show all three tabs
        await waitFor(() => {
            expect(screen.getByTestId('tab-oncall')).toBeInTheDocument();
        });
        expect(screen.getByTestId('tab-schedules')).toBeInTheDocument();
        expect(screen.getByTestId('tab-incidents')).toBeInTheDocument();

        // Wait for on-calls to load
        await waitFor(() => {
            expect(screen.getByText('John Doe')).toBeInTheDocument();
        });

        expect(mockClient.getOnCalls).toHaveBeenCalledTimes(1);
    });

    it('should switch to schedules tab and load schedules', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: true});
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: [
            {user: {id: 'U1', name: 'Test User'}, schedule: {id: 'SCHED1', name: 'Primary On-Call'}, escalation_level: 1},
        ]});

        const mockSchedules = {
            schedules: [
                {id: 'SCHED1', name: 'Primary On-Call'},
            ],
        };
        mockClient.getSchedules.mockResolvedValueOnce(mockSchedules);

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Wait for initial load
        await waitFor(() => {
            expect(screen.getByTestId('oncall-list')).toBeInTheDocument();
        });

        // Click Schedules tab
        fireEvent.click(screen.getByTestId('tab-schedules'));

        // Should show schedule list
        await waitFor(() => {
            expect(screen.getByTestId('schedule-list')).toBeInTheDocument();
            expect(screen.getByTestId('schedule-SCHED1')).toBeInTheDocument();
        });

        expect(mockClient.getSchedules).toHaveBeenCalledTimes(1);
    });

    it('should switch to incidents tab and load incidents', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: true});
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: []});

        const mockIncidents = {
            incidents: [
                {id: 'INC1', title: 'Server Down', status: 'triggered', service: {id: 'S1', type: 'service_reference'}},
            ],
        };
        mockClient.getIncidents.mockResolvedValueOnce(mockIncidents);

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Wait for initial load
        await waitFor(() => {
            expect(screen.getByTestId('oncall-list')).toBeInTheDocument();
        });

        // Click Incidents tab
        fireEvent.click(screen.getByTestId('tab-incidents'));

        // Should show incident list
        await waitFor(() => {
            expect(screen.getByTestId('incident-list')).toBeInTheDocument();
            expect(screen.getByText('Server Down')).toBeInTheDocument();
        });

        expect(mockClient.getIncidents).toHaveBeenCalledTimes(1);
    });

    it('should show schedule details when a schedule is clicked', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: true});
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: [
            {user: {id: 'U1', name: 'Test User'}, schedule: {id: 'SCHED1', name: 'Primary On-Call'}, escalation_level: 1},
        ]});

        const mockSchedules = {
            schedules: [{id: 'SCHED1', name: 'Primary On-Call'}],
        };
        mockClient.getSchedules.mockResolvedValueOnce(mockSchedules);
        mockClient.getScheduleDetails.mockResolvedValueOnce({
            schedule: {id: 'SCHED1', name: 'Primary On-Call', time_zone: 'UTC'},
        });

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Switch to schedules tab
        await waitFor(() => {
            expect(screen.getByTestId('oncall-list')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByTestId('tab-schedules'));

        await waitFor(() => {
            expect(screen.getByTestId('schedule-SCHED1')).toBeInTheDocument();
        });

        // Click a schedule
        fireEvent.click(screen.getByTestId('schedule-SCHED1'));

        // Wait for details
        await waitFor(() => {
            expect(screen.getByTestId('schedule-details')).toBeInTheDocument();
        });
    });

    it('should handle error when loading on-calls fails', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: true});
        mockClient.getOnCalls.mockRejectedValueOnce(new Error('API Error'));

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Flush all microtask chains (connection check → fetchOnCalls → rejection)
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.getByText('Error: API Error')).toBeInTheDocument();
    });

    it('should show back button when in detail view and hide tabs', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: true});
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: [
            {user: {id: 'U1', name: 'Test User'}, schedule: {id: 'SCHED1', name: 'Primary'}, escalation_level: 1},
        ]});
        mockClient.getSchedules.mockResolvedValueOnce({
            schedules: [{id: 'SCHED1', name: 'Primary'}],
        });
        mockClient.getScheduleDetails.mockResolvedValueOnce({
            schedule: {id: 'SCHED1', name: 'Primary'},
        });

        render(<PagerDutySidebar theme={mockTheme}/>);

        await waitFor(() => {
            expect(screen.getByTestId('oncall-list')).toBeInTheDocument();
        });

        // Switch to schedules
        fireEvent.click(screen.getByTestId('tab-schedules'));
        await waitFor(() => {
            expect(screen.getByTestId('schedule-SCHED1')).toBeInTheDocument();
        });

        // Click schedule
        fireEvent.click(screen.getByTestId('schedule-SCHED1'));
        await waitFor(() => {
            expect(screen.getByTestId('schedule-details')).toBeInTheDocument();
        });

        // Back button should be visible, tabs should be hidden
        expect(screen.getByTitle('Back')).toBeInTheDocument();
        expect(screen.queryByTestId('tab-oncall')).not.toBeInTheDocument();
    });

    it('should hide tab bar when settings view is active', async () => {
        mockClient.getConnectionStatus.mockResolvedValueOnce({connected: true});
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: []});
        mockClient.getCurrentUser.mockResolvedValueOnce({user: {id: 'U1', name: 'Test User', email: 'test@example.com'}});

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Wait for initial render with tabs visible
        await waitFor(() => {
            expect(screen.getByTestId('tab-oncall')).toBeInTheDocument();
        });

        // Click settings gear
        fireEvent.click(screen.getByLabelText('Settings'));

        // Tabs should be hidden, settings should be visible
        await waitFor(() => {
            expect(screen.queryByTestId('tab-oncall')).not.toBeInTheDocument();
            expect(screen.queryByTestId('tab-schedules')).not.toBeInTheDocument();
            expect(screen.queryByTestId('tab-incidents')).not.toBeInTheDocument();
            expect(screen.getByTestId('notification-settings')).toBeInTheDocument();
        });
    });
});
