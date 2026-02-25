// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import ScheduleList from './schedule_list';

import {render, screen, fireEvent, mockTheme} from '@/test-utils';

describe('ScheduleList', () => {
    const mockSchedules = [
        {
            id: 'SCHED1',
            name: 'Primary On-Call',
            description: 'Main support schedule',
            time_zone: 'America/New_York',
            summary: 'Primary On-Call',
        },
        {
            id: 'SCHED2',
            name: 'Secondary On-Call',
            description: 'Backup support schedule',
            time_zone: 'America/Los_Angeles',
            summary: 'Secondary On-Call',
        },
    ];

    const mockOnScheduleClick = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should render schedules list', () => {
        render(
            <ScheduleList
                schedules={mockSchedules}
                onScheduleClick={mockOnScheduleClick}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        expect(screen.getByText('2 schedules')).toBeInTheDocument();
        expect(screen.getByText('Primary On-Call')).toBeInTheDocument();
        expect(screen.getByText('Secondary On-Call')).toBeInTheDocument();
    });

    it('should show loading state', () => {
        render(
            <ScheduleList
                schedules={[]}
                onScheduleClick={mockOnScheduleClick}
                theme={mockTheme}
                loading={true}
                error={null}
            />,
        );

        expect(screen.getByText((_, el) => el?.getAttribute('aria-busy') === 'true')).toBeInTheDocument();
    });

    it('should show error state', () => {
        render(
            <ScheduleList
                schedules={[]}
                onScheduleClick={mockOnScheduleClick}
                theme={mockTheme}
                loading={false}
                error='Failed to load schedules'
            />,
        );

        expect(screen.getByText('Error: Failed to load schedules')).toBeInTheDocument();
    });

    it('should show empty state when no schedules', () => {
        render(
            <ScheduleList
                schedules={[]}
                onScheduleClick={mockOnScheduleClick}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        expect(screen.getByText('No schedules found. Verify your PagerDuty configuration.')).toBeInTheDocument();
    });

    it('should call onScheduleClick when schedule is clicked', () => {
        render(
            <ScheduleList
                schedules={mockSchedules}
                onScheduleClick={mockOnScheduleClick}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        const firstSchedule = screen.getByTestId('schedule-SCHED1');
        expect(firstSchedule).toBeInTheDocument();

        fireEvent.click(firstSchedule);
        expect(mockOnScheduleClick).toHaveBeenCalledWith('SCHED1');
    });

    it('should handle keyboard navigation', () => {
        render(
            <ScheduleList
                schedules={mockSchedules}
                onScheduleClick={mockOnScheduleClick}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        const container = screen.getByTestId('schedule-SCHED1').parentElement;
        const firstSchedule = screen.getByTestId('schedule-SCHED1');

        // Focus the first schedule
        firstSchedule.focus();

        // Test Enter key
        fireEvent.keyDown(container!, {key: 'Enter', code: 'Enter'});
        expect(mockOnScheduleClick).toHaveBeenCalledWith('SCHED1');
    });

    it('should show schedule count', () => {
        render(
            <ScheduleList
                schedules={mockSchedules}
                onScheduleClick={mockOnScheduleClick}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        expect(screen.getByText('2 schedules')).toBeInTheDocument();
    });
});
