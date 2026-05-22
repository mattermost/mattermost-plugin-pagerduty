// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen, fireEvent} from '@testing-library/react';
import React from 'react';

import IncidentList from './incident_list';

import {mockTheme} from '@/test-utils';

const mockIncidents = [
    {
        id: 'INC1',
        type: 'incident',
        title: 'Server Down',
        status: 'triggered',
        created_at: new Date(Date.now() - 300000).toISOString(), // 5 min ago
        service: {id: 'SVC1', type: 'service_reference', summary: 'Web Service'},
        urgency: 'high',
    },
    {
        id: 'INC2',
        type: 'incident',
        title: 'High Latency',
        status: 'acknowledged',
        created_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        service: {id: 'SVC2', type: 'service_reference', summary: 'API Service'},
    },
];

describe('IncidentList', () => {
    const defaultProps = {
        incidents: mockIncidents,
        theme: mockTheme,
        loading: false,
        error: null,
        onIncidentClick: jest.fn(),
        onAcknowledge: jest.fn().mockResolvedValue(undefined),
        onResolve: jest.fn().mockResolvedValue(undefined),
        schedules: [],
        users: [],
        filters: {},
        onFiltersChange: jest.fn(),
        userScheduleMap: {},
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should render loading state', () => {
        render(
            <IncidentList
                {...defaultProps}
                loading={true}
                incidents={[]}
            />,
        );

        expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    });

    it('should render error state', () => {
        render(
            <IncidentList
                {...defaultProps}
                error='Something went wrong'
                incidents={[]}
            />,
        );

        expect(screen.getByText('Error: Something went wrong')).toBeTruthy();
    });

    it('should render empty state', () => {
        render(
            <IncidentList
                {...defaultProps}
                incidents={[]}
            />,
        );

        expect(screen.getByText(/No active incidents/)).toBeTruthy();
    });

    it('should render incidents with titles and services', () => {
        render(<IncidentList {...defaultProps}/>);

        expect(screen.getByText('Server Down')).toBeTruthy();
        expect(screen.getByText('High Latency')).toBeTruthy();
        expect(screen.getByText('Web Service')).toBeTruthy();
        expect(screen.getByText('API Service')).toBeTruthy();
    });

    it('should render status badges', () => {
        render(<IncidentList {...defaultProps}/>);

        expect(screen.getByText('Triggered')).toBeTruthy();
        expect(screen.getByText('Acknowledged')).toBeTruthy();
    });

    it('should show acknowledge button only for triggered incidents', () => {
        render(<IncidentList {...defaultProps}/>);

        // Triggered incident should have Acknowledge button
        const ackButtons = screen.getAllByText('Acknowledge');
        expect(ackButtons).toHaveLength(1);
    });

    it('should show resolve button for triggered and acknowledged incidents', () => {
        render(<IncidentList {...defaultProps}/>);

        // Both triggered and acknowledged should have Resolve button
        const resolveButtons = screen.getAllByText('Resolve');
        expect(resolveButtons).toHaveLength(2);
    });

    it('should call onIncidentClick when clicking an incident', () => {
        render(<IncidentList {...defaultProps}/>);

        fireEvent.click(screen.getByTestId('incident-INC1'));
        expect(defaultProps.onIncidentClick).toHaveBeenCalledWith(mockIncidents[0]);
    });

    it('should call onAcknowledge when clicking acknowledge button', async () => {
        render(<IncidentList {...defaultProps}/>);

        fireEvent.click(screen.getByText('Acknowledge'));
        expect(defaultProps.onAcknowledge).toHaveBeenCalledWith('INC1');
    });

    it('should call onResolve when clicking resolve button', async () => {
        render(<IncidentList {...defaultProps}/>);

        const resolveButtons = screen.getAllByText('Resolve');
        fireEvent.click(resolveButtons[0]);
        expect(defaultProps.onResolve).toHaveBeenCalledWith('INC1');
    });

    it('should show summary when responder name is empty', () => {
        render(
            <IncidentList
                {...defaultProps}
                incidents={[]}
                users={[{
                    id: 'U1',
                    name: '',
                    email: '',
                    type: 'user',
                    summary: 'Jane Doe',
                    description: '',
                    role: 'user',
                    time_zone: 'UTC',
                    color: '',
                    avatar_url: '',
                }]}
            />,
        );

        expect(screen.getByRole('option', {name: 'Jane Doe'})).toBeTruthy();
    });
});
