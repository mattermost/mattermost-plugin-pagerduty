// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Client} from './client';

// Mock fetch globally
global.fetch = jest.fn();

// Mock window.location.origin
Object.defineProperty(window, 'location', {
    value: {
        origin: 'http://localhost:8065',
    },
    writable: true,
});

describe('Client', () => {
    let client: Client;

    beforeEach(() => {
        client = new Client();
        jest.clearAllMocks();
    });

    describe('getSchedules', () => {
        it('should fetch schedules successfully', async () => {
            const mockSchedules = {
                schedules: [
                    {id: 'SCHED1', name: 'Primary On-Call'},
                    {id: 'SCHED2', name: 'Secondary On-Call'},
                ],
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockSchedules,
            });

            const result = await client.getSchedules();

            expect(global.fetch).toHaveBeenCalledWith('http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/schedules', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            expect(result).toEqual(mockSchedules);
        });

        it('should throw error on failed response', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                json: async () => ({message: 'Failed to fetch schedules: 500 Internal Server Error'}),
            });

            await expect(client.getSchedules()).rejects.toThrow('Failed to fetch schedules: 500 Internal Server Error');
        });

        it('should throw error on network failure', async () => {
            (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

            await expect(client.getSchedules()).rejects.toThrow('Network error');
        });
    });

    describe('getOnCalls', () => {
        it('should fetch on-calls successfully', async () => {
            const mockOnCalls = {
                oncalls: [
                    {
                        user: {id: 'USER1', name: 'John Doe'},
                        schedule: {id: 'SCHED1', name: 'Primary'},
                        escalation_level: 1,
                    },
                ],
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockOnCalls,
            });

            const result = await client.getOnCalls();

            expect(global.fetch).toHaveBeenCalledWith('http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/oncalls', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            expect(result).toEqual(mockOnCalls);
        });

        it('should fetch on-calls for specific schedule', async () => {
            const mockOnCalls = {oncalls: []};

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockOnCalls,
            });

            const result = await client.getOnCalls('SCHED1');

            expect(global.fetch).toHaveBeenCalledWith('http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/oncalls?schedule_id=SCHED1', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            expect(result).toEqual(mockOnCalls);
        });
    });

    describe('getScheduleDetails', () => {
        it('should fetch schedule details successfully', async () => {
            const mockSchedule = {
                schedule: {
                    id: 'SCHED1',
                    name: 'Primary On-Call',
                    time_zone: 'America/New_York',
                    final_schedule: {
                        rendered_schedule_entries: [
                            {
                                start: '2024-01-01T00:00:00Z',
                                end: '2024-01-02T00:00:00Z',
                                user: {id: 'USER1', name: 'John Doe'},
                            },
                        ],
                    },
                },
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockSchedule,
            });

            const result = await client.getScheduleDetails('SCHED1');

            expect(global.fetch).toHaveBeenCalledWith('http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/schedule?id=SCHED1', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            expect(result).toEqual(mockSchedule);
        });

        it('should throw error for missing schedule ID', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                json: async () => ({message: 'Schedule ID is required'}),
            });

            await expect(client.getScheduleDetails('')).rejects.toThrow('Schedule ID is required');
        });
    });

    describe('getIncidents', () => {
        it('should fetch incidents successfully', async () => {
            const mockIncidents = {
                incidents: [
                    {id: 'INC1', title: 'Server Down', status: 'triggered'},
                ],
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockIncidents,
            });

            const result = await client.getIncidents();

            expect(global.fetch).toHaveBeenCalledWith('http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/incidents', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            expect(result).toEqual(mockIncidents);
        });

        it('should throw error on failed response', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                json: async () => ({message: 'Failed to retrieve incidents'}),
            });

            await expect(client.getIncidents()).rejects.toThrow('Failed to retrieve incidents');
        });
    });

    describe('updateIncident', () => {
        it('should update incident status successfully', async () => {
            const mockResponse = {
                incident: {id: 'INC1', status: 'acknowledged'},
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            });

            const result = await client.updateIncident('INC1', 'acknowledged');

            expect(global.fetch).toHaveBeenCalledWith('http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/incidents/INC1', {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({status: 'acknowledged'}),
            });
            expect(result).toEqual(mockResponse);
        });

        it('should throw error on failed response', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                json: async () => ({message: 'Failed to update incident'}),
            });

            await expect(client.updateIncident('INC1', 'acknowledged')).rejects.toThrow('Failed to update incident');
        });
    });

    describe('getIncidentNotes', () => {
        it('should fetch incident notes successfully', async () => {
            const mockNotes = {
                notes: [
                    {id: 'N1', content: 'Investigating', created_at: '2024-01-01T00:00:00Z', user: {id: 'U1', summary: 'John'}},
                ],
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockNotes,
            });

            const result = await client.getIncidentNotes('INC1');

            expect(global.fetch).toHaveBeenCalledWith('http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/incidents/INC1/notes', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            expect(result).toEqual(mockNotes);
        });
    });

    describe('createIncidentNote', () => {
        it('should create incident note successfully', async () => {
            const mockResponse = {
                note: {id: 'N1', content: 'Root cause identified', created_at: '2024-01-01T00:00:00Z', user: {id: 'U1', summary: 'John'}},
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            });

            const result = await client.createIncidentNote('INC1', 'Root cause identified');

            expect(global.fetch).toHaveBeenCalledWith('http://localhost:8065/plugins/com.svelle.pagerduty-plugin/api/v1/incidents/INC1/notes', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({content: 'Root cause identified'}),
            });
            expect(result).toEqual(mockResponse);
        });

        it('should throw error on failed response', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                json: async () => ({message: 'Failed to create incident note'}),
            });

            await expect(client.createIncidentNote('INC1', 'note')).rejects.toThrow('Failed to create incident note');
        });
    });
});
