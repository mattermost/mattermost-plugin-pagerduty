// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from '@/manifest';
import type {ConnectionStatus, IncidentFilters, ChannelSubscription, UserNotificationPrefs, WebhookStatus} from '@/types/pagerduty';

const REQUEST_TIMEOUT_MS = 15000;

export class ClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = 'ClientError';
        this.status = status;
    }
}

export class Client {
    private baseUrl: string;

    constructor() {
        // Use window.location.origin to construct the base URL
        const siteUrl = window.location.origin;
        this.baseUrl = `${siteUrl}/plugins/${manifest.id}/api/v1`;
    }

    private async doFetch(url: string, options: RequestInit = {}): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                ...options,
                signal: controller.signal,
            });

            if (!response.ok) {
                let message: string;
                try {
                    const error = await response.json();
                    message = error.message || `Request failed (${response.status})`;
                } catch {
                    message = response.statusText || `Request failed (${response.status})`;
                }
                throw new ClientError(message, response.status);
            }

            return response;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async getConnectionStatus(): Promise<ConnectionStatus> {
        const response = await this.doFetch(`${this.baseUrl}/oauth/status`);
        return response.json();
    }

    getConnectUrl(): string {
        return `${this.baseUrl}/oauth/connect`;
    }

    async disconnect(): Promise<void> {
        await this.doFetch(`${this.baseUrl}/oauth/disconnect`, {
            method: 'POST',
        });
    }

    async getSchedules() {
        const response = await this.doFetch(`${this.baseUrl}/schedules`);
        return response.json();
    }

    async getOnCalls(scheduleId?: string) {
        const params = scheduleId ? `?schedule_id=${scheduleId}` : '';
        const response = await this.doFetch(`${this.baseUrl}/oncalls${params}`);
        return response.json();
    }

    async getScheduleDetails(scheduleId: string) {
        const response = await this.doFetch(`${this.baseUrl}/schedule?id=${scheduleId}`);
        return response.json();
    }

    async getServices() {
        const response = await this.doFetch(`${this.baseUrl}/services`);
        return response.json();
    }

    async createIncident(title: string, description: string, serviceId: string, urgency?: string, assigneeIds?: string[]) {
        const body: Record<string, unknown> = {
            title,
            description,
            service_id: serviceId,
            assignee_ids: assigneeIds || [],
        };
        if (urgency) {
            body.urgency = urgency;
        }

        const response = await this.doFetch(`${this.baseUrl}/incidents`, {
            method: 'POST',
            body: JSON.stringify(body),
        });

        return response.json();
    }

    async getIncidents(filters?: IncidentFilters) {
        const params = new URLSearchParams();
        if (filters?.userIds && filters.userIds.length > 0) {
            params.set('user_ids', filters.userIds.join(','));
        }
        if (filters?.scheduleId) {
            params.set('schedule_id', filters.scheduleId);
        }
        const queryString = params.toString();
        const url = queryString ?
            `${this.baseUrl}/incidents?${queryString}` :
            `${this.baseUrl}/incidents`;

        const response = await this.doFetch(url);
        return response.json();
    }

    async updateIncident(incidentId: string, status: string) {
        const response = await this.doFetch(`${this.baseUrl}/incidents/${incidentId}`, {
            method: 'PUT',
            body: JSON.stringify({status}),
        });

        return response.json();
    }

    async getIncidentNotes(incidentId: string) {
        const response = await this.doFetch(`${this.baseUrl}/incidents/${incidentId}/notes`);
        return response.json();
    }

    async createIncidentNote(incidentId: string, content: string) {
        const response = await this.doFetch(`${this.baseUrl}/incidents/${incidentId}/notes`, {
            method: 'POST',
            body: JSON.stringify({content}),
        });

        return response.json();
    }

    async getCurrentUser() {
        const response = await this.doFetch(`${this.baseUrl}/users/me`);
        return response.json();
    }

    async getUsers(query?: string) {
        const params = query ? `?query=${encodeURIComponent(query)}` : '';
        const response = await this.doFetch(`${this.baseUrl}/users${params}`);
        return response.json();
    }

    async createOverride(scheduleId: string, start: string, end: string, userId: string) {
        const response = await this.doFetch(`${this.baseUrl}/schedules/${scheduleId}/overrides`, {
            method: 'POST',
            body: JSON.stringify({start, end, user_id: userId}),
        });

        return response.json();
    }

    // --- Channel Subscription Methods ---

    async getChannelSubscription(channelId: string): Promise<{subscription: ChannelSubscription | null}> {
        const response = await this.doFetch(`${this.baseUrl}/subscriptions?channel_id=${channelId}`);
        return response.json();
    }

    async createChannelSubscription(channelId: string, eventTypes: string[], serviceIds?: string[]): Promise<{subscription: ChannelSubscription}> {
        const response = await this.doFetch(`${this.baseUrl}/subscriptions`, {
            method: 'POST',
            body: JSON.stringify({
                channel_id: channelId,
                event_types: eventTypes,
                service_ids: serviceIds || [],
            }),
        });
        return response.json();
    }

    async deleteChannelSubscription(channelId: string): Promise<void> {
        await this.doFetch(`${this.baseUrl}/subscriptions/${channelId}`, {
            method: 'DELETE',
        });
    }

    // --- Notification Preferences Methods ---

    async getNotificationPrefs(): Promise<UserNotificationPrefs> {
        const response = await this.doFetch(`${this.baseUrl}/notification-prefs`);
        return response.json();
    }

    async setNotificationPrefs(prefs: UserNotificationPrefs): Promise<UserNotificationPrefs> {
        const response = await this.doFetch(`${this.baseUrl}/notification-prefs`, {
            method: 'PUT',
            body: JSON.stringify(prefs),
        });
        return response.json();
    }

    // --- Webhook Status ---

    async getWebhookStatus(): Promise<WebhookStatus> {
        const response = await this.doFetch(`${this.baseUrl}/webhook/status`);
        return response.json();
    }
}

const client = new Client();
export default client;
