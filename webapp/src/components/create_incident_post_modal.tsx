// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState, useEffect, useCallback} from 'react';

import client from '@/client/client';
import type {Service, ServicesResponse, CreateIncidentResponse} from '@/types/pagerduty';

export interface PostIncidentEventDetail {
    postId: string;
    postMessage: string;
}

const CreateIncidentPostModal: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [selectedServiceId, setSelectedServiceId] = useState('');
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingServices, setLoadingServices] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        setTitle('');
        setDescription('');
        setSelectedServiceId('');
        setServices([]);
        setError(null);
        setSuccess(null);
        setLoading(false);
        setLoadingServices(false);
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

    // Load services when modal opens
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const fetchServices = async () => {
            try {
                setLoadingServices(true);
                const response: ServicesResponse = await client.getServices();
                setServices(response.services || []);
                if (response.services?.length > 0) {
                    setSelectedServiceId(response.services[0].id);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load services');
            } finally {
                setLoadingServices(false);
            }
        };

        fetchServices();
    }, [isOpen]);

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title.trim() || !selectedServiceId) {
            setError('Title and service are required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const incident: CreateIncidentResponse = await client.createIncident(
                title.trim(),
                description.trim(),
                selectedServiceId,
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

                        <div style={{marginBottom: '16px'}}>
                            <label
                                htmlFor='pd-post-incident-title-input'
                                style={{display: 'block', marginBottom: '4px', fontWeight: 600, fontSize: '14px'}}
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
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(61, 60, 64, 0.16)',
                                    fontSize: '14px',
                                    backgroundColor: 'var(--center-channel-bg, #fff)',
                                    color: 'var(--center-channel-color, #3d3c40)',
                                    boxSizing: 'border-box',
                                }}
                            />
                        </div>

                        <div style={{marginBottom: '16px'}}>
                            <label
                                htmlFor='pd-post-incident-service-select'
                                style={{display: 'block', marginBottom: '4px', fontWeight: 600, fontSize: '14px'}}
                            >
                                {'Service *'}
                            </label>
                            <select
                                id='pd-post-incident-service-select'
                                value={selectedServiceId}
                                onChange={(e) => setSelectedServiceId(e.target.value)}
                                required={true}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(61, 60, 64, 0.16)',
                                    fontSize: '14px',
                                    backgroundColor: 'var(--center-channel-bg, #fff)',
                                    color: 'var(--center-channel-color, #3d3c40)',
                                    cursor: 'pointer',
                                    boxSizing: 'border-box',
                                }}
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
                        </div>

                        <div style={{marginBottom: '16px'}}>
                            <label
                                htmlFor='pd-post-incident-description-input'
                                style={{display: 'block', marginBottom: '4px', fontWeight: 600, fontSize: '14px'}}
                            >
                                {'Description'}
                            </label>
                            <textarea
                                id='pd-post-incident-description-input'
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder='Additional details about the incident'
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(61, 60, 64, 0.16)',
                                    fontSize: '14px',
                                    backgroundColor: 'var(--center-channel-bg, #fff)',
                                    color: 'var(--center-channel-color, #3d3c40)',
                                    minHeight: '100px',
                                    resize: 'vertical' as const,
                                    fontFamily: 'inherit',
                                    boxSizing: 'border-box',
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
