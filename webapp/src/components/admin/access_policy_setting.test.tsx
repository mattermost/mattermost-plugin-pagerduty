// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import AccessPolicySetting, {MAX_FIELD_PAGES} from './access_policy_setting';

import client from '@/client/client';
import {render, screen, waitFor, fireEvent} from '@/test-utils';
import type {AccessPolicyState} from '@/types/pagerduty';

jest.mock('@/client/client');
const mockClient = client as jest.Mocked<typeof client>;

const policyState = (overrides: Partial<AccessPolicyState> = {}): AccessPolicyState => ({
    available: true,
    unavailable_reason: '',
    has_policy: false,
    policy_unknown: false,
    expression: '',
    ...overrides,
});

const fields = [{id: 'f1', name: 'team', type: 'text', object_type: 'user', attrs: {managed: 'admin'}}];

// Editor stubs: a textarea wired to onChange, plus buttons to exercise the callbacks.
const StubTable = (props: any) => (
    <div data-testid='table-editor'>
        <textarea
            aria-label='table-expression'
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
        />
        <button onClick={() => props.onParseError('cannot parse')}>{'trigger-parse-error'}</button>
        <button
            onClick={async () => {
                const res = await props.actions.getVisualAST(props.value);
                props.onChange(`ast:${JSON.stringify(res)}`);
            }}
        >
            {'call-visual-ast'}
        </button>
    </div>
);

const StubCEL = (props: any) => (
    <div data-testid='cel-editor'>
        <textarea
            aria-label='cel-expression'
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
        />
        <button
            onClick={async () => {
                const errors = await props.actions.checkExpression(props.value);
                props.onChange(`errors:${errors.length}`);
            }}
        >
            {'call-check'}
        </button>
    </div>
);

