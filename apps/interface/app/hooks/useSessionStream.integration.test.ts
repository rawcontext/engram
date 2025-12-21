/**
 * @vitest-environment jsdom
 */

import type { LineageResponse, ReplayResponse } from "@lib/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WS from "vitest-websocket-mock";
import { useSessionStream } from "./useSessionStream";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Match the URL building logic from useWebSocket
function getExpectedUrl(sessionId: string): string {
	const protocol = "ws:";
	const host = "localhost";
	return `${protocol}//${host}/api/ws/session/${sessionId}`;
}

// Mock data
const mockLineageData: LineageResponse = {
	nodes: [
		{ id: "node-1", label: "Test Node 1", type: "message" },
		{ id: "node-2", label: "Test Node 2", type: "tool_call" },
	],
	links: [{ source: "node-1", target: "node-2", type: "followed_by" }],
};

const mockReplayData: ReplayResponse = {
	timeline: [
		{ id: "event-1", type: "message", content: "Hello" },
		{ id: "event-2", type: "tool_call", name: "read_file" },
	],
};

function setupFetchMock(lineage = mockLineageData, replay = mockReplayData) {
	mockFetch.mockImplementation((url: string) => {
		if (url.includes("/api/lineage/")) {
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ data: lineage }),
			});
		}
		if (url.includes("/api/replay/")) {
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ data: replay }),
			});
		}
		return Promise.reject(new Error(`Unexpected fetch: ${url}`));
	});
}

