// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import client from '@/client/client';
import type {PluginRegistry} from '@/types/mattermost-webapp';

jest.mock('@/client/client');
const mockClient = client as jest.Mocked<typeof client>;

jest.mock('./components/sidebar/sidebar', () => ({__esModule: true, default: () => null}));
jest.mock('./components/create_incident_menu_item', () => ({__esModule: true, default: () => null}));
jest.mock('./components/create_incident_post_modal', () => ({__esModule: true, default: () => null}));
jest.mock('@/components/admin/access_policy_setting', () => ({__esModule: true, default: () => null}));

const EVENT = 'custom_com.mattermost.plugin-pagerduty_access_policy_changed';

let PluginClass: new () => {initialize: (r: PluginRegistry, s: any) => Promise<void>};

beforeAll(async () => {
    (window as any).registerPlugin = jest.fn();
    PluginClass = (await import('./index')).default as any;
});

// Advances fake timers and lets pending promise callbacks run.
const tick = async (ms = 0) => {
    jest.advanceTimersByTime(ms);
    await Promise.all(Array.from({length: 20}, () => Promise.resolve()));
};
const flush = () => tick(0);

beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    mockClient.getAccess.mockReset();
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
});

function setup() {
    let n = 0;
    const ids = () => `id${++n}`;
    const handlers: Record<string, () => void> = {};
    let reconnect: () => void = () => {};
    const hideAction = {type: 'hide'};
    const toggleAction = {type: 'toggle'};
    const registry = {
        registerAdminConsoleCustomSetting: jest.fn(),
        registerRightHandSidebarComponent: jest.fn(() => ({id: ids(), showRHSPlugin: {type: 'show'}, hideRHSPlugin: hideAction, toggleRHSPlugin: toggleAction})),
        registerChannelHeaderButtonAction: jest.fn(() => ids()),
        registerRootComponent: jest.fn(() => ids()),
        registerPostDropdownMenuComponent: jest.fn(() => ids()),
        unregisterComponent: jest.fn(),
        registerWebSocketEventHandler: jest.fn((event: string, handler: () => void) => {
            handlers[event] = handler;
        }),
        registerReconnectHandler: jest.fn((handler: () => void) => {
            reconnect = handler;
        }),
        registerPostTypeComponent: jest.fn(),
    };
    const store = {dispatch: jest.fn()};
    return {registry, store, handlers, fireReconnect: () => reconnect(), hideAction, toggleAction};
}

const registerCalls = (r: ReturnType<typeof setup>['registry']) => [
    r.registerRightHandSidebarComponent,
    r.registerChannelHeaderButtonAction,
    r.registerRootComponent,
    r.registerPostDropdownMenuComponent,
];

describe('Plugin registration', () => {
    it('registers the admin setting even when access is denied, and nothing else', async () => {
        mockClient.getAccess.mockResolvedValue({allowed: false});
        const {registry, store} = setup();

        await new PluginClass().initialize(registry as any, store);
        await flush();

        expect(registry.registerAdminConsoleCustomSetting).toHaveBeenCalledWith('AccessPolicy', expect.anything(), {showTitle: true});
        registerCalls(registry).forEach((fn) => expect(fn).not.toHaveBeenCalled());
        expect(registry.registerWebSocketEventHandler).toHaveBeenCalledWith(EVENT, expect.any(Function));
        expect(registry.registerReconnectHandler).toHaveBeenCalledWith(expect.any(Function));
    });

    it('registers all UI once when allowed', async () => {
        mockClient.getAccess.mockResolvedValue({allowed: true});
        const {registry, store} = setup();

        await new PluginClass().initialize(registry as any, store);
        await flush();

        registerCalls(registry).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
        expect(registry.registerAdminConsoleCustomSetting).toHaveBeenCalledTimes(1);

        // The header button toggles the RHS registered for this user.
        const action = (registry.registerChannelHeaderButtonAction.mock.calls[0] as any[])[1] as () => void;
        action();
        expect(store.dispatch).toHaveBeenCalledWith({type: 'toggle'});
    });

    it('registers on a later reconnect after an initial failure', async () => {
        mockClient.getAccess.mockRejectedValueOnce(new Error('network'));
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        const {registry, store, fireReconnect} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();
        expect(registry.registerRootComponent).not.toHaveBeenCalled();

        fireReconnect();
        await flush();

        registerCalls(registry).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
    });

    it('unregisters every registered id when the websocket event revokes access', async () => {
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        const {registry, store, handlers, hideAction} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        mockClient.getAccess.mockResolvedValueOnce({allowed: false});
        handlers[EVENT]();
        await flush();

        // ids are issued in registration order: rhs, header button, root, post menu
        const unregistered = registry.unregisterComponent.mock.calls.map((c: any[]) => c[0]).sort();
        expect(unregistered).toEqual(['id1', 'id2', 'id3', 'id4']);
        expect(store.dispatch).toHaveBeenCalledWith(hideAction);
    });

    it('registers when the websocket event grants access', async () => {
        mockClient.getAccess.mockResolvedValueOnce({allowed: false});
        const {registry, store, handlers} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        handlers[EVENT]();
        await flush();

        registerCalls(registry).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
    });

    it('never double-registers on repeated allowed events and reconnects', async () => {
        mockClient.getAccess.mockResolvedValue({allowed: true});
        const {registry, store, handlers, fireReconnect} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        handlers[EVENT]();
        handlers[EVENT]();
        fireReconnect();
        await flush();

        registerCalls(registry).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
        expect(registry.unregisterComponent).not.toHaveBeenCalled();
    });

    it('does not unregister twice on repeated denied events', async () => {
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        const {registry, store, handlers} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        mockClient.getAccess.mockResolvedValue({allowed: false});
        handlers[EVENT]();
        handlers[EVENT]();
        await flush();

        expect(registry.unregisterComponent).toHaveBeenCalledTimes(4);
    });

    it('lets the newest check win when responses arrive out of order', async () => {
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        const {registry, store, fireReconnect} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        // First check (stale) resolves to denied only after the second (newer) one resolved to allowed.
        let resolveStale: (v: {allowed: boolean}) => void = () => {};
        mockClient.getAccess.mockReturnValueOnce(new Promise((resolve) => {
            resolveStale = resolve;
        }));
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        fireReconnect();
        fireReconnect();
        await flush();
        resolveStale({allowed: false});
        await flush();

        expect(registry.unregisterComponent).not.toHaveBeenCalled();
    });
});

