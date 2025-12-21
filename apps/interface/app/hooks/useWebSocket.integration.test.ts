/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WS from "vitest-websocket-mock";
import { useWebSocket } from "./useWebSocket";

// Match the URL building logic from useWebSocket
function getExpectedUrl(path: string): string {
	const protocol = "ws:";
	const host = "localhost";
	return `${protocol}//${host}${path}`;
}

describe("useWebSocket", () => {
	const testPath = "/api/ws/test";
	const testUrl = getExpectedUrl(testPath);

	afterEach(() => {
		WS.clean();
		vi.useRealTimers();
	});

	it("should initialize in closed state when url is null", () => {
		const { result } = renderHook(() => useWebSocket({ url: null, onMessage: vi.fn() }));

		expect(result.current.status).toBe("closed");
		expect(result.current.isConnected).toBe(false);
	});

	it("should connect and set status to open", async () => {
		const server = new WS(testUrl, { jsonProtocol: true });
		const onMessage = vi.fn();

		const { result } = renderHook(() => useWebSocket({ url: testPath, onMessage }));

		// Wait for the hook to establish connection (check hook state, not server)
		await waitFor(
			() => {
				expect(result.current.status).toBe("open");
				expect(result.current.isConnected).toBe(true);
			},
			{ timeout: 5000 },
		);

		// Verify server also saw the connection
		expect(server.server.clients().length).toBe(1);
	});

	it("should parse JSON messages and call onMessage", async () => {
		const server = new WS(testUrl, { jsonProtocol: true });
		const onMessage = vi.fn();

		renderHook(() => useWebSocket({ url: testPath, onMessage }));

		await server.connected;
		server.send({ type: "test", data: "hello" });

		await waitFor(() => {
			expect(onMessage).toHaveBeenCalledWith({ type: "test", data: "hello" });
		});
	});

	it("should handle non-JSON messages", async () => {
		// Create server without JSON protocol for raw messages
		const rawServer = new WS(testUrl);
		const onMessage = vi.fn();

		renderHook(() => useWebSocket({ url: testPath, onMessage }));

		await rawServer.connected;
		rawServer.send("plain text message");

		await waitFor(() => {
			expect(onMessage).toHaveBeenCalledWith("plain text message");
		});
	});

	it("should call onOpen with WebSocket instance", async () => {
		const server = new WS(testUrl, { jsonProtocol: true });
		const onOpen = vi.fn();

		renderHook(() => useWebSocket({ url: testPath, onMessage: vi.fn(), onOpen }));

		await server.connected;

		await waitFor(() => {
			expect(onOpen).toHaveBeenCalledTimes(1);
			expect(onOpen).toHaveBeenCalledWith(expect.any(WebSocket));
		});
	});

	it("should call onClose when connection closes", async () => {
		const server = new WS(testUrl, { jsonProtocol: true });
		const onClose = vi.fn();

		renderHook(() =>
			useWebSocket({
				url: testPath,
				onMessage: vi.fn(),
				onClose,
				reconnect: false, // Disable reconnect for this test
			}),
		);

		await server.connected;
		server.close();

		await waitFor(() => {
			expect(onClose).toHaveBeenCalledTimes(1);
		});
	});

	it("should call onError on connection error", async () => {
		const server = new WS(testUrl, { jsonProtocol: true });
		const onError = vi.fn();

		renderHook(() =>
			useWebSocket({
				url: testPath,
				onMessage: vi.fn(),
				onError,
				reconnect: false,
			}),
		);

		await server.connected;
		server.error();

		await waitFor(() => {
			expect(onError).toHaveBeenCalledTimes(1);
		});
	});

	it("should send messages through WebSocket", async () => {
		const server = new WS(testUrl, { jsonProtocol: true });
		const { result } = renderHook(() => useWebSocket({ url: testPath, onMessage: vi.fn() }));

		await server.connected;

		act(() => {
			result.current.send({ type: "greeting", message: "hello" });
		});

		await expect(server).toReceiveMessage({
			type: "greeting",
			message: "hello",
		});
	});

	it("should send string messages without additional stringification", async () => {
		const rawServer = new WS(testUrl);
		const { result } = renderHook(() => useWebSocket({ url: testPath, onMessage: vi.fn() }));

		await rawServer.connected;

		act(() => {
			result.current.send("raw string");
		});

		await expect(rawServer).toReceiveMessage("raw string");
	});

	it("should reconnect with exponential backoff on close", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });

		let server = new WS(testUrl, { jsonProtocol: true });

		const { result } = renderHook(() =>
			useWebSocket({
				url: testPath,
				onMessage: vi.fn(),
				reconnect: true,
				baseReconnectDelay: 1000,
				maxReconnectAttempts: 3,
			}),
		);

		await server.connected;
		expect(result.current.reconnectAttempt).toBe(0);

		// Close the connection
		server.close();

		// Wait for status to update to closed
		await waitFor(() => {
			expect(result.current.status).toBe("closed");
		});

		// Clean up and create new server for reconnection
		WS.clean();
		server = new WS(testUrl, { jsonProtocol: true });

		// First reconnect attempt after 1000ms (1000 * 2^0)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(result.current.reconnectAttempt).toBe(1);
	});

	it("should respect maxReconnectAttempts", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });

		let server = new WS(testUrl, { jsonProtocol: true });

		const { result } = renderHook(() =>
			useWebSocket({
				url: testPath,
				onMessage: vi.fn(),
				reconnect: true,
				baseReconnectDelay: 100,
				maxReconnectAttempts: 2,
			}),
		);

		await server.connected;
		server.close();

		await waitFor(() => {
			expect(result.current.status).toBe("closed");
		});

		// Clean up and create new server
		WS.clean();
		server = new WS(testUrl, { jsonProtocol: true });

		// First reconnect (100ms)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		expect(result.current.reconnectAttempt).toBe(1);

		// Connect and close again
		await server.connected;
		server.close();

		await waitFor(() => {
			expect(result.current.status).toBe("closed");
		});

		// Clean up and create new server
		WS.clean();
		server = new WS(testUrl, { jsonProtocol: true });

		// Second reconnect (200ms = 100 * 2^1)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		expect(result.current.reconnectAttempt).toBe(2);

		// Connect and close again - should NOT reconnect (max attempts reached)
		await server.connected;
		server.close();

		await waitFor(() => {
			expect(result.current.status).toBe("closed");
		});

		// Advance time significantly - reconnectAttempt should stay at 2
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10000);
		});
		expect(result.current.reconnectAttempt).toBe(2);
	});

	it("should allow manual close and disable auto-reconnect", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });

		const server = new WS(testUrl, { jsonProtocol: true });

		const { result } = renderHook(() =>
			useWebSocket({
				url: testPath,
				onMessage: vi.fn(),
				reconnect: true,
				baseReconnectDelay: 100,
			}),
		);

		await server.connected;
		expect(result.current.isConnected).toBe(true);

		act(() => {
			result.current.close();
		});

		expect(result.current.status).toBe("closed");

		// Advance time - should NOT attempt reconnection after manual close
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});

		expect(result.current.reconnectAttempt).toBe(0);
		expect(result.current.status).toBe("closed");
	});

	it("should allow manual reconnect after close", async () => {
		let server = new WS(testUrl, { jsonProtocol: true });

		const { result } = renderHook(() =>
			useWebSocket({
				url: testPath,
				onMessage: vi.fn(),
				reconnect: false,
			}),
		);

		await server.connected;

		act(() => {
			result.current.close();
		});

		expect(result.current.status).toBe("closed");

		// Create new server for reconnect
		WS.clean();
		server = new WS(testUrl, { jsonProtocol: true });

		act(() => {
			result.current.reconnect();
		});

		await server.connected;

		await waitFor(() => {
			expect(result.current.status).toBe("open");
			expect(result.current.isConnected).toBe(true);
		});
	});

	it("should reset reconnect attempts on successful connection", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });

		let server = new WS(testUrl, { jsonProtocol: true });

		const { result } = renderHook(() =>
			useWebSocket({
				url: testPath,
				onMessage: vi.fn(),
				reconnect: true,
				baseReconnectDelay: 100,
				maxReconnectAttempts: 5,
			}),
		);

		await server.connected;
		server.close();

		await waitFor(() => {
			expect(result.current.status).toBe("closed");
		});

		// Clean up and create new server
		WS.clean();
		server = new WS(testUrl, { jsonProtocol: true });

		// Advance through a reconnect attempt
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		expect(result.current.reconnectAttempt).toBe(1);

		// Wait for new connection to complete
		await server.connected;

		await waitFor(() => {
			expect(result.current.status).toBe("open");
			expect(result.current.reconnectAttempt).toBe(0);
		});
	});

	it("should cleanup on unmount", async () => {
		const server = new WS(testUrl, { jsonProtocol: true });

		const { result, unmount } = renderHook(() =>
			useWebSocket({ url: testPath, onMessage: vi.fn() }),
		);

		await server.connected;
		expect(result.current.isConnected).toBe(true);

		unmount();

		await server.closed;
	});

	it("should not send messages when disconnected", async () => {
		const server = new WS(testUrl, { jsonProtocol: true });

		const { result } = renderHook(() =>
			useWebSocket({
				url: testPath,
				onMessage: vi.fn(),
				reconnect: false,
			}),
		);

		await server.connected;

		act(() => {
			result.current.close();
		});

		// This should not throw, just be a no-op
		act(() => {
			result.current.send({ type: "test" });
		});

		// Server should not have received the message
		expect(server.messages).not.toContainEqual({ type: "test" });
	});

	it("should handle URL changes by reconnecting", async () => {
		const server = new WS(testUrl, { jsonProtocol: true });

		const onMessage = vi.fn();
		const { result, rerender } = renderHook(
			({ url }: { url: string | null }) => useWebSocket({ url, onMessage }),
			{ initialProps: { url: testPath } },
		);

		await server.connected;
		expect(result.current.isConnected).toBe(true);

		// Change URL to null
		rerender({ url: null });

		await waitFor(() => {
			expect(result.current.status).toBe("closed");
		});
	});
});
