// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {User} from '@/types/pagerduty';

// PagerDuty sometimes returns reference-style user objects with an empty
// name but a populated summary (or neither). Fall back through the fields
// most likely to contain a human-readable identifier.
export const getUserDisplayName = (user: User): string => {
    return user.name || user.summary || user.email || user.id;
};
