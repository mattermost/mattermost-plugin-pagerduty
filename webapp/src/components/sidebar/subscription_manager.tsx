// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useState} from 'react';

import client from '@/client/client';
import type {ChannelSubscription, Service} from '@/types/pagerduty';
import {EVENT_TYPE_LABELS, ALL_EVENT_TYPES} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    theme: Theme;
    channelId: string;
    onBack: () => void;
}

const SubscriptionManager: React.FC<Props> = ({theme, channelId, onBack}) => {
    const [subscription, setSubscription] = useState<ChannelSubscription | null>(null);
    const [selectedEvents, setSelectedEvents] = useState<string[]>([...ALL_EVENT_TYPES]);
    const [selectedService, setSelectedService] = useState<string>('');
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [subData, servicesData] = await Promise.all([
                client.getChannelSubscription(channelId),
                client.getServices(),
            ]);

            if (subData.subscription) {
                setSubscription(subData.subscription);
                setSelectedEvents(subData.subscription.event_types);
                if (subData.subscription.service_ids?.length > 0) {
                    setSelectedService(subData.subscription.service_ids[0]);
                }
            }
            setServices(servicesData.services || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load subscription data');
        } finally {
            setLoading(false);
        }
    }, [channelId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleEventToggle = (eventType: string) => {
        setSelectedEvents((prev) => {
            if (prev.includes(eventType)) {
                return prev.filter((e) => e !== eventType);
            }
            return [...prev, eventType];
        });
    };

    const handleSubscribe = async () => {
        if (selectedEvents.length === 0) {
            setError('Please select at least one event type');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const serviceIds = selectedService ? [selectedService] : [];
            const data = await client.createChannelSubscription(channelId, selectedEvents, serviceIds);
            setSubscription(data.subscription);
            setSuccessMessage('Channel subscribed to PagerDuty events');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to subscribe');
        } finally {
            setSaving(false);
        }
    };

    const handleUnsubscribe = async () => {
        setSaving(true);
        setError(null);

        try {
            await client.deleteChannelSubscription(channelId);
            setSubscription(null);
            setSelectedEvents([...ALL_EVENT_TYPES]);
            setSelectedService('');
            setSuccessMessage('Channel unsubscribed from PagerDuty events');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to unsubscribe');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div style={{padding: '16px'}}>
                <p style={{color: theme.centerChannelColor, opacity: 0.6}}>{'Loading...'}</p>
            </div>
        );
    }

    return (
        <div className='pagerduty-subscription-manager'>
            {/* Back button */}
            <div style={{marginBottom: '16px'}}>
                <button
                    onClick={onBack}
                    style={{
                        backgroundColor: 'transparent',
                        color: theme.linkColor,
                        border: 'none',
                        padding: '0',
                        cursor: 'pointer',
                        fontSize: '13px',
                    }}
                >
                    {'\u2190 Back'}
                </button>
            </div>

            <h4 style={{color: theme.centerChannelColor, margin: '0 0 16px 0', fontSize: '15px'}}>
                {'Channel Subscription'}
            </h4>

            <p style={{color: theme.centerChannelColor, opacity: 0.6, fontSize: '12px', margin: '0 0 16px 0', lineHeight: 1.5}}>
                {'Subscribe this channel to receive PagerDuty event notifications.'}
            </p>

            {error && (
                <div
                    role='alert'
                    style={{
                        backgroundColor: `${theme.errorTextColor}15`,
                        color: theme.errorTextColor,
                        padding: '8px 12px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        marginBottom: '12px',
                    }}
                >
                    {error}
                </div>
            )}

            {successMessage && (
                <div
                    role='status'
                    style={{
                        backgroundColor: `${theme.onlineIndicator}15`,
                        color: theme.onlineIndicator,
                        padding: '8px 12px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        marginBottom: '12px',
                    }}
                >
                    {successMessage}
                </div>
            )}

            {subscription && (
                <div
                    style={{
                        backgroundColor: `${theme.onlineIndicator}10`,
                        border: `1px solid ${theme.onlineIndicator}30`,
                        borderRadius: '4px',
                        padding: '12px',
                        marginBottom: '16px',
                    }}
                >
                    <div style={{color: theme.onlineIndicator, fontWeight: 600, fontSize: '13px', marginBottom: '4px'}}>
                        {'Active Subscription'}
                    </div>
                    <div style={{color: theme.centerChannelColor, fontSize: '12px', opacity: 0.7}}>
                        {'Events: '}{subscription.event_types.map((e) => EVENT_TYPE_LABELS[e] || e).join(', ')}
                    </div>
                    {subscription.service_ids?.length > 0 && (
                        <div style={{color: theme.centerChannelColor, fontSize: '12px', opacity: 0.7, marginTop: '2px'}}>
                            {'Service filter: '}{subscription.service_ids.join(', ')}
                        </div>
                    )}
                </div>
            )}

            {/* Event type checkboxes */}
            <div style={{marginBottom: '16px'}}>
                <label style={{color: theme.centerChannelColor, fontWeight: 600, fontSize: '13px', display: 'block', marginBottom: '8px'}}>
                    {'Event Types'}
                </label>
                {ALL_EVENT_TYPES.map((eventType) => (
                    <label
                        key={eventType}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 0',
                            cursor: 'pointer',
                            color: theme.centerChannelColor,
                            fontSize: '13px',
                        }}
                    >
                        <input
                            type='checkbox'
                            checked={selectedEvents.includes(eventType)}
                            onChange={() => handleEventToggle(eventType)}
                            style={{accentColor: theme.buttonBg}}
                        />
                        {EVENT_TYPE_LABELS[eventType] || eventType}
                    </label>
                ))}
            </div>

            {/* Service filter */}
            <div style={{marginBottom: '16px'}}>
                <label
                    htmlFor='service-filter'
                    style={{color: theme.centerChannelColor, fontWeight: 600, fontSize: '13px', display: 'block', marginBottom: '4px'}}
                >
                    {'Service Filter (Optional)'}
                </label>
                <select
                    id='service-filter'
                    value={selectedService}
                    onChange={(e) => setSelectedService(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '8px',
                        border: `1px solid ${theme.centerChannelColor}30`,
                        borderRadius: '4px',
                        backgroundColor: theme.centerChannelBg,
                        color: theme.centerChannelColor,
                        fontSize: '13px',
                    }}
                >
                    <option value=''>{'All Services'}</option>
                    {services.map((svc) => (
                        <option
                            key={svc.id}
                            value={svc.id}
                        >
                            {svc.name}
                        </option>
                    ))}
                </select>
            </div>

            {/* Action buttons */}
            <div style={{display: 'flex', gap: '8px'}}>
                <button
                    onClick={handleSubscribe}
                    disabled={saving || selectedEvents.length === 0}
                    style={{
                        backgroundColor: theme.buttonBg,
                        color: theme.buttonColor,
                        border: 'none',
                        borderRadius: '4px',
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: saving ? 'wait' : 'pointer',
                        opacity: saving || selectedEvents.length === 0 ? 0.5 : 1,
                    }}
                >
                    {subscription ? 'Update Subscription' : 'Subscribe'}
                </button>
                {subscription && (
                    <button
                        onClick={handleUnsubscribe}
                        disabled={saving}
                        style={{
                            backgroundColor: 'transparent',
                            color: theme.errorTextColor,
                            border: `1px solid ${theme.errorTextColor}`,
                            borderRadius: '4px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: saving ? 'wait' : 'pointer',
                            opacity: saving ? 0.5 : 1,
                        }}
                    >
                        {'Unsubscribe'}
                    </button>
                )}
            </div>
        </div>
    );
};

export default SubscriptionManager;
