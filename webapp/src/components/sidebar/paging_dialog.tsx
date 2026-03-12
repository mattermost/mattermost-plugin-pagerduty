// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState, useEffect} from 'react';

import client from '@/client/client';
import type {Service, ServicesResponse, CreateIncidentResponse, User, Schedule} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface PagingDialogProps {
    theme: Theme;
    targetType: 'schedule' | 'user';
    target: Schedule | User;
    onClose: () => void;
    onSuccess: (incident: CreateIncidentResponse) => void;
}

export const PagingDialog: React.FC<PagingDialogProps> = ({theme, targetType, target, onClose, onSuccess}) => {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [selectedServiceId, setSelectedServiceId] = useState('');
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingServices, setLoadingServices] = useState(true);

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Load services on mount
    useEffect(() => {
        const fetchServices = async () => {
            try {
                setLoadingServices(true);
                const response: ServicesResponse = await client.getServices();
                setServices(response.services);
                if (response.services.length > 0) {
                    setSelectedServiceId(response.services[0].id);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load services');
            } finally {
                setLoadingServices(false);
            }
        };

        fetchServices();
    }, []);

    // Set default title based on target
    useEffect(() => {
        if (targetType === 'schedule') {
            setTitle(`Issue with ${target.name} schedule`);
        } else {
            setTitle(`Paging current on-call: ${target.name || target.summary}`);
        }
    }, [targetType, target]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title.trim() || !selectedServiceId) {
            setError('Title and service are required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const assigneeIds = targetType === 'user' ? [target.id] : [];
            const incident = await client.createIncident(title, description, selectedServiceId, undefined, assigneeIds);
            onSuccess(incident);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create incident');
        } finally {
            setLoading(false);
        }
    };

    const dialogStyle: React.CSSProperties = {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
    };

    const contentStyle: React.CSSProperties = {
        backgroundColor: theme.centerChannelBg,
        color: theme.centerChannelColor,
        borderRadius: '4px',
        padding: '24px',
        width: '500px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
    };

    const headerStyle: React.CSSProperties = {
        fontSize: '18px',
        fontWeight: 600,
        marginBottom: '16px',
        color: theme.centerChannelColor,
    };

    const labelStyle: React.CSSProperties = {
        display: 'block',
        marginBottom: '4px',
        fontWeight: 600,
        color: theme.centerChannelColor,
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '8px 12px',
        border: `1px solid ${theme.centerChannelColor}20`,
        borderRadius: '4px',
        fontSize: '14px',
        backgroundColor: theme.centerChannelBg,
        color: theme.centerChannelColor,
        marginBottom: '16px',
    };

    const selectStyle: React.CSSProperties = {
        ...inputStyle,
        cursor: 'pointer',
    };

    const textareaStyle: React.CSSProperties = {
        ...inputStyle,
        minHeight: '80px',
        resize: 'vertical' as const,
        fontFamily: 'inherit',
    };

    const buttonStyle: React.CSSProperties = {
        padding: '8px 16px',
        borderRadius: '4px',
        border: 'none',
        fontSize: '14px',
        fontWeight: 600,
        cursor: 'pointer',
        marginRight: '8px',
    };

    const primaryButtonStyle: React.CSSProperties = {
        ...buttonStyle,
        backgroundColor: theme.buttonBg,
        color: theme.buttonColor,
    };

    const secondaryButtonStyle: React.CSSProperties = {
        ...buttonStyle,
        backgroundColor: 'transparent',
        color: theme.centerChannelColor,
        border: `1px solid ${theme.centerChannelColor}40`,
    };

    const errorStyle: React.CSSProperties = {
        color: theme.errorTextColor || '#d24b47',
        fontSize: '14px',
        marginBottom: '16px',
        padding: '8px 12px',
        backgroundColor: theme.errorTextColor ? `${theme.errorTextColor}10` : '#d24b4710',
        borderRadius: '4px',
    };

    const targetDisplayName = targetType === 'schedule' ? target.name : (target.name || target.summary);
    const actionText = targetType === 'schedule' ? 'Page Schedule' : 'Page Current On-Call';

    return (
        <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='paging-dialog-title'
            style={dialogStyle}
            onClick={onClose}
        >
            <div
                style={contentStyle}
                onClick={(e) => e.stopPropagation()}
            >
                <h2
                    id='paging-dialog-title'
                    style={headerStyle}
                >
                    {actionText}{': '}{targetDisplayName}
                </h2>

                {loadingServices ? (
                    <div style={{textAlign: 'center', padding: '20px'}}>
                        {'Loading services...'}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        {error && <div style={errorStyle}>{error}</div>}

                        <div>
                            <label
                                style={labelStyle}
                                htmlFor='incident-title'
                            >
                                {'Incident Title *'}
                            </label>
                            <input
                                id='incident-title'
                                type='text'
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                style={inputStyle}
                                placeholder='Brief description of the issue'
                                required={true}
                            />
                        </div>

                        <div>
                            <label
                                style={labelStyle}
                                htmlFor='incident-service'
                            >
                                {'Service *'}
                            </label>
                            <select
                                id='incident-service'
                                value={selectedServiceId}
                                onChange={(e) => setSelectedServiceId(e.target.value)}
                                style={selectStyle}
                                required={true}
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

                        <div>
                            <label
                                style={labelStyle}
                                htmlFor='incident-description'
                            >
                                {'Description'}
                            </label>
                            <textarea
                                id='incident-description'
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                style={textareaStyle}
                                placeholder='Additional details about the incident'
                            />
                        </div>

                        <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: '20px'}}>
                            <button
                                type='button'
                                onClick={onClose}
                                style={secondaryButtonStyle}
                                disabled={loading}
                            >
                                {'Cancel'}
                            </button>
                            <button
                                type='submit'
                                style={primaryButtonStyle}
                                disabled={loading || !title.trim() || !selectedServiceId}
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
