import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initWebSocket, broadcast } from '../wsBroadcast.mjs';

// Mock ws
vi.mock('ws', () => {
    const on = vi.fn();
    const WebSocketServer = vi.fn(() => ({
        on
    }));
    return { WebSocketServer };
});

import { WebSocketServer } from 'ws';

describe('wsBroadcast', () => {
    it('broadcast() handles no server initialized', () => {
        expect(() => broadcast('test', {})).not.toThrow();
    });

    it('broadcast() sends message to open clients', () => {
        const mockServer = {};
        initWebSocket(mockServer);

        const wssInstance = vi.mocked(WebSocketServer).mock.results[0].value;
        const connectionHandler = wssInstance.on.mock.calls.find(c => c[0] === 'connection')[1];

        const mockClient = {
            readyState: 1, // OPEN
            send: vi.fn(),
            on: vi.fn()
        };

        connectionHandler(mockClient);
        broadcast('foo', { bar: 1 });

        expect(mockClient.send).toHaveBeenCalledWith(JSON.stringify({ event: 'foo', data: { bar: 1 } }));
    });

    it('broadcast() does not send to closed clients', () => {
        const mockServer = {};
        initWebSocket(mockServer);

        const wssInstance = vi.mocked(WebSocketServer).mock.results[1].value;
        const connectionHandler = wssInstance.on.mock.calls.find(c => c[0] === 'connection')[1];

        const mockClient = {
            readyState: 3, // CLOSED
            send: vi.fn(),
            on: vi.fn()
        };

        connectionHandler(mockClient);
        broadcast('foo', { bar: 1 });

        expect(mockClient.send).not.toHaveBeenCalled();
    });

    it('handles client close and error', () => {
        initWebSocket({});
        const wssInstance = vi.mocked(WebSocketServer).mock.results[vi.mocked(WebSocketServer).mock.results.length - 1].value;
        const connectionHandler = wssInstance.on.mock.calls.find(c => c[0] === 'connection')[1];

        const mockClient = {
            readyState: 1,
            send: vi.fn(),
            on: vi.fn()
        };

        connectionHandler(mockClient);
        const closeHandler = mockClient.on.mock.calls.find(c => c[0] === 'close')[1];
        const errorHandler = mockClient.on.mock.calls.find(c => c[0] === 'error')[1];

        closeHandler();
        errorHandler(new Error('fail'));
        broadcast('foo', {});
        expect(mockClient.send).not.toHaveBeenCalled();
    });
});
