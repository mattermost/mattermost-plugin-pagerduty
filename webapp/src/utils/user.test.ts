// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getUserDisplayName} from './user';

import type {User} from '@/types/pagerduty';

const baseUser: User = {
    id: 'U1',
    name: '',
    email: '',
    type: 'user',
    summary: '',
    description: '',
    role: 'user',
    time_zone: 'UTC',
    color: '',
    avatar_url: '',
};

describe('getUserDisplayName', () => {
    it('returns name when present', () => {
        expect(getUserDisplayName({...baseUser, name: 'Jane Doe', summary: 'Summary'})).toBe('Jane Doe');
    });

    it('falls back to summary when name is empty', () => {
        expect(getUserDisplayName({...baseUser, summary: 'Jane Doe'})).toBe('Jane Doe');
    });

    it('falls back to email when name and summary are empty', () => {
        expect(getUserDisplayName({...baseUser, email: 'jane@example.com'})).toBe('jane@example.com');
    });

    it('falls back to id when no other field is populated', () => {
        expect(getUserDisplayName(baseUser)).toBe('U1');
    });
});
