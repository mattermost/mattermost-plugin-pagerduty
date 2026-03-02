// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback} from 'react';
import {useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import type {PostIncidentEventDetail} from './create_incident_post_modal';

interface Props {
    postId: string;
}

const PagerDutyIcon: React.FC = () => (
    <svg
        className='MenuItem__icon'
        width='16'
        height='16'
        viewBox='0 0 64 64'
        xmlns='http://www.w3.org/2000/svg'
        style={{fill: '#06AC38'}}
    >
        <circle
            cx='32'
            cy='32'
            r='32'
            fill='#06AC38'
        />
        <path
            d='M 16 12 L 32 12 Q 40 12 44 16 Q 48 20 48 28 Q 48 36 44 40 Q 40 44 32 44 L 24 44 L 24 52 L 16 52 Z M 24 20 L 24 36 L 32 36 Q 36 36 38 34 Q 40 32 40 28 Q 40 24 38 22 Q 36 20 32 20 Z'
            fill='white'
        />
    </svg>
);

const CreateIncidentMenuItem: React.FC<Props> = ({postId}) => {
    const postMessage = useSelector((state: GlobalState) => {
        const post = state.entities?.posts?.posts?.[postId];
        return post?.message || '';
    });

    const handleClick = useCallback((e: React.MouseEvent) => {
        if (e && e.preventDefault) {
            e.preventDefault();
        }

        if (!postMessage) {
            return;
        }

        const detail: PostIncidentEventDetail = {
            postId,
            postMessage,
        };
        window.dispatchEvent(
            new CustomEvent('pagerduty-create-incident-from-post', {detail}),
        );
    }, [postId, postMessage]);

    if (!postMessage) {
        return null;
    }

    return (
        <React.Fragment>
            <li
                className='MenuItem'
                role='menuitem'
            >
                <button
                    className='style--none'
                    role='presentation'
                    onClick={handleClick}
                >
                    <PagerDutyIcon/>
                    {'Create PagerDuty Incident'}
                </button>
            </li>
        </React.Fragment>
    );
};

export default CreateIncidentMenuItem;