describe("useSessionStream", () => {
	const sessionId = "test-session-123";
	const wsUrl = getExpectedUrl(sessionId);

	afterEach(() => {
		WS.clean();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("should initialize with null data and not connected", () => {
		setupFetchMock();
		const { result } = renderHook(() => useSessionStream({ sessionId }));

		// Initially null before fetch completes
		expect(result.current.lineage).toBeNull();
		expect(result.current.replay).toBeNull();
		expect(result.current.error).toBeNull();
	});

	it("should fetch initial data via REST API", async () => {
		setupFetchMock();
		const server = new WS(wsUrl, { jsonProtocol: true });

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		await waitFor(() => {
			expect(result.current.lineage).toEqual(mockLineageData);
			expect(result.current.replay).toEqual(mockReplayData);
		});

		expect(mockFetch).toHaveBeenCalledWith(`/api/lineage/${sessionId}`);
		expect(mockFetch).toHaveBeenCalledWith(`/api/replay/${sessionId}`);

		// Cleanup
		server.close();
	});

	it("should connect via WebSocket and receive messages", async () => {
		setupFetchMock();
		const server = new WS(wsUrl, { jsonProtocol: true });
		const onLineageUpdate = vi.fn();

		renderHook(() => useSessionStream({ sessionId, onLineageUpdate }));

		await server.connected;

		// Verify subscription message was sent
		await expect(server).toReceiveMessage({
			type: "subscribe",
			sessionId,
		});

		// Server sends lineage update
		const updatedLineage: LineageResponse = {
			nodes: [{ id: "new-node", label: "New Node", type: "message" }],
			links: [],
		};

		server.send({ type: "lineage", data: updatedLineage });

		await waitFor(() => {
			expect(onLineageUpdate).toHaveBeenCalledWith(updatedLineage);
		});
	});

	it("should handle replay messages", async () => {
		setupFetchMock();
		const server = new WS(wsUrl, { jsonProtocol: true });
		const onReplayUpdate = vi.fn();

		const { result } = renderHook(() => useSessionStream({ sessionId, onReplayUpdate }));

		await server.connected;

		// Wait for subscription
		await expect(server).toReceiveMessage({
			type: "subscribe",
			sessionId,
		});

		const updatedReplay: ReplayResponse = {
			timeline: [{ id: "new-event", type: "new_message" }],
		};

		server.send({ type: "replay", data: updatedReplay });

		await waitFor(() => {
			expect(result.current.replay).toEqual(updatedReplay);
			expect(onReplayUpdate).toHaveBeenCalledWith(updatedReplay);
		});
	});

	it("should handle update messages with node_created type", async () => {
		setupFetchMock();
		const server = new WS(wsUrl, { jsonProtocol: true });

		renderHook(() => useSessionStream({ sessionId }));

		await server.connected;
		await expect(server).toReceiveMessage({ type: "subscribe", sessionId });

		// Send update notification
		server.send({ type: "update", data: { type: "node_created" } });

		// Should request refresh
		await expect(server).toReceiveMessage({ type: "refresh" });
	});

	it("should handle error messages", async () => {
		setupFetchMock();
		const server = new WS(wsUrl, { jsonProtocol: true });

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		await server.connected;
		await expect(server).toReceiveMessage({ type: "subscribe", sessionId });

		server.send({ type: "error", message: "Something went wrong" });

		await waitFor(() => {
			expect(result.current.error).toBe("Something went wrong");
		});
	});

	it("should fall back to polling when WebSocket unavailable", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		setupFetchMock();

		// No WebSocket server created - connection will fail

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		// Wait for initial fetch
		await waitFor(() => {
			expect(result.current.lineage).toEqual(mockLineageData);
		});

		// Advance past fallback timeout (3 seconds)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3500);
		});

		// Reset mock to track polling calls
		mockFetch.mockClear();
		setupFetchMock();

		// Advance through a polling interval (2 seconds)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		// Should have made polling requests
		expect(mockFetch).toHaveBeenCalled();
	});

	it("should handle reconnection with exponential backoff", async () => {
		setupFetchMock();
		let server = new WS(wsUrl, { jsonProtocol: true });

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		await server.connected;
		expect(result.current.isConnected).toBe(true);

		// Close connection
		server.close();

		await waitFor(() => {
			expect(result.current.isConnected).toBe(false);
		});

		// Create new server for reconnection
		WS.clean();
		server = new WS(wsUrl, { jsonProtocol: true });

		// Wait for reconnection (hook will retry)
		await server.connected;

		await waitFor(() => {
			expect(result.current.isConnected).toBe(true);
		});
	});

	it("should fall back to polling after max reconnect attempts", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		setupFetchMock();
		let server = new WS(wsUrl, { jsonProtocol: true });

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		await server.connected;
		expect(result.current.isConnected).toBe(true);

		// Simulate multiple connection failures
		for (let i = 0; i < 5; i++) {
			server.close();

			await waitFor(() => {
				expect(result.current.isConnected).toBe(false);
			});

			WS.clean();
			server = new WS(wsUrl, { jsonProtocol: true });

			await act(async () => {
				// Exponential backoff: 1000, 2000, 4000, 8000, 16000
				await vi.advanceTimersByTimeAsync(1000 * 2 ** i);
			});

			if (i < 4) {
				await server.connected;
			}
		}

		// After 5 attempts, should fall back to polling
		mockFetch.mockClear();
		setupFetchMock();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(mockFetch).toHaveBeenCalled();
	});

	it("should clean up on unmount", async () => {
		setupFetchMock();
		const server = new WS(wsUrl, { jsonProtocol: true });

		const { unmount } = renderHook(() => useSessionStream({ sessionId }));

		await server.connected;

		unmount();

		await server.closed;
	});

	it("should handle fetch errors gracefully", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Network error"));
		mockFetch.mockRejectedValueOnce(new Error("Network error"));
		const server = new WS(wsUrl, { jsonProtocol: true });

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		await waitFor(() => {
			expect(result.current.error).toBe("Network error");
		});

		server.close();
	});

	it("should call refresh manually", async () => {
		setupFetchMock();
		const server = new WS(wsUrl, { jsonProtocol: true });

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		await waitFor(() => {
			expect(result.current.lineage).toEqual(mockLineageData);
		});

		mockFetch.mockClear();

		const newLineage: LineageResponse = {
			nodes: [{ id: "refreshed-node", label: "Refreshed", type: "message" }],
			links: [],
		};

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/api/lineage/")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: newLineage }),
				});
			}
			if (url.includes("/api/replay/")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: mockReplayData }),
				});
			}
			return Promise.reject(new Error(`Unexpected fetch: ${url}`));
		});

		await act(async () => {
			await result.current.refresh();
		});

		expect(result.current.lineage).toEqual(newLineage);
		server.close();
	});

	it("should stop polling when disconnect is called", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		setupFetchMock();

		// No WebSocket server - triggers polling fallback

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		await waitFor(() => {
			expect(result.current.lineage).toEqual(mockLineageData);
		});

		// Advance past fallback timeout
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3500);
		});

		// Call disconnect
		act(() => {
			result.current.disconnect();
		});

		mockFetch.mockClear();

		// Advance through multiple polling intervals
		await act(async () => {
			await vi.advanceTimersByTimeAsync(6000);
		});

		// Should NOT have made polling requests after disconnect
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("should clear error on successful WebSocket connection", async () => {
		// Start with fetch error
		mockFetch.mockRejectedValueOnce(new Error("Initial error"));
		mockFetch.mockRejectedValueOnce(new Error("Initial error"));

		const server = new WS(wsUrl, { jsonProtocol: true });

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		await waitFor(() => {
			expect(result.current.error).toBe("Initial error");
		});

		await server.connected;

		await waitFor(() => {
			expect(result.current.error).toBeNull();
		});
	});

	it("should handle legacy update format with lineage field", async () => {
		setupFetchMock();
		const server = new WS(wsUrl, { jsonProtocol: true });
		const onLineageUpdate = vi.fn();

		renderHook(() => useSessionStream({ sessionId, onLineageUpdate }));

		await server.connected;
		await expect(server).toReceiveMessage({ type: "subscribe", sessionId });

		const legacyUpdate = {
			type: "update",
			lineage: mockLineageData,
		};

		server.send(legacyUpdate);

		await waitFor(() => {
			expect(onLineageUpdate).toHaveBeenCalledWith(mockLineageData);
		});
	});

	it("should expose WebSocket status", async () => {
		setupFetchMock();
		const server = new WS(wsUrl, { jsonProtocol: true });

		const { result } = renderHook(() => useSessionStream({ sessionId }));

		expect(result.current.status).toBe("connecting");

		await server.connected;

		await waitFor(() => {
			expect(result.current.status).toBe("open");
		});

		server.close();

		await waitFor(() => {
			expect(result.current.status).toBe("closed");
		});
	});
});
