// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import OnCallList from './oncall_list';

import {render, screen, mockTheme} from '@/test-utils';

describe('OnCallList', () => {
    const mockOnCalls = [
        {
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
            schedule: {
                id: 'SCHED1',
                name: 'Primary On-Call',
                description: 'Main support schedule',
                time_zone: 'America/New_York',
                summary: 'Primary On-Call',
            },
            escalation_level: 1,
            start: '2024-01-01T00:00:00Z',
            end: '2024-01-02T00:00:00Z',
        },
        {
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
            schedule: {
                id: 'SCHED2',
                name: 'Secondary On-Call',
                description: 'Backup support schedule',
                time_zone: 'America/New_York',
                summary: 'Secondary On-Call',
            },
            escalation_level: 2,
            start: '2024-01-01T00:00:00Z',
            end: '2024-01-02T00:00:00Z',
        },
    ];

    it('should render on-call users', () => {
        render(
            <OnCallList
                onCalls={mockOnCalls}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    it('should show loading state', () => {
        render(
            <OnCallList
                onCalls={[]}
                theme={mockTheme}
                loading={true}
                error={null}
            />,
        );

        expect(screen.getByText((_, el) => el?.getAttribute('aria-busy') === 'true')).toBeInTheDocument();
    });

    it('should show error state', () => {
        render(
            <OnCallList
                onCalls={[]}
                theme={mockTheme}
                loading={false}
                error='Failed to load on-call users'
            />,
        );

        expect(screen.getByText('Error: Failed to load on-call users')).toBeInTheDocument();
    });

    it('should show empty state when no on-call users', () => {
        render(
            <OnCallList
                onCalls={[]}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        expect(screen.getByText('No one is currently on-call across your schedules.')).toBeInTheDocument();
    });

    it('should display schedule names below user name', () => {
        render(
            <OnCallList
                onCalls={mockOnCalls}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        // Schedule names are shown as text below the user name
        expect(screen.getByText('Primary On-Call')).toBeInTheDocument();
        expect(screen.getByText('Secondary On-Call')).toBeInTheDocument();
    });

    it('should deduplicate users across schedules', () => {
        const duplicateOnCalls = [
            {
                ...mockOnCalls[0],
                schedule: {id: 'SCHED1', name: 'Primary', description: '', time_zone: 'UTC', summary: 'Primary'},
            },
            {
                ...mockOnCalls[0],
                schedule: {id: 'SCHED2', name: 'Secondary', description: '', time_zone: 'UTC', summary: 'Secondary'},
                escalation_level: 2,
            },
        ];

        render(
            <OnCallList
                onCalls={duplicateOnCalls}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        // User should appear only once
        const nameElements = screen.getAllByText('John Doe');
        expect(nameElements).toHaveLength(1);

        // Both schedules shown as combined text
        expect(screen.getByText('Primary \u00B7 Secondary')).toBeInTheDocument();
    });

    it('should show email as tooltip on user name', () => {
        render(
            <OnCallList
                onCalls={mockOnCalls}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        expect(screen.getByTitle('john@example.com')).toBeInTheDocument();
        expect(screen.getByTitle('jane@example.com')).toBeInTheDocument();
    });

    it('should display user avatars', () => {
        render(
            <OnCallList
                onCalls={mockOnCalls}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        const avatars = screen.getAllByRole('img');
        expect(avatars).toHaveLength(2);
        expect(avatars[0]).toHaveAttribute('src', 'https://example.com/avatar1.png');
        expect(avatars[1]).toHaveAttribute('src', 'https://example.com/avatar2.png');
    });

    it('should handle on-calls without schedule info', () => {
        const onCallsWithoutSchedule = [
            {
                ...mockOnCalls[0],
                schedule: undefined,
            },
        ];

        render(
            <OnCallList
                onCalls={onCallsWithoutSchedule}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Unknown Schedule')).toBeInTheDocument();
    });

    it('should show fallback avatar when no avatar_url', () => {
        const onCallsNoAvatar = [
            {
                ...mockOnCalls[0],
                user: {...mockOnCalls[0].user, avatar_url: ''},
            },
        ];

        render(
            <OnCallList
                onCalls={onCallsNoAvatar}
                theme={mockTheme}
                loading={false}
                error={null}
            />,
        );

        // Should show initial letter as fallback
        expect(screen.getByText('J')).toBeInTheDocument();
    });
});
