// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState, useEffect} from 'react';

import client from '@/client/client';
import type {Incident, IncidentNote} from '@/types/pagerduty';
import type {Theme} from '@/types/theme';

interface Props {
    incident: Incident | null;
    onBack: () => void;
    theme: Theme;
    onIncidentUpdated: (incident: Incident) => void;
}

const getStatusColor = (status: string, theme: Theme): string => {
    switch (status) {
    case 'triggered':
        return theme.dndIndicator || '#f74343';
    case 'acknowledged':
        return theme.awayIndicator || '#ffbc42';
    case 'resolved':
        return theme.onlineIndicator || '#06d6a0';
    default:
        return theme.centerChannelColor;
    }
};

const getStatusLabel = (status: string): string => {
    switch (status) {
    case 'triggered':
        return 'Triggered';
    case 'acknowledged':
        return 'Acknowledged';
    case 'resolved':
        return 'Resolved';
    default:
        return status;
    }
};

const formatDateTime = (dateString: string): string => {
    const date = new Date(dateString);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
};

const IncidentDetails: React.FC<Props> = ({incident, onBack, theme, onIncidentUpdated}) => {
    const [notes, setNotes] = useState<IncidentNote[]>([]);
    const [loadingNotes, setLoadingNotes] = useState(true);
    const [noteContent, setNoteContent] = useState('');
    const [submittingNote, setSubmittingNote] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (incident) {
            fetchNotes();
        }
    }, [incident?.id]);

    const fetchNotes = async () => {
        if (!incident) {
            return;
        }
        setLoadingNotes(true);
        try {
            const data = await client.getIncidentNotes(incident.id);
            setNotes(data.notes || []);
        } catch (err) {
            // Notes may not be available, don't block the view
            setNotes([]);
        } finally {
            setLoadingNotes(false);
        }
    };

    const handleAcknowledge = async () => {
        if (!incident) {
            return;
        }
        setActionLoading('acknowledge');
        setError(null);
        try {
            const response = await client.updateIncident(incident.id, 'acknowledged');
            onIncidentUpdated(response.incident);
            setSuccessMessage('Incident acknowledged');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to acknowledge');
        } finally {
            setActionLoading(null);
        }
    };

    const handleResolve = async () => {
        if (!incident) {
            return;
        }
        setActionLoading('resolve');
        setError(null);
        try {
            const response = await client.updateIncident(incident.id, 'resolved');
            onIncidentUpdated(response.incident);
            setSuccessMessage('Incident resolved');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to resolve');
        } finally {
            setActionLoading(null);
        }
    };

    const handleAddNote = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!incident || !noteContent.trim()) {
            return;
        }
        setSubmittingNote(true);
        setError(null);
        try {
            const response = await client.createIncidentNote(incident.id, noteContent.trim());
            setNotes((prev) => [...prev, response.note]);
            setNoteContent('');
            setSuccessMessage('Note added');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add note');
        } finally {
            setSubmittingNote(false);
        }
    };

    if (!incident) {
        return (
            <div style={{padding: '20px', color: theme.centerChannelColor}}>
                {'No incident selected'}
            </div>
        );
    }

    const statusColor = getStatusColor(incident.status || '', theme);

    return (
        <div className='incident-details-container' style={{padding: '4px 0'}}>
            {successMessage && (
                <div
                    className='success-message'
                    style={{
                        backgroundColor: theme.onlineIndicator || '#28a745',
                        color: 'white',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        marginBottom: '16px',
                        fontSize: '14px',
                    }}
                >
                    {successMessage}
                </div>
            )}

            {error && (
                <div
                    style={{
                        backgroundColor: '#d24b4720',
                        color: '#d24b47',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        marginBottom: '16px',
                        fontSize: '13px',
                        border: '1px solid #d24b4740',
                    }}
                >
                    {error}
                </div>
            )}

            {/* Status and title */}
            <div style={{marginBottom: '16px'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px'}}>
                    <span
                        style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            color: 'white',
                            padding: '2px 6px',
                            backgroundColor: statusColor,
                            borderRadius: '4px',
                            textTransform: 'uppercase' as const,
                            letterSpacing: '0.5px',
                        }}
                    >
                        {getStatusLabel(incident.status || '')}
                    </span>
                    {incident.urgency && (
                        <span style={{fontSize: '11px', color: theme.centerChannelColor, opacity: 0.6}}>
                            {incident.urgency === 'high' ? 'High Urgency' : 'Low Urgency'}
                        </span>
                    )}
                </div>
                <h4 style={{margin: 0, color: theme.centerChannelColor, fontSize: '16px', fontWeight: 600}}>
                    {incident.title}
                </h4>
            </div>

            {/* Detail fields */}
            <div
                style={{
                    backgroundColor: theme.centerChannelBg,
                    border: `1px solid ${theme.centerChannelColor}20`,
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                }}
            >
                {incident.service?.summary && (
                    <div style={{marginBottom: '8px'}}>
                        <span style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.6}}>{'Service: '}</span>
                        <span style={{fontSize: '13px', color: theme.centerChannelColor, fontWeight: 500}}>{incident.service.summary}</span>
                    </div>
                )}
                {incident.priority && (
                    <div style={{marginBottom: '8px'}}>
                        <span style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.6}}>{'Priority: '}</span>
                        <span style={{fontSize: '13px', color: theme.centerChannelColor, fontWeight: 500}}>{incident.priority.summary || incident.priority.name}</span>
                    </div>
                )}
                {incident.created_at && (
                    <div style={{marginBottom: '8px'}}>
                        <span style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.6}}>{'Created: '}</span>
                        <span style={{fontSize: '13px', color: theme.centerChannelColor}}>{formatDateTime(incident.created_at)}</span>
                    </div>
                )}
                {incident.description && (
                    <div style={{marginBottom: '0'}}>
                        <span style={{fontSize: '12px', color: theme.centerChannelColor, opacity: 0.6}}>{'Description: '}</span>
                        <div style={{fontSize: '13px', color: theme.centerChannelColor, marginTop: '4px'}}>{incident.description}</div>
                    </div>
                )}
            </div>

            {/* Action buttons */}
            <div style={{display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap'}}>
                {incident.status === 'triggered' && (
                    <button
                        className='incident-ack-button'
                        disabled={actionLoading !== null}
                        onClick={handleAcknowledge}
                        style={{
                            backgroundColor: theme.awayIndicator || '#ffbc42',
                            color: '#1e1e1e',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: actionLoading ? 'default' : 'pointer',
                            opacity: actionLoading ? 0.6 : 1,
                        }}
                    >
                        {actionLoading === 'acknowledge' ? 'Acknowledging...' : 'Acknowledge'}
                    </button>
                )}
                {(incident.status === 'triggered' || incident.status === 'acknowledged') && (
                    <button
                        className='incident-resolve-button'
                        disabled={actionLoading !== null}
                        onClick={handleResolve}
                        style={{
                            backgroundColor: theme.onlineIndicator || '#06d6a0',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: actionLoading ? 'default' : 'pointer',
                            opacity: actionLoading ? 0.6 : 1,
                        }}
                    >
                        {actionLoading === 'resolve' ? 'Resolving...' : 'Resolve'}
                    </button>
                )}
                {incident.html_url && (
                    <a
                        href={incident.html_url}
                        target='_blank'
                        rel='noopener noreferrer'
                        style={{
                            color: theme.linkColor,
                            fontSize: '13px',
                            textDecoration: 'none',
                            padding: '8px 16px',
                            border: `1px solid ${theme.linkColor}`,
                            borderRadius: '6px',
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        {'Open in PagerDuty'}
                    </a>
                )}
            </div>

            {/* Notes section */}
            <div style={{borderTop: `1px solid ${theme.centerChannelColor}20`, paddingTop: '16px'}}>
                <h4 style={{margin: '0 0 12px 0', color: theme.centerChannelColor, fontSize: '14px', fontWeight: 600}}>
                    {'Notes'}
                </h4>

                {loadingNotes ? (
                    <div style={{fontSize: '13px', color: theme.centerChannelColor, opacity: 0.6}}>
                        {'Loading notes...'}
                    </div>
                ) : notes.length === 0 ? (
                    <div style={{fontSize: '13px', color: theme.centerChannelColor, opacity: 0.6, marginBottom: '12px'}}>
                        {'No notes yet'}
                    </div>
                ) : (
                    <div style={{marginBottom: '12px'}}>
                        {notes.map((note) => (
                            <div
                                key={note.id}
                                className='incident-note'
                                style={{
                                    backgroundColor: theme.centerChannelBg,
                                    border: `1px solid ${theme.centerChannelColor}15`,
                                    borderRadius: '6px',
                                    padding: '10px',
                                    marginBottom: '8px',
                                }}
                            >
                                <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '4px'}}>
                                    <span style={{fontSize: '12px', fontWeight: 500, color: theme.centerChannelColor}}>
                                        {note.user.summary}
                                    </span>
                                    <span style={{fontSize: '11px', color: theme.centerChannelColor, opacity: 0.5}}>
                                        {formatDateTime(note.created_at)}
                                    </span>
                                </div>
                                <div style={{fontSize: '13px', color: theme.centerChannelColor, whiteSpace: 'pre-wrap'}}>
                                    {note.content}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add note form */}
                <form onSubmit={handleAddNote}>
                    <textarea
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        placeholder='Add a note...'
                        style={{
                            width: '100%',
                            minHeight: '60px',
                            padding: '8px',
                            borderRadius: '6px',
                            border: `1px solid ${theme.centerChannelColor}30`,
                            backgroundColor: theme.centerChannelBg,
                            color: theme.centerChannelColor,
                            fontSize: '13px',
                            resize: 'vertical',
                            boxSizing: 'border-box',
                        }}
                    />
                    <button
                        type='submit'
                        disabled={submittingNote || !noteContent.trim()}
                        style={{
                            marginTop: '8px',
                            backgroundColor: theme.buttonBg,
                            color: theme.buttonColor,
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: submittingNote || !noteContent.trim() ? 'default' : 'pointer',
                            opacity: submittingNote || !noteContent.trim() ? 0.5 : 1,
                        }}
                    >
                        {submittingNote ? 'Adding...' : 'Add Note'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default IncidentDetails;
