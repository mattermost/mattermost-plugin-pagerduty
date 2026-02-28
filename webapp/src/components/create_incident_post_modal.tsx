// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState, useEffect, useCallback, useMemo} from 'react';

import client from '@/client/client';
import type {Service, ServicesResponse, CreateIncidentResponse, OnCall, OnCallsResponse, User, UsersResponse} from '@/types/pagerduty';

export interface PostIncidentEventDetail {
    postId: string;
    postMessage: string;
}

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '4px',
    border: '1px solid rgba(61, 60, 64, 0.16)',
    fontSize: '14px',
    backgroundColor: 'var(--center-channel-bg, #fff)',
    color: 'var(--center-channel-color, #3d3c40)',
    boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '4px',
    fontWeight: 600,
    fontSize: '14px',
};

const CreateIncidentPostModal: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [selectedServiceId, setSelectedServiceId] = useState('');
    const [urgency, setUrgency] = useState('high');
    const [services, setServices] = useState<Service[]>([]);
    const [onCalls, setOnCalls] = useState<OnCall[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [userQuery, setUserQuery] = useState('');
    const [selectedAssignees, setSelectedAssignees] = useState<User[]>([]);
    const [showUserDropdown, setShowUserDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingServices, setLoadingServices] = useState(false);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        setTitle('');
        setDescription('');
        setSelectedServiceId('');
        setUrgency('high');
        setServices([]);
        setOnCalls([]);
        setUsers([]);
        setUserQuery('');
        setSelectedAssignees([]);
        setShowUserDropdown(false);
        setError(null);
        setSuccess(null);
        setLoading(false);
        setLoadingServices(false);
        setLoadingUsers(false);
    }, []);

    // Listen for the custom event to open the modal
    useEffect(() => {
        const handler = (e: Event) => {
            const customEvent = e as CustomEvent<PostIncidentEventDetail>;
            const {postMessage: msg} = customEvent.detail;

            // Pre-fill title from first line of post, truncated to 200 chars
            const firstLine = msg.split('\n')[0].trim();
            setTitle(firstLine.length > 200 ? firstLine.substring(0, 200) : firstLine);

            // Pre-fill description with full post message
            setDescription(msg);

            setIsOpen(true);
            setError(null);
            setSuccess(null);
        };

        window.addEventListener('pagerduty-create-incident-from-post', handler as EventListener);
        return () => window.removeEventListener('pagerduty-create-incident-from-post', handler as EventListener);
    }, []);

    // Load services and on-calls when modal opens
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const fetchData = async () => {
            try {
                setLoadingServices(true);
                const [servicesResp, onCallsResp]: [ServicesResponse, OnCallsResponse] = await Promise.all([
                    client.getServices(),
                    client.getOnCalls(),
                ]);
                setServices(servicesResp.services || []);
                setOnCalls(onCallsResp.oncalls || []);
                if (servicesResp.services?.length > 0) {
                    setSelectedServiceId(servicesResp.services[0].id);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load services');
            } finally {
                setLoadingServices(false);
            }
        };

        fetchData();
    }, [isOpen]);

    // Search users when query changes
    useEffect(() => {
        if (!userQuery.trim()) {
            setUsers([]);
            return undefined;
        }

        const debounceTimer = setTimeout(async () => {
            try {
                setLoadingUsers(true);
                const response: UsersResponse = await client.getUsers(userQuery);
                setUsers(response.users || []);
            } catch {
                // Silently fail user search
            } finally {
                setLoadingUsers(false);
            }
        }, 300);

        return () => clearTimeout(debounceTimer);
    }, [userQuery]);

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleClose]);

    // Get on-call users for the selected service
    const serviceOnCalls = useMemo(() => {
        if (!selectedServiceId || !onCalls.length || !services.length) {
            return [];
        }

        const selectedService = services.find((s) => s.id === selectedServiceId);
        if (!selectedService?.escalation_policy?.id) {
            return [];
        }

        const epId = selectedService.escalation_policy.id;
        return onCalls.filter((oc) => oc.escalation_policy?.id === epId);
    }, [selectedServiceId, onCalls, services]);

    const handleAddAssignee = useCallback((user: User) => {
        if (!selectedAssignees.some((a) => a.id === user.id)) {
            setSelectedAssignees((prev) => [...prev, user]);
        }
        setUserQuery('');
        setUsers([]);
        setShowUserDropdown(false);
    }, [selectedAssignees]);

    const handleRemoveAssignee = useCallback((userId: string) => {
        setSelectedAssignees((prev) => prev.filter((a) => a.id !== userId));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title.trim() || !selectedServiceId) {
            setError('Title and service are required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const assigneeIds = selectedAssignees.length > 0 ?
                selectedAssignees.map((a) => a.id) :
                undefined;

            const incident: CreateIncidentResponse = await client.createIncident(
                title.trim(),
                description.trim(),
                selectedServiceId,
                urgency,
                assigneeIds,
            );
            setSuccess(`Incident created: ${incident.incident.title}`);
            setTimeout(() => handleClose(), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create incident');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div
            className='pagerduty-post-incident-overlay'
            role='dialog'
            aria-modal='true'
            aria-labelledby='pagerduty-post-incident-title'
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
            }}
            onClick={handleClose}
        >
            <div
                className='pagerduty-create-incident-modal'
                style={{
                    backgroundColor: 'var(--center-channel-bg, #fff)',
                    color: 'var(--center-channel-color, #3d3c40)',
                    borderRadius: '8px',
                    padding: '24px',
                    width: '520px',
                    maxWidth: '90vw',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.12)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2
                    id='pagerduty-post-incident-title'
                    style={{
                        fontSize: '18px',
                        fontWeight: 600,
                        marginTop: 0,
                        marginBottom: '16px',
                    }}
                >
                    {'Create PagerDuty Incident'}
                </h2>

                {success && (
                    <div
                        className='pagerduty-post-incident-success'
                        role='status'
                        style={{
                            backgroundColor: 'var(--online-indicator, #3db887)',
                            color: '#fff',
                            padding: '10px 14px',
                            borderRadius: '4px',
                            marginBottom: '16px',
                            fontSize: '14px',
                        }}
                    >
                        {success}
                    </div>
                )}

                {loadingServices ? (
                    <div style={{textAlign: 'center', padding: '24px'}}>
                        {'Loading services...'}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        {error && (
                            <div
                                className='pagerduty-post-incident-error'
                                role='alert'
                                style={{
                                    color: 'var(--error-text, #d24b4b)',
                                    fontSize: '14px',
                                    marginBottom: '16px',
                                    padding: '10px 14px',
                                    backgroundColor: 'rgba(210, 75, 75, 0.08)',
                                    borderRadius: '4px',
                                }}
                            >
                                {error}
                            </div>
                        )}

                        {/* Service */}
                        <div style={{marginBottom: '16px'}}>
                            <label
                                htmlFor='pd-post-incident-service-select'
                                style={labelStyle}
                            >
                                {'Impacted Service *'}
                            </label>
                            <select
                                id='pd-post-incident-service-select'
                                value={selectedServiceId}
                                onChange={(e) => setSelectedServiceId(e.target.value)}
                                required={true}
                                style={{...inputStyle, cursor: 'pointer'}}
                            >
                                {services.map((service) => (
                                    <option
                                        key={service.id}
                                        value={service.id}
                                    >
                                        {service.name}
                                    </option>
                                ))}
                            </select>

                            {/* On-call display for selected service */}
                            {serviceOnCalls.length > 0 && (
                                <div
                                    className='pagerduty-oncall-info'
                                    style={{
                                        marginTop: '6px',
                                        padding: '8px 10px',
                                        backgroundColor: 'rgba(61, 60, 64, 0.04)',
                                        borderRadius: '4px',
                                        fontSize: '13px',
                                    }}
                                >
                                    <span style={{fontWeight: 600}}>{'Currently on call: '}</span>
                                    {serviceOnCalls.map((oc, idx) => (
                                        <span key={oc.user.id}>
                                            {idx > 0 && ', '}
                                            {oc.user.name || oc.user.summary}
                                            {oc.escalation_level > 1 && ` (L${oc.escalation_level})`}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Title */}
                        <div style={{marginBottom: '16px'}}>
                            <label
                                htmlFor='pd-post-incident-title-input'
                                style={labelStyle}
                            >
                                {'Title *'}
                            </label>
                            <input
                                id='pd-post-incident-title-input'
                                type='text'
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder='Brief description of the issue'
                                required={true}
                                style={inputStyle}
                            />
                        </div>

                        {/* Urgency */}
                        <div style={{marginBottom: '16px'}}>
                            <label
                                htmlFor='pd-post-incident-urgency-select'
                                style={labelStyle}
                            >
                                {'Urgency'}
                            </label>
                            <select
                                id='pd-post-incident-urgency-select'
                                value={urgency}
                                onChange={(e) => setUrgency(e.target.value)}
                                style={{...inputStyle, cursor: 'pointer'}}
                            >
                                <option value='high'>{'High'}</option>
                                <option value='low'>{'Low'}</option>
                            </select>
                        </div>

                        {/* Assignee */}
                        <div style={{marginBottom: '16px', position: 'relative'}}>
                            <label
                                htmlFor='pd-post-incident-assignee-input'
                                style={labelStyle}
                            >
                                {'Assign To'}
                            </label>

                            {/* Selected assignees */}
                            {selectedAssignees.length > 0 && (
                                <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px'}}>
                                    {selectedAssignees.map((user) => (
                                        <span
                                            key={user.id}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                padding: '2px 8px',
                                                borderRadius: '12px',
                                                backgroundColor: 'rgba(61, 60, 64, 0.08)',
                                                fontSize: '13px',
                                            }}
                                        >
                                            {user.name}
                                            <button
                                                type='button'
                                                onClick={() => handleRemoveAssignee(user.id)}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    padding: '0 2px',
                                                    fontSize: '14px',
                                                    lineHeight: 1,
                                                    color: 'inherit',
                                                    opacity: 0.6,
                                                }}
                                                aria-label={`Remove ${user.name}`}
                                            >
                                                {'\u00d7'}
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}

                            <input
                                id='pd-post-incident-assignee-input'
                                type='text'
                                value={userQuery}
                                onChange={(e) => {
                                    setUserQuery(e.target.value);
                                    setShowUserDropdown(true);
                                }}
                                onFocus={() => setShowUserDropdown(true)}
                                placeholder='Search PagerDuty users...'
                                autoComplete='off'
                                style={inputStyle}
                            />

                            {/* User search dropdown */}
                            {showUserDropdown && userQuery.trim() && (
                                <div
                                    className='pagerduty-user-dropdown'
                                    style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        right: 0,
                                        maxHeight: '160px',
                                        overflow: 'auto',
                                        backgroundColor: 'var(--center-channel-bg, #fff)',
                                        border: '1px solid rgba(61, 60, 64, 0.16)',
                                        borderRadius: '4px',
                                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
                                        zIndex: 1,
                                    }}
                                >
                                    {loadingUsers && (
                                        <div style={{padding: '8px 12px', fontSize: '13px', color: 'rgba(61, 60, 64, 0.56)'}}>
                                            {'Searching...'}
                                        </div>
                                    )}
                                    {!loadingUsers && users.length === 0 && (
                                        <div style={{padding: '8px 12px', fontSize: '13px', color: 'rgba(61, 60, 64, 0.56)'}}>
                                            {'No users found'}
                                        </div>
                                    )}
                                    {users.filter((u) => !selectedAssignees.some((a) => a.id === u.id)).map((user) => (
                                        <button
                                            key={user.id}
                                            type='button'
                                            onClick={() => handleAddAssignee(user)}
                                            style={{
                                                display: 'block',
                                                width: '100%',
                                                textAlign: 'left',
                                                padding: '8px 12px',
                                                border: 'none',
                                                backgroundColor: 'transparent',
                                                cursor: 'pointer',
                                                fontSize: '14px',
                                                color: 'var(--center-channel-color, #3d3c40)',
                                            }}
                                            onMouseEnter={(e) => {
                                                (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(61, 60, 64, 0.08)';
                                            }}
                                            onMouseLeave={(e) => {
                                                (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            <div>{user.name}</div>
                                            {user.email && (
                                                <div style={{fontSize: '12px', color: 'rgba(61, 60, 64, 0.56)'}}>{user.email}</div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Description */}
                        <div style={{marginBottom: '16px'}}>
                            <label
                                htmlFor='pd-post-incident-description-input'
                                style={labelStyle}
                            >
                                {'Description'}
                            </label>
                            <textarea
                                id='pd-post-incident-description-input'
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder='Additional details about the incident'
                                style={{
                                    ...inputStyle,
                                    minHeight: '80px',
                                    resize: 'vertical' as const,
                                    fontFamily: 'inherit',
                                }}
                            />
                        </div>

                        <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px'}}>
                            <button
                                type='button'
                                className='pagerduty-post-incident-cancel'
                                onClick={handleClose}
                                disabled={loading}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(61, 60, 64, 0.24)',
                                    backgroundColor: 'transparent',
                                    color: 'var(--center-channel-color, #3d3c40)',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }}
                            >
                                {'Cancel'}
                            </button>
                            <button
                                type='submit'
                                className='pagerduty-post-incident-submit'
                                disabled={loading || !title.trim() || !selectedServiceId}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    backgroundColor: 'var(--button-bg, #166de0)',
                                    color: 'var(--button-color, #fff)',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: loading || !title.trim() || !selectedServiceId ? 'not-allowed' : 'pointer',
                                    opacity: loading || !title.trim() || !selectedServiceId ? 0.6 : 1,
                                }}
                            >
                                {loading ? 'Creating...' : 'Create Incident'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default CreateIncidentPostModal;
