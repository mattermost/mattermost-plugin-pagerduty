// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import CreateIncidentPostModal from './create_incident_post_modal';

import type {PostIncidentEventDetail} from './create_incident_post_modal';

import client from '@/client/client';
import {act, render, screen, waitFor, fireEvent} from '@/test-utils';

// Mock the client module
jest.mock('@/client/client');
const mockClient = client as jest.Mocked<typeof client>;

const dispatchPostEvent = (detail: PostIncidentEventDetail) => {
    window.dispatchEvent(
        new CustomEvent('pagerduty-create-incident-from-post', {detail}),
    );
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
        mockClient.getServices.mockResolvedValueOnce({
            services: [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}],
            limit: 100,
            offset: 0,
            more: false,
            total: 1,
        });

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Server is down!'});
        });

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        expect(screen.getByText('Create PagerDuty Incident')).toBeInTheDocument();
    });

    it('should pre-fill title from first line and description from full post message', async () => {
        mockClient.getServices.mockResolvedValueOnce({
            services: [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}],
            limit: 100,
            offset: 0,
            more: false,
            total: 1,
        });

        render(<CreateIncidentPostModal/>);

        const postMessage = 'Server is down!\nThis happened at 3am\nPlease investigate';

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage});
        });

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        const titleInput = screen.getByLabelText('Title *') as HTMLInputElement;
        const descriptionInput = screen.getByLabelText('Description') as HTMLTextAreaElement;

        expect(titleInput.value).toBe('Server is down!');
        expect(descriptionInput.value).toBe(postMessage);
    });

    it('should truncate long titles to 200 characters', async () => {
        mockClient.getServices.mockResolvedValueOnce({
            services: [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}],
            limit: 100,
            offset: 0,
            more: false,
            total: 1,
        });

        render(<CreateIncidentPostModal/>);

        const longMessage = 'A'.repeat(250) + '\nMore details here';

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: longMessage});
        });

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        const titleInput = screen.getByLabelText('Title *') as HTMLInputElement;
        expect(titleInput.value.length).toBe(200);
    });

    it('should load and display services', async () => {
        mockClient.getServices.mockResolvedValueOnce({
            services: [
                {id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'},
                {id: 'SVC2', name: 'API Server', description: '', type: 'service', summary: '', status: 'active'},
            ],
            limit: 100,
            offset: 0,
            more: false,
            total: 2,
        });

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Test incident'});
        });

        // Should show loading state first
        await waitFor(() => {
            expect(screen.getByText('Loading services...')).toBeInTheDocument();
        });

        // Wait for services to load
        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
            expect(screen.getByText('API Server')).toBeInTheDocument();
        });
    });

    it('should show error when services fail to load', async () => {
        mockClient.getServices.mockRejectedValueOnce(new Error('Network error'));

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Test incident'});
        });

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText('Network error')).toBeInTheDocument();
        });
    });

    it('should submit incident and show success message', async () => {
        mockClient.getServices.mockResolvedValueOnce({
            services: [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}],
            limit: 100,
            offset: 0,
            more: false,
            total: 1,
        });

        mockClient.createIncident.mockResolvedValueOnce({
            incident: {
                id: 'INC1',
                type: 'incident',
                title: 'Server is down!',
                service: {id: 'SVC1', type: 'service_reference'},
            },
        });

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Server is down!'});
        });

        // Wait for services to load
        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        // Click submit
        fireEvent.click(screen.getByText('Create Incident'));

        await waitFor(() => {
            expect(screen.getByRole('status')).toBeInTheDocument();
            expect(screen.getByText('Incident created: Server is down!')).toBeInTheDocument();
        });

        expect(mockClient.createIncident).toHaveBeenCalledWith(
            'Server is down!',
            'Server is down!',
            'SVC1',
        );
    });

    it('should show error when incident creation fails', async () => {
        mockClient.getServices.mockResolvedValueOnce({
            services: [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}],
            limit: 100,
            offset: 0,
            more: false,
            total: 1,
        });

        mockClient.createIncident.mockRejectedValueOnce(new Error('PagerDuty API error'));

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Server is down!'});
        });

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
        mockClient.getServices.mockResolvedValueOnce({
            services: [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}],
            limit: 100,
            offset: 0,
            more: false,
            total: 1,
        });

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Test'});
        });

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Cancel'));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should close when Escape key is pressed', async () => {
        mockClient.getServices.mockResolvedValueOnce({
            services: [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}],
            limit: 100,
            offset: 0,
            more: false,
            total: 1,
        });

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Test'});
        });

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        fireEvent.keyDown(document, {key: 'Escape'});

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should close when overlay backdrop is clicked', async () => {
        mockClient.getServices.mockResolvedValueOnce({
            services: [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}],
            limit: 100,
            offset: 0,
            more: false,
            total: 1,
        });

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Test'});
        });

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        // Click the overlay (dialog element itself)
        fireEvent.click(screen.getByRole('dialog'));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should disable submit button when title is empty', async () => {
        mockClient.getServices.mockResolvedValueOnce({
            services: [{id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'}],
            limit: 100,
            offset: 0,
            more: false,
            total: 1,
        });

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Test'});
        });

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        // Clear the title
        const titleInput = screen.getByLabelText('Title *');
        fireEvent.change(titleInput, {target: {value: ''}});

        const submitButton = screen.getByText('Create Incident');
        expect(submitButton).toBeDisabled();
    });

    it('should select first service by default', async () => {
        mockClient.getServices.mockResolvedValueOnce({
            services: [
                {id: 'SVC1', name: 'Web App', description: '', type: 'service', summary: '', status: 'active'},
                {id: 'SVC2', name: 'API Server', description: '', type: 'service', summary: '', status: 'active'},
            ],
            limit: 100,
            offset: 0,
            more: false,
            total: 2,
        });

        render(<CreateIncidentPostModal/>);

        act(() => {
            dispatchPostEvent({postId: 'post123', postMessage: 'Test incident'});
        });

        await waitFor(() => {
            expect(screen.getByText('Web App')).toBeInTheDocument();
        });

        const serviceSelect = screen.getByLabelText('Service *') as HTMLSelectElement;
        expect(serviceSelect.value).toBe('SVC1');
    });
});
