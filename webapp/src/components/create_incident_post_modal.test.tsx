// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import CreateIncidentPostModal from './create_incident_post_modal';
import type {PostIncidentEventDetail} from './create_incident_post_modal';

import client from '@/client/client';
import {act, render, screen, waitFor, fireEvent} from '@/test-utils';
import type {Service} from '@/types/pagerduty';

// Mock the client module
jest.mock('@/client/client');
const mockClient = client as jest.Mocked<typeof client>;

const mockServicesResponse = (services: Service[] = [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}]) => ({
    services,
    limit: 100,
    offset: 0,
    more: false,
    total: services.length,
});

const mockOnCallsResponse = (oncalls: Array<{user: {id: string; name: string; summary: string}; escalation_policy?: {id: string; name: string}; escalation_level: number}> = []) => ({
    oncalls,
    limit: 100,
    offset: 0,
    more: false,
    total: oncalls.length,
});

const mockUsersResponse = (users: Array<{id: string; name: string; email: string; type: string; summary: string; description: string; role: string; time_zone: string; color: string; avatar_url: string}> = []) => ({
    users,
    limit: 25,
    offset: 0,
    more: false,
    total: users.length,
});

const setupDefaultMocks = () => {
    mockClient.getServices.mockResolvedValueOnce(mockServicesResponse());
    mockClient.getOnCalls.mockResolvedValueOnce(mockOnCallsResponse());
};

const dispatchPostEvent = (detail: PostIncidentEventDetail) => {
    window.dispatchEvent(
        new CustomEvent('pagerduty-create-incident-from-post', {detail}),
    );
};

const openModal = async (message = 'Server is down!') => {
    act(() => {
        dispatchPostEvent({postId: 'post123', postMessage: message});
    });
    await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
};

