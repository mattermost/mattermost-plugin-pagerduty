// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export const mockTheme = {
    sidebarBg: '#145dbf',
    sidebarText: '#ffffff',
    sidebarTextHoverBg: '#4578bf',
    sidebarTextActiveBorder: '#579eff',
    sidebarTextActiveColor: '#ffffff',
    sidebarHeaderBg: '#1153ab',
    sidebarHeaderTextColor: '#ffffff',
    onlineIndicator: '#06d6a0',
    awayIndicator: '#ffbc42',
    dndIndicator: '#f74343',
    mentionBg: '#ffffff',
    mentionColor: '#145dbf',
    centerChannelBg: '#ffffff',
    centerChannelColor: '#3d3c40',
    newMessageSeparator: '#ff8800',
    linkColor: '#2389d7',
    buttonBg: '#166de0',
    buttonColor: '#ffffff',
    errorTextColor: '#fd5960',
    mentionHighlightBg: '#ffe577',
    mentionHighlightLink: '#166de0',
    codeTheme: 'github',
    sidebarUnreadText: '#ffffff',
    sidebarTextHoverColor: '#e1f5fe',
};

// Re-export everything from testing library
export * from '@testing-library/react';

// Mock the client
export const mockClient = {
    getSchedules: jest.fn(),
    getOnCalls: jest.fn(),
    getScheduleDetails: jest.fn(),
    getServices: jest.fn(),
    createIncident: jest.fn(),
    getIncidents: jest.fn(),
    updateIncident: jest.fn(),
    getIncidentNotes: jest.fn(),
    createIncidentNote: jest.fn(),
};

// Reset all mocks
export function resetMocks() {
    jest.clearAllMocks();
}