describe('Plugin access check resilience', () => {
    const RETRY_DELAYS = [2000, 5000, 15000, 30000];

    it('initialize resolves without waiting for /access', async () => {
        mockClient.getAccess.mockReturnValue(new Promise(() => {}));
        const {registry, store} = setup();

        await expect(new PluginClass().initialize(registry as any, store)).resolves.toBeUndefined();
        expect(mockClient.getAccess).toHaveBeenCalledTimes(1);
    });

    it('does not register on a first-load error and retries on the backoff schedule, then stops', async () => {
        mockClient.getAccess.mockRejectedValue(new Error('network'));
        const {registry, store} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();
        expect(mockClient.getAccess).toHaveBeenCalledTimes(1);

        let calls = 1;
        for (const delay of RETRY_DELAYS) {
            // eslint-disable-next-line no-await-in-loop
            await tick(delay - 1);
            expect(mockClient.getAccess).toHaveBeenCalledTimes(calls);
            // eslint-disable-next-line no-await-in-loop
            await tick(1);
            calls++;
            expect(mockClient.getAccess).toHaveBeenCalledTimes(calls);
        }

        await tick(10 * 60 * 1000);
        expect(mockClient.getAccess).toHaveBeenCalledTimes(5);
        registerCalls(registry).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });

    it('registers when a retry succeeds', async () => {
        mockClient.getAccess.mockRejectedValueOnce(new Error('network'));
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        const {registry, store} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        await tick(2000);

        registerCalls(registry).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
    });

    it('keeps the UI when a check fails after registration, and retries', async () => {
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        const {registry, store, fireReconnect} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        mockClient.getAccess.mockRejectedValueOnce(new Error('503'));
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        fireReconnect();
        await flush();
        expect(registry.unregisterComponent).not.toHaveBeenCalled();

        await tick(2000);

        expect(mockClient.getAccess).toHaveBeenCalledTimes(3);
        expect(registry.unregisterComponent).not.toHaveBeenCalled();
        registerCalls(registry).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
    });

    it('still unregisters on an explicit denial found by a retry', async () => {
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        const {registry, store, fireReconnect} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        mockClient.getAccess.mockRejectedValueOnce(new Error('503'));
        mockClient.getAccess.mockResolvedValueOnce({allowed: false});
        fireReconnect();
        await flush();
        expect(registry.unregisterComponent).not.toHaveBeenCalled();

        await tick(2000);

        expect(registry.unregisterComponent).toHaveBeenCalledTimes(4);
    });

    it('a newer check cancels pending retries', async () => {
        mockClient.getAccess.mockRejectedValueOnce(new Error('network'));
        const {registry, store, fireReconnect} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        // A retry is now pending; the reconnect check succeeds and must cancel it.
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        fireReconnect();
        await flush();
        expect(mockClient.getAccess).toHaveBeenCalledTimes(2);

        await tick(60000);

        expect(mockClient.getAccess).toHaveBeenCalledTimes(2);
        registerCalls(registry).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
    });

    it('a stale failure does not schedule a retry once a newer check started', async () => {
        let rejectStale: (e: Error) => void = () => {};
        mockClient.getAccess.mockReturnValueOnce(new Promise((_, reject) => {
            rejectStale = reject;
        }));
        const {registry, store, fireReconnect} = setup();
        await new PluginClass().initialize(registry as any, store);

        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        fireReconnect();
        await flush();
        rejectStale(new Error('late'));
        await flush();
        await tick(60000);

        expect(mockClient.getAccess).toHaveBeenCalledTimes(2);
    });

    it('jitters the re-check after the websocket event by 0-3s', async () => {
        mockClient.getAccess.mockResolvedValueOnce({allowed: true});
        const {registry, store, handlers} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();
        expect(mockClient.getAccess).toHaveBeenCalledTimes(1);

        (Math.random as jest.Mock).mockReturnValue(0.5);
        mockClient.getAccess.mockResolvedValueOnce({allowed: false});
        handlers[EVENT]();
        await tick(1499);
        expect(mockClient.getAccess).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(mockClient.getAccess).toHaveBeenCalledTimes(2);
        expect(registry.unregisterComponent).toHaveBeenCalledTimes(4);
    });

    it('does not jitter reconnect re-checks', async () => {
        mockClient.getAccess.mockResolvedValue({allowed: true});
        const {registry, store, fireReconnect} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        (Math.random as jest.Mock).mockReturnValue(0.99);
        fireReconnect();
        await flush();

        expect(mockClient.getAccess).toHaveBeenCalledTimes(2);
    });

    it('collapses repeated events into one jittered check', async () => {
        mockClient.getAccess.mockResolvedValue({allowed: true});
        const {registry, store, handlers} = setup();
        await new PluginClass().initialize(registry as any, store);
        await flush();

        handlers[EVENT]();
        handlers[EVENT]();
        await tick(3000);

        expect(mockClient.getAccess).toHaveBeenCalledTimes(2);
    });
});
