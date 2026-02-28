// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import CreateIncidentMenuItem from './create_incident_menu_item';

import {render, screen, fireEvent} from '@/test-utils';

// Mock react-redux useSelector
const mockPostMessage = {current: 'Server is down!'};
jest.mock('react-redux', () => ({
    useSelector: (selector: (state: unknown) => unknown) => {
        const state = {
            entities: {
                posts: {
                    posts: {
                        post123: {
                            id: 'post123',
                            message: mockPostMessage.current,
                        },
                    },
                },
            },
        };
        return selector(state);
    },
}));

describe('CreateIncidentMenuItem', () => {
    const originalDispatchEvent = window.dispatchEvent;
    let dispatchedEvents: CustomEvent[] = [];

    beforeEach(() => {
        jest.clearAllMocks();
        dispatchedEvents = [];
        mockPostMessage.current = 'Server is down!';

        // Spy on dispatchEvent to capture custom events
        window.dispatchEvent = jest.fn((event: Event) => {
            if (event instanceof CustomEvent && event.type === 'pagerduty-create-incident-from-post') {
                dispatchedEvents.push(event);
            }
            return originalDispatchEvent.call(window, event);
        });
    });

    afterEach(() => {
        window.dispatchEvent = originalDispatchEvent;
    });

    it('should render menu item with correct text', () => {
        render(<CreateIncidentMenuItem postId='post123'/>);

        expect(screen.getByText('Create PagerDuty Incident')).toBeInTheDocument();
    });

    it('should render as a list item with MenuItem class', () => {
        render(<CreateIncidentMenuItem postId='post123'/>);

        const listItem = screen.getByRole('menuitem');
        expect(listItem.tagName).toBe('LI');
        expect(listItem).toHaveClass('MenuItem');
    });

    it('should render button with style--none class and presentation role', () => {
        render(<CreateIncidentMenuItem postId='post123'/>);

        const button = screen.getByRole('presentation');
        expect(button.tagName).toBe('BUTTON');
        expect(button).toHaveClass('style--none');
    });

    it('should render PagerDuty icon with MenuItem__icon class', () => {
        render(<CreateIncidentMenuItem postId='post123'/>);

        const listItem = screen.getByRole('menuitem');
        const icon = listItem.querySelector('.MenuItem__icon');
        expect(icon).toBeInTheDocument();
        expect(icon?.tagName).toBe('svg');
    });

    it('should dispatch custom event with post data when clicked', () => {
        render(<CreateIncidentMenuItem postId='post123'/>);

        fireEvent.click(screen.getByText('Create PagerDuty Incident'));

        expect(dispatchedEvents).toHaveLength(1);
        expect(dispatchedEvents[0].detail).toEqual({
            postId: 'post123',
            postMessage: 'Server is down!',
        });
    });

    it('should not render when post has no message', () => {
        mockPostMessage.current = '';

        const {container} = render(<CreateIncidentMenuItem postId='post123'/>);

        expect(container.firstChild).toBeNull();
    });
});
