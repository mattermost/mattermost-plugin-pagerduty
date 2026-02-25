// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export interface Schedule {
    id: string;
    name: string;
    description: string;
    time_zone: string;
    summary: string;
    schedule_layers?: ScheduleLayer[];
    override_subcycle?: OverrideSubcycle;
    final_schedule?: FinalSchedule;
}

export interface ScheduleLayer {
    id: string;
    name: string;
    start: string;
    end?: string;
    rotation_virtual_start: string;
    rotation_turn_length_seconds: number;
    users: UserReference[];
}

export interface OverrideSubcycle {
    start: string;
    end: string;
}

export interface FinalSchedule {
    name: string;
    rendered_schedule_entries: ScheduleEntry[];
}

export interface ScheduleEntry {
    user: User;
    start: string;
    end: string;
}

export interface UserReference {
    id: string;
    type: string;
    summary: string;
}

export interface User {
    id: string;
    name: string;
    email: string;
    type: string;
    summary: string;
    description: string;
    role: string;
    time_zone: string;
    color: string;
    avatar_url: string;
    contact_methods?: ContactMethod[];
}

export interface ContactMethod {
    id: string;
    type: string;
    summary: string;
    label: string;
    address: string;
}

export interface OnCall {
    user: User;
    schedule?: Schedule;
    escalation_policy?: EscalationPolicy;
    escalation_level: number;
    start?: string;
    end?: string;
}

export interface EscalationPolicy {
    id: string;
    name: string;
    description: string;
    num_loops: number;
}

export interface ListResponse {
    limit: number;
    offset: number;
    more: boolean;
    total: number;
}

export interface SchedulesResponse extends ListResponse {
    schedules: Schedule[];
}

export interface OnCallsResponse extends ListResponse {
    oncalls: OnCall[];
}

export interface Service {
    id: string;
    name: string;
    description: string;
    type: string;
    summary: string;
    status: string;
}

export interface ServicesResponse extends ListResponse {
    services: Service[];
}

export interface ServiceReference {
    id: string;
    type: string;
    summary?: string;
}

export interface AssigneeReference {
    id: string;
    type: string;
}

export interface Assignment {
    assignee: AssigneeReference;
}

export interface Priority {
    id: string;
    name: string;
    summary: string;
}

export interface Incident {
    id: string;
    type: string;
    title: string;
    description?: string;
    service: ServiceReference;
    assignments?: Assignment[];
    status?: string;
    urgency?: string;
    priority?: Priority | null;
    created_at?: string;
    incident_key?: string;
    html_url?: string;
}

export interface CreateIncidentRequest {
    title: string;
    description?: string;
    service_id: string;
    assignee_ids?: string[];
}

export interface CreateIncidentResponse {
    incident: Incident;
}

export interface IncidentsResponse extends ListResponse {
    incidents: Incident[];
}

export interface IncidentResponse {
    incident: Incident;
}

export interface IncidentNote {
    id: string;
    content: string;
    created_at: string;
    user: UserReference;
}

export interface IncidentNotesResponse {
    notes: IncidentNote[];
}

export interface CreateIncidentNoteResponse {
    note: IncidentNote;
}

export interface IncidentFilters {
    userIds?: string[];
    scheduleId?: string;
}

export interface ConnectionStatus {
    connected: boolean;
}

export interface UserResponse {
    user: User;
}

export interface UsersResponse extends ListResponse {
    users: User[];
}

export interface Override {
    id?: string;
    start: string;
    end: string;
    user: UserReference;
}

export interface OverrideResponse {
    override: Override;
}