describe('CreateIncidentPostModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should not render anything when closed', () => {
        const {container} = render(<CreateIncidentPostModal/>);
        expect(container.firstChild).toBeNull();
    });

    it('should open when custom event is dispatched', async () => {
        setupDefaultMocks();
        render(<CreateIncidentPostModal/>);
        await openModal();

        expect(screen.getByText('Create PagerDuty Incident')).toBeInTheDocument();
    });

    it('should pre-fill title from first line and description from full post message', async () => {
        setupDefaultMocks();
        render(<CreateIncidentPostModal/>);

        const postMessage = 'Server is down!\nThis happened at 3am\nPlease investigate';
        await openModal(postMessage);

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        const titleInput = screen.getByLabelText('Title *') as HTMLInputElement;
        const descriptionInput = screen.getByLabelText('Description') as HTMLTextAreaElement;

        expect(titleInput.value).toBe('Server is down!');
        expect(descriptionInput.value).toBe(postMessage);
    });

    it('should truncate long titles to 200 characters', async () => {
        setupDefaultMocks();
        render(<CreateIncidentPostModal/>);

        const longMessage = 'A'.repeat(250) + '\nMore details here';
        await openModal(longMessage);

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        const titleInput = screen.getByLabelText('Title *') as HTMLInputElement;
        expect(titleInput.value.length).toBe(200);
    });

    it('should load and display services', async () => {
        const services = [
            {id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'},
            {id: 'SVC2', name: 'API Server', description: '', type: 'service', summary: '', status: 'active'},
        ];
        mockClient.getServices.mockResolvedValueOnce(mockServicesResponse(services));
        mockClient.getOnCalls.mockResolvedValueOnce(mockOnCallsResponse());

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
            expect(screen.getByText('API Server')).toBeInTheDocument();
        });
    });

    it('should show error when services fail to load', async () => {
        mockClient.getServices.mockRejectedValueOnce(new Error('Network error'));
        mockClient.getOnCalls.mockResolvedValueOnce(mockOnCallsResponse());

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Test incident'});
        });

        await waitFor(() => {
            expect(screen.getByText('Network error')).toBeInTheDocument();
        });
    });

    it('should submit incident with urgency and show success message', async () => {
        setupDefaultMocks();

        mockClient.createIncident.mockResolvedValueOnce({
            incident: {
                id: 'INC1',
                type: 'incident',
                title: 'Server is down!',
                service: {id: 'SVC1', type: 'service_reference'},
            },
        });

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Create Incident'));

        await waitFor(() => {
            expect(screen.getByRole('status')).toBeInTheDocument();
            expect(screen.getByText('Incident created: Server is down!')).toBeInTheDocument();
        });

        expect(mockClient.createIncident).toHaveBeenCalledWith(
            'Server is down!',
            'Server is down!',
            'SVC1',
            'high',
            undefined,
        );
    });

    it('should show error when incident creation fails', async () => {
        setupDefaultMocks();
        mockClient.createIncident.mockRejectedValueOnce(new Error('PagerDuty API error'));

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Create Incident'));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText('PagerDuty API error')).toBeInTheDocument();
        });
    });

    it('should close when Cancel button is clicked', async () => {
        setupDefaultMocks();
        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should close when Escape key is pressed', async () => {
        setupDefaultMocks();
        render(<CreateIncidentPostModal/>);
        await openModal();

        fireEvent.keyDown(document, {key: 'Escape'});
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should close when overlay backdrop is clicked', async () => {
        setupDefaultMocks();
        render(<CreateIncidentPostModal/>);
        await openModal();

        fireEvent.click(screen.getByRole('dialog'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should disable submit button when title is empty', async () => {
        setupDefaultMocks();
        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        const titleInput = screen.getByLabelText('Title *');
        fireEvent.change(titleInput, {target: {value: ''}});

        const submitButton = screen.getByText('Create Incident');
        expect(submitButton).toBeDisabled();
    });

    it('should select first service by default', async () => {
        const services = [
            {id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'},
            {id: 'SVC2', name: 'API Server', description: '', type: 'service', summary: '', status: 'active'},
        ];
        mockClient.getServices.mockResolvedValueOnce(mockServicesResponse(services));
        mockClient.getOnCalls.mockResolvedValueOnce(mockOnCallsResponse());

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        const serviceSelect = screen.getByLabelText('Impacted Service *') as HTMLSelectElement;
        expect(serviceSelect.value).toBe('SVC1');
    });

    // --- Urgency field tests ---

    it('should default urgency to high', async () => {
        setupDefaultMocks();
        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        const urgencySelect = screen.getByLabelText('Urgency') as HTMLSelectElement;
        expect(urgencySelect.value).toBe('high');
    });

    it('should allow changing urgency to low', async () => {
        setupDefaultMocks();

        mockClient.createIncident.mockResolvedValueOnce({
            incident: {
                id: 'INC1',
                type: 'incident',
                title: 'Server is down!',
                service: {id: 'SVC1', type: 'service_reference'},
            },
        });

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        const urgencySelect = screen.getByLabelText('Urgency');
        fireEvent.change(urgencySelect, {target: {value: 'low'}});

        fireEvent.click(screen.getByText('Create Incident'));

        await waitFor(() => {
            expect(mockClient.createIncident).toHaveBeenCalledWith(
                'Server is down!',
                'Server is down!',
                'SVC1',
                'low',
                undefined,
            );
        });
    });

    // --- On-call display tests ---

    it('should display on-call users for selected service', async () => {
        const services = [
            {id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active', escalation_policy: {id: 'EP1', type: 'escalation_policy_reference', summary: 'Default'}},
        ];
        const oncalls = [
            {user: {id: 'U1', name: 'Alice Smith', summary: 'Alice Smith'}, escalation_policy: {id: 'EP1', name: 'Default'}, escalation_level: 1},
        ];

        mockClient.getServices.mockResolvedValueOnce(mockServicesResponse(services));
        mockClient.getOnCalls.mockResolvedValueOnce(mockOnCallsResponse(oncalls));

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Currently on call:')).toBeInTheDocument();
            expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        });
    });

    it('should show escalation level for non-L1 on-call users', async () => {
        const services = [
            {id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active', escalation_policy: {id: 'EP1', type: 'escalation_policy_reference', summary: 'Default'}},
        ];
        const oncalls = [
            {user: {id: 'U1', name: 'Alice', summary: 'Alice'}, escalation_policy: {id: 'EP1', name: 'Default'}, escalation_level: 1},
            {user: {id: 'U2', name: 'Bob', summary: 'Bob'}, escalation_policy: {id: 'EP1', name: 'Default'}, escalation_level: 2},
        ];

        mockClient.getServices.mockResolvedValueOnce(mockServicesResponse(services));
        mockClient.getOnCalls.mockResolvedValueOnce(mockOnCallsResponse(oncalls));

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Currently on call:')).toBeInTheDocument();
            expect(screen.getByText(/Alice/)).toBeInTheDocument();
            expect(screen.getByText(/\(L2\)/)).toBeInTheDocument();
        });
    });

    it('should not show on-call info when service has no matching escalation policy', async () => {
        const services = [
            {id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active', escalation_policy: {id: 'EP1', type: 'escalation_policy_reference', summary: 'Default'}},
        ];
        const oncalls = [
            {user: {id: 'U1', name: 'Alice', summary: 'Alice'}, escalation_policy: {id: 'EP999', name: 'Other'}, escalation_level: 1},
        ];

        mockClient.getServices.mockResolvedValueOnce(mockServicesResponse(services));
        mockClient.getOnCalls.mockResolvedValueOnce(mockOnCallsResponse(oncalls));

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        expect(screen.queryByText('Currently on call:')).not.toBeInTheDocument();
    });

    // --- Assignee search tests ---

    it('should search for users when typing in assignee field', async () => {
        setupDefaultMocks();
        const users = [
            {id: 'U1', name: 'Alice Smith', email: 'alice@example.com', type: 'user', summary: 'Alice Smith', description: '', role: 'user', time_zone: 'UTC', color: '', avatar_url: ''},
        ];
        mockClient.getUsers.mockResolvedValueOnce(mockUsersResponse(users));

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        const assigneeInput = screen.getByPlaceholderText('Search PagerDuty users...');
        fireEvent.change(assigneeInput, {target: {value: 'alice'}});
        fireEvent.focus(assigneeInput);

        // Advance the debounce timer
        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(mockClient.getUsers).toHaveBeenCalledWith('alice');
        });

        await waitFor(() => {
            expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        });
    });

    it('should add and remove assignees', async () => {
        setupDefaultMocks();
        const users = [
            {id: 'U1', name: 'Alice Smith', email: 'alice@example.com', type: 'user', summary: 'Alice Smith', description: '', role: 'user', time_zone: 'UTC', color: '', avatar_url: ''},
        ];
        mockClient.getUsers.mockResolvedValueOnce(mockUsersResponse(users));

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        // Search and add an assignee
        const assigneeInput = screen.getByPlaceholderText('Search PagerDuty users...');
        fireEvent.change(assigneeInput, {target: {value: 'alice'}});
        fireEvent.focus(assigneeInput);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        });

        // Click to add the user
        fireEvent.click(screen.getByText('Alice Smith'));

        // Verify chip is shown
        await waitFor(() => {
            expect(screen.getByLabelText('Remove Alice Smith')).toBeInTheDocument();
        });

        // Remove the assignee
        fireEvent.click(screen.getByLabelText('Remove Alice Smith'));

        expect(screen.queryByLabelText('Remove Alice Smith')).not.toBeInTheDocument();
    });

    it('should submit incident with assignees', async () => {
        setupDefaultMocks();
        const users = [
            {id: 'U1', name: 'Alice Smith', email: 'alice@example.com', type: 'user', summary: 'Alice Smith', description: '', role: 'user', time_zone: 'UTC', color: '', avatar_url: ''},
        ];
        mockClient.getUsers.mockResolvedValueOnce(mockUsersResponse(users));
        mockClient.createIncident.mockResolvedValueOnce({
            incident: {
                id: 'INC1',
                type: 'incident',
                title: 'Server is down!',
                service: {id: 'SVC1', type: 'service_reference'},
            },
        });

        render(<CreateIncidentPostModal/>);
        await openModal();

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        // Add an assignee
        const assigneeInput = screen.getByPlaceholderText('Search PagerDuty users...');
        fireEvent.change(assigneeInput, {target: {value: 'alice'}});
        fireEvent.focus(assigneeInput);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Alice Smith'));

        await waitFor(() => {
            expect(screen.getByLabelText('Remove Alice Smith')).toBeInTheDocument();
        });

        // Submit
        fireEvent.click(screen.getByText('Create Incident'));

        await waitFor(() => {
            expect(mockClient.createIncident).toHaveBeenCalledWith(
                'Server is down!',
                'Server is down!',
                'SVC1',
                'high',
                ['U1'],
            );
        });
    });
});