describe('AccessPolicySetting', () => {
    beforeEach(() => {
        window.Components = {AccessControlTableEditor: StubTable, AccessControlCELEditor: StubCEL};
        mockClient.getAccessPolicyFields.mockResolvedValue(fields);
    });

    afterEach(() => {
        delete window.Components;
    });

    it('loads and shows the existing expression, and explains the default', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState({has_policy: true, expression: 'user.attributes.team == "sre"'}));

        render(<AccessPolicySetting/>);

        const textarea = await screen.findByLabelText('table-expression');
        expect(textarea).toHaveValue('user.attributes.team == "sre"');
        expect(screen.getByText('An access rule is active.')).toBeInTheDocument();
        expect(screen.getByText(/With no rule, everyone can use/)).toBeInTheDocument();
        expect(screen.getByText(/also applies to system admins/)).toBeInTheDocument();
        expect(mockClient.getAccessPolicyFields).toHaveBeenCalledWith('', 100);
    });

    it('saves the edited expression through the client only', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
        mockClient.saveAccessPolicy.mockResolvedValueOnce(policyState({has_policy: true, expression: 'user.attributes.team == "sre"'}));

        render(<AccessPolicySetting/>);
        const saveButton = await screen.findByRole('button', {name: 'Save rule'});
        expect(saveButton).toBeDisabled();

        fireEvent.change(await screen.findByLabelText('table-expression'), {target: {value: 'user.attributes.team == "sre"'}});
        fireEvent.click(saveButton);

        await waitFor(() => {
            expect(mockClient.saveAccessPolicy).toHaveBeenCalledWith('user.attributes.team == "sre"');
        });
        expect(await screen.findByText('Access rule saved.')).toBeInTheDocument();
        expect(screen.getByText('An access rule is active.')).toBeInTheDocument();
    });

    it('shows the server validation error inline and keeps the draft', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
        mockClient.saveAccessPolicy.mockRejectedValueOnce(new Error('invalid expression: unexpected token'));

        render(<AccessPolicySetting/>);
        fireEvent.change(await screen.findByLabelText('table-expression'), {target: {value: 'user.bad ==='}});
        fireEvent.click(screen.getByRole('button', {name: 'Save rule'}));

        expect(await screen.findByText('invalid expression: unexpected token')).toBeInTheDocument();
        expect(screen.getByLabelText('table-expression')).toHaveValue('user.bad ===');
        expect(screen.queryByText('Access rule saved.')).not.toBeInTheDocument();
    });

    it('removes an existing rule', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState({has_policy: true, expression: 'user.attributes.team == "sre"'}));
        mockClient.deleteAccessPolicy.mockResolvedValueOnce(policyState());

        render(<AccessPolicySetting/>);
        const removeButton = await screen.findByRole('button', {name: 'Remove rule'});
        await waitFor(() => expect(removeButton).toBeEnabled());
        fireEvent.click(removeButton);

        expect(await screen.findByText('Access rule removed. Everyone can use the plugin.')).toBeInTheDocument();
        expect(mockClient.deleteAccessPolicy).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('table-expression')).toHaveValue('');
        expect(screen.getByRole('button', {name: 'Remove rule'})).toBeDisabled();
    });

    it('disables Remove when there is no rule', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
        render(<AccessPolicySetting/>);
        expect(await screen.findByRole('button', {name: 'Remove rule'})).toBeDisabled();
    });

    it('shows the unavailable reason and no editor when ABAC is unavailable', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState({available: false, unavailable_reason: 'ABAC requires an Enterprise Advanced license.'}));

        render(<AccessPolicySetting/>);

        expect(await screen.findByTestId('pagerduty-access-unavailable')).toHaveTextContent('ABAC requires an Enterprise Advanced license.');
        expect(screen.queryByTestId('table-editor')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Save rule'})).not.toBeInTheDocument();
        expect(mockClient.getAccessPolicyFields).not.toHaveBeenCalled();
    });

    it('shows a fallback notice when window.Components lacks the editors', async () => {
        delete window.Components;
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());

        render(<AccessPolicySetting/>);

        expect(await screen.findByTestId('pagerduty-access-editor-missing')).toHaveTextContent(/requires Mattermost 11.11/);
    });

    it('shows an error when loading the policy fails', async () => {
        mockClient.getAccessPolicy.mockRejectedValueOnce(new Error('forbidden'));

        render(<AccessPolicySetting/>);

        expect(await screen.findByTestId('pagerduty-access-load-error')).toHaveTextContent('forbidden');
    });

    it('switches between the simple and advanced editors, keeping the expression', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState({has_policy: true, expression: 'a == "b"'}));

        render(<AccessPolicySetting/>);
        await screen.findByTestId('table-editor');

        fireEvent.click(screen.getByRole('button', {name: 'Switch to advanced mode'}));
        expect(screen.getByTestId('cel-editor')).toBeInTheDocument();
        expect(screen.getByLabelText('cel-expression')).toHaveValue('a == "b"');

        fireEvent.click(screen.getByRole('button', {name: 'Switch to simple mode'}));
        expect(screen.getByTestId('table-editor')).toBeInTheDocument();
    });

    it('falls back to the advanced editor when the table editor cannot parse the rule', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState({has_policy: true, expression: 'complex'}));

        render(<AccessPolicySetting/>);
        fireEvent.click(await screen.findByText('trigger-parse-error'));

        expect(screen.getByTestId('cel-editor')).toBeInTheDocument();
    });

    it('wires the editors callbacks to the plugin proxy routes', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState({has_policy: true, expression: 'x'}));
        mockClient.getAccessPolicyVisualAST.mockResolvedValueOnce({conditions: []});
        mockClient.checkAccessPolicyExpression.mockResolvedValueOnce({errors: [{line: 1, column: 0, message: 'bad'}]});

        render(<AccessPolicySetting/>);
        fireEvent.click(await screen.findByText('call-visual-ast'));
        await waitFor(() => expect(mockClient.getAccessPolicyVisualAST).toHaveBeenCalledWith('x'));
        await waitFor(() => expect(screen.getByLabelText('table-expression')).toHaveValue('ast:{"data":{"conditions":[]}}'));

        fireEvent.click(screen.getByRole('button', {name: 'Switch to advanced mode'}));
        fireEvent.click(screen.getByText('call-check'));
        await waitFor(() => expect(mockClient.checkAccessPolicyExpression).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByLabelText('cel-expression')).toHaveValue('errors:1'));
    });

    describe('when ABAC is unavailable', () => {
        const unavailable = (o: Partial<AccessPolicyState> = {}) => policyState({available: false, unavailable_reason: 'ABAC is disabled.', ...o});

        it('shows the blocking warning and Remove when a rule is stored', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(unavailable({has_policy: true}));

            render(<AccessPolicySetting/>);

            expect(await screen.findByTestId('pagerduty-access-unavailable')).toBeInTheDocument();
            expect(screen.getByTestId('pagerduty-access-blocking')).toHaveTextContent(/may currently be blocking all users/);
            expect(screen.getByRole('button', {name: 'Remove rule'})).toBeEnabled();
            expect(screen.queryByRole('button', {name: 'Save rule'})).not.toBeInTheDocument();
            expect(screen.queryByTestId('table-editor')).not.toBeInTheDocument();
        });

        it('shows the blocking warning and Remove when the rule state is unknown', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(unavailable({policy_unknown: true}));

            render(<AccessPolicySetting/>);

            expect(await screen.findByTestId('pagerduty-access-blocking')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Remove rule'})).toBeEnabled();
        });

        it('hides the warning and Remove when there is neither a rule nor an unknown state', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(unavailable());

            render(<AccessPolicySetting/>);

            expect(await screen.findByTestId('pagerduty-access-unavailable')).toBeInTheDocument();
            expect(screen.queryByTestId('pagerduty-access-blocking')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', {name: 'Remove rule'})).not.toBeInTheDocument();
        });

        it('shows the server message inline when Remove fails', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(unavailable({policy_unknown: true}));
            mockClient.deleteAccessPolicy.mockRejectedValueOnce(new Error('The access rule could not be removed.'));

            render(<AccessPolicySetting/>);
            fireEvent.click(await screen.findByRole('button', {name: 'Remove rule'}));

            expect(await screen.findByTestId('pagerduty-access-error')).toHaveTextContent('The access rule could not be removed.');
            expect(screen.getByTestId('pagerduty-access-blocking')).toBeInTheDocument();
        });

        it('clears the warning after a successful removal', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(unavailable({has_policy: true}));
            mockClient.deleteAccessPolicy.mockResolvedValueOnce(unavailable());

            render(<AccessPolicySetting/>);
            fireEvent.click(await screen.findByRole('button', {name: 'Remove rule'}));

            expect(await screen.findByTestId('pagerduty-access-notice')).toBeInTheDocument();
            expect(screen.queryByTestId('pagerduty-access-blocking')).not.toBeInTheDocument();
        });
    });

    it('enables Remove when the rule state is unknown while available', async () => {
        mockClient.getAccessPolicy.mockResolvedValueOnce(policyState({policy_unknown: true}));
        render(<AccessPolicySetting/>);
        expect(await screen.findByRole('button', {name: 'Remove rule'})).toBeEnabled();
    });

    describe('usable attributes banner', () => {
        it('is shown when the server returns no fields', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
            mockClient.getAccessPolicyFields.mockResolvedValue([]);

            render(<AccessPolicySetting/>);

            expect(await screen.findByTestId('pagerduty-access-no-attributes')).toBeInTheDocument();
        });

        it('is shown when none of the fields is usable', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
            mockClient.getAccessPolicyFields.mockResolvedValue([{id: 'f1', name: 'team', attrs: {}}]);

            render(<AccessPolicySetting/>);

            expect(await screen.findByTestId('pagerduty-access-no-attributes')).toBeInTheDocument();
        });

        it('is hidden when usable fields exist', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());

            render(<AccessPolicySetting/>);
            await screen.findByTestId('table-editor');

            expect(screen.queryByTestId('pagerduty-access-no-attributes')).not.toBeInTheDocument();
        });

        it('is hidden while loading', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
            mockClient.getAccessPolicyFields.mockReturnValue(new Promise(() => {}));

            render(<AccessPolicySetting/>);
            await waitFor(() => expect(mockClient.getAccessPolicyFields).toHaveBeenCalled());

            expect(screen.queryByTestId('pagerduty-access-no-attributes')).not.toBeInTheDocument();
        });

        it('is hidden when the fields request failed, which has its own banner', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
            mockClient.getAccessPolicyFields.mockRejectedValue(new Error('boom'));

            render(<AccessPolicySetting/>);

            expect(await screen.findByTestId('pagerduty-access-fields-error')).toHaveTextContent('boom');
            expect(screen.queryByTestId('pagerduty-access-no-attributes')).not.toBeInTheDocument();
        });
    });

    describe('fields pagination', () => {
        const page = (start: number, n: number) => Array.from({length: n}, (_, i) => ({id: `f${start + i}`, name: `a${start + i}`, attrs: {managed: 'admin'}}));

        it('follows the after cursor until a short page', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
            mockClient.getAccessPolicyFields.
                mockResolvedValueOnce(page(0, 100)).
                mockResolvedValueOnce(page(100, 100)).
                mockResolvedValueOnce(page(200, 3));

            render(<AccessPolicySetting/>);
            await screen.findByTestId('table-editor');

            expect(mockClient.getAccessPolicyFields.mock.calls).toEqual([['', 100], ['f99', 100], ['f199', 100]]);
        });

        it('passes every page of fields to the editor', async () => {
            const seen: number[] = [];
            window.Components = {
                AccessControlTableEditor: (props: any) => {
                    seen.push(props.userAttributes.length);
                    return <div data-testid='table-editor'/>;
                },
                AccessControlCELEditor: StubCEL,
            };
            mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
            mockClient.getAccessPolicyFields.
                mockResolvedValueOnce(page(0, 100)).
                mockResolvedValueOnce(page(100, 5));

            render(<AccessPolicySetting/>);
            await screen.findByTestId('table-editor');

            expect(seen[seen.length - 1]).toBe(105);
        });

        it('stops after a full page followed by an empty page', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
            mockClient.getAccessPolicyFields.
                mockResolvedValueOnce(page(0, 100)).
                mockResolvedValueOnce([]);

            render(<AccessPolicySetting/>);
            await screen.findByTestId('table-editor');

            expect(mockClient.getAccessPolicyFields).toHaveBeenCalledTimes(2);
        });

        it('caps the number of pages when the server keeps returning full pages', async () => {
            mockClient.getAccessPolicy.mockResolvedValueOnce(policyState());
            let n = 0;
            mockClient.getAccessPolicyFields.mockImplementation(async () => {
                const p = page(n * 100, 100);
                n++;
                return p;
            });

            render(<AccessPolicySetting/>);
            await screen.findByTestId('table-editor');

            expect(mockClient.getAccessPolicyFields).toHaveBeenCalledTimes(MAX_FIELD_PAGES);
        });
    });
});
