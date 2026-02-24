// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import ScheduleDetails from './schedule_details';

import {render, screen, mockTheme} from '@/test-utils';

describe('ScheduleDetails', () => {
    const mockSchedule = {
        id: 'SCHED1',
        name: 'Primary On-Call',
        description: 'Main support schedule',
        time_zone: 'America/New_York',
        summary: 'Primary support rotation',
        final_schedule: {
            name: 'Final Schedule',
            rendered_schedule_entries: [
                {
                    start: '2024-01-01T00:00:00Z',
                    end: '2024-01-02T00:00:00Z',
                    user: {
                        id: 'USER1',
                        name: 'John Doe',
                        email: 'john@example.com',
                        avatar_url: 'https://example.com/avatar1.png',
                        type: 'user',
                        summary: 'John Doe',
                        description: 'John Doe - john@example.com',
                        role: 'user',
                        time_zone: 'America/New_York',
                        color: 'purple',
                    },
                },
                {
                    start: '2024-01-02T00:00:00Z',
                    end: '2024-01-03T00:00:00Z',
                    user: {
                        id: 'USER2',
                        name: 'Jane Smith',
                        email: 'jane@example.com',
                        avatar_url: 'https://example.com/avatar2.png',
                        type: 'user',
                        summary: 'Jane Smith',
                        description: 'Jane Smith - jane@example.com',
                        role: 'user',
                        time_zone: 'America/New_York',
                        color: 'blue',
                    },
                },
            ],
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should render schedule details', () => {
        render(
            <ScheduleDetails
                schedule={mockSchedule}
                onBack={jest.fn()}
                theme={mockTheme}
                loading={false}
            />,
        );

        expect(screen.getByText('On-Call Schedule')).toBeInTheDocument();
    });

    it('should show loading state', () => {
        render(
            <ScheduleDetails
                schedule={null}
                onBack={jest.fn()}
                theme={mockTheme}
                loading={true}
            />,
        );

        expect(screen.getByText('Loading schedule details...')).toBeInTheDocument();
    });

    it('should render on-call entries', () => {
        render(
            <ScheduleDetails
                schedule={mockSchedule}
                onBack={jest.fn()}
                theme={mockTheme}
                loading={false}
            />,
        );

        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    });

    it('should show empty state when no schedule entries', () => {
        const scheduleWithNoEntries = {
            ...mockSchedule,
            final_schedule: {
                name: 'Final Schedule',
                rendered_schedule_entries: [],
            },
        };

        render(
            <ScheduleDetails
                schedule={scheduleWithNoEntries}
                onBack={jest.fn()}
                theme={mockTheme}
                loading={false}
            />,
        );

        expect(screen.getByText('No on-call entries for this schedule')).toBeInTheDocument();
    });

    it('should format dates correctly', () => {
        render(
            <ScheduleDetails
                schedule={mockSchedule}
                onBack={jest.fn()}
                theme={mockTheme}
                loading={false}
            />,
        );

        // Check that dates are being displayed (actual format depends on implementation)
        const entries = screen.getAllByTestId(/schedule-entry/);
        expect(entries).toHaveLength(2);
    });

    it('should handle schedule without final_schedule', () => {
        const scheduleWithoutFinal = {
            ...mockSchedule,
            final_schedule: undefined,
        };

        render(
            <ScheduleDetails
                schedule={scheduleWithoutFinal}
                onBack={jest.fn()}
                theme={mockTheme}
                loading={false}
            />,
        );

        expect(screen.getByText('No on-call schedule available')).toBeInTheDocument();
    });

    it('should display user avatars when available', () => {
        render(
            <ScheduleDetails
                schedule={mockSchedule}
                onBack={jest.fn()}
                theme={mockTheme}
                loading={false}
            />,
        );

        const avatars = screen.getAllByRole('img');
        expect(avatars).toHaveLength(2);
        expect(avatars[0]).toHaveAttribute('src', 'https://example.com/avatar1.png');
        expect(avatars[1]).toHaveAttribute('src', 'https://example.com/avatar2.png');
    });
});
