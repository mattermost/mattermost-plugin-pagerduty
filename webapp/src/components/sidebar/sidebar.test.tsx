// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import PagerDutySidebar from './sidebar';

import client from '@/client/client';
import {render, screen, waitFor, fireEvent, mockTheme} from '@/test-utils';

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

jest.mock('./paging_dialog', () => ({
    PagingDialog: () => <div data-testid='paging-dialog'/>,
}));

describe('PagerDutySidebar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should render tabs and load on-calls by default', async () => {
        const mockOnCalls = {
            oncalls: [
                {user: {id: 'U1', name: 'John Doe'}, schedule: {id: 'S1', name: 'Primary'}, escalation_level: 1},
            ],
        };

        mockClient.getOnCalls.mockResolvedValueOnce(mockOnCalls);

        render(<PagerDutySidebar theme={mockTheme}/>);

        // Should show all three tabs
        expect(screen.getByTestId('tab-oncall')).toBeInTheDocument();
        expect(screen.getByTestId('tab-schedules')).toBeInTheDocument();
        expect(screen.getByTestId('tab-incidents')).toBeInTheDocument();

        // Should show loading state initially
        expect(screen.getByText('Loading on-call users...')).toBeInTheDocument();

        // Wait for on-calls to load
        await waitFor(() => {
            expect(screen.getByText('John Doe')).toBeInTheDocument();
        });

        expect(mockClient.getOnCalls).toHaveBeenCalledTimes(1);
    });

    it('should switch to schedules tab and load schedules', async () => {
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: []});

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
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: []});

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
        mockClient.getOnCalls.mockRejectedValueOnce(new Error('API Error'));

        render(<PagerDutySidebar theme={mockTheme}/>);

        await waitFor(() => {
            expect(screen.getByText('Error: API Error')).toBeInTheDocument();
        });
    });

    it('should show back button when in detail view and hide tabs', async () => {
        mockClient.getOnCalls.mockResolvedValueOnce({oncalls: []});
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
});
