/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStream } from "./useSessionStream";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock WebSocket
class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState = MockWebSocket.CONNECTING;
	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(public url: string) {
		// Simulate connection
		setTimeout(() => {
			this.readyState = MockWebSocket.OPEN;
			this.onopen?.(new Event("open"));
		}, 10);
	}

	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.(new CloseEvent("close"));
	});

	// Helper to simulate incoming messages
	simulateMessage(data: unknown) {
		this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
	}

	// Helper to simulate error
	simulateError() {
		this.onerror?.(new Event("error"));
	}

	// Helper to simulate close
	simulateClose(code = 1000, reason = "") {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.(new CloseEvent("close", { code, reason }));
	}
}

let mockWebSocketInstance: MockWebSocket | null = null;

vi.stubGlobal(
	"WebSocket",
	class extends MockWebSocket {
		constructor(url: string) {
			super(url);
			mockWebSocketInstance = this;
		}
	},
);

describe("useSessionStream", () => {
	const mockLineageData = {
		nodes: [
			{ id: "node-1", label: "Session", type: "session" },
			{ id: "node-2", label: "Thought 1", type: "thought" },
		],
		links: [{ source: "node-1", target: "node-2", type: "TRIGGERS" }],
	};

	const mockReplayData = {
		timeline: [
			{ id: "event-1", type: "thought", content: "First thought" },
			{ id: "event-2", type: "action", content: "First action" },
		],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		mockWebSocketInstance = null;

		// Default fetch mock
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/api/lineage/")) {
				return Promise.resolve({
					json: () => Promise.resolve({ data: mockLineageData }),
				});
			}
			if (url.includes("/api/replay/")) {
				return Promise.resolve({
					json: () => Promise.resolve({ data: mockReplayData }),
				});
			}
			return Promise.reject(new Error("Unknown URL"));
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should initialize with null data and not connected", () => {
		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		expect(result.current.lineage).toBeNull();
		expect(result.current.replay).toBeNull();
		expect(result.current.isConnected).toBe(false);
		expect(result.current.error).toBeNull();
	});

	it("should fetch initial data via REST API", async () => {
		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		// Wait for initial fetch
		await act(async () => {
			await vi.runAllTimersAsync();
		});

		await waitFor(() => {
			expect(result.current.lineage).toEqual(mockLineageData);
			expect(result.current.replay).toEqual(mockReplayData);
		});

		expect(mockFetch).toHaveBeenCalledWith("/api/lineage/test-session-123");
		expect(mockFetch).toHaveBeenCalledWith("/api/replay/test-session-123");
	});

	it("should construct correct WebSocket URL", async () => {
		// Mock window.location
		Object.defineProperty(window, "location", {
			value: {
				protocol: "http:",
				host: "localhost:5000",
			},
			writable: true,
		});

		renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		expect(mockWebSocketInstance?.url).toBe("ws://localhost:5000/api/ws/session/test-session-123");
	});

	it("should set isConnected to true when WebSocket connects", async () => {
		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		await waitFor(() => {
			expect(result.current.isConnected).toBe(true);
		});
	});

	it("should send subscribe message when WebSocket connects", async () => {
		renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		expect(mockWebSocketInstance?.send).toHaveBeenCalledWith(
			JSON.stringify({ type: "subscribe", sessionId: "test-session-123" }),
		);
	});

	it("should update lineage data when receiving lineage message", async () => {
		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		const newLineageData = {
			nodes: [{ id: "new-node", label: "New Node", type: "thought" }],
			links: [],
		};

		act(() => {
			mockWebSocketInstance?.simulateMessage({
				type: "lineage",
				data: newLineageData,
			});
		});

		await waitFor(() => {
			expect(result.current.lineage).toEqual(newLineageData);
		});
	});

	it("should update replay data when receiving replay message", async () => {
		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		const newReplayData = {
			timeline: [{ id: "new-event", type: "action", content: "New action" }],
		};

		act(() => {
			mockWebSocketInstance?.simulateMessage({
				type: "replay",
				data: newReplayData,
			});
		});

		await waitFor(() => {
			expect(result.current.replay).toEqual(newReplayData);
		});
	});

	it("should handle combined update messages", async () => {
		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		const combinedUpdate = {
			lineage: { nodes: [{ id: "n1" }], links: [] },
			replay: { timeline: [{ id: "e1" }] },
		};

		act(() => {
			mockWebSocketInstance?.simulateMessage({
				type: "update",
				...combinedUpdate,
			});
		});

		await waitFor(() => {
			expect(result.current.lineage).toEqual(combinedUpdate.lineage);
			expect(result.current.replay).toEqual(combinedUpdate.replay);
		});
	});

	it("should call onLineageUpdate callback when lineage updates", async () => {
		const onLineageUpdate = vi.fn();

		renderHook(() =>
			useSessionStream({
				sessionId: "test-session-123",
				onLineageUpdate,
			}),
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		const newData = { nodes: [], links: [] };

		act(() => {
			mockWebSocketInstance?.simulateMessage({
				type: "lineage",
				data: newData,
			});
		});

		await waitFor(() => {
			expect(onLineageUpdate).toHaveBeenCalledWith(newData);
		});
	});

	it("should call onReplayUpdate callback when replay updates", async () => {
		const onReplayUpdate = vi.fn();

		renderHook(() =>
			useSessionStream({
				sessionId: "test-session-123",
				onReplayUpdate,
			}),
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		const newData = { timeline: [] };

		act(() => {
			mockWebSocketInstance?.simulateMessage({
				type: "replay",
				data: newData,
			});
		});

		await waitFor(() => {
			expect(onReplayUpdate).toHaveBeenCalledWith(newData);
		});
	});

	it("should handle WebSocket error messages", async () => {
		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		act(() => {
			mockWebSocketInstance?.simulateMessage({
				type: "error",
				message: "Session not found",
			});
		});

		await waitFor(() => {
			expect(result.current.error).toBe("Session not found");
		});
	});

	it("should set isConnected to false when WebSocket closes", async () => {
		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		expect(result.current.isConnected).toBe(true);

		act(() => {
			mockWebSocketInstance?.simulateClose();
		});

		await waitFor(() => {
			expect(result.current.isConnected).toBe(false);
		});
	});

	it("should fall back to polling after WebSocket failure timeout", async () => {
		// Clear fetch mock calls
		mockFetch.mockClear();

		renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		// Initial fetch happens immediately
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});

		// Simulate WebSocket not connecting
		if (mockWebSocketInstance) {
			mockWebSocketInstance.readyState = MockWebSocket.CONNECTING;
		}

		// Wait for fallback timeout (3 seconds)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3100);
		});

		// Should start polling (initial fetch + at least one poll)
		expect(mockFetch.mock.calls.length).toBeGreaterThan(2);
	});

	it("should provide refresh function that re-fetches data", async () => {
		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.runAllTimersAsync();
		});

		// Clear mock calls after initial fetch
		mockFetch.mockClear();

		// Call refresh
		await act(async () => {
			await result.current.refresh();
		});

		expect(mockFetch).toHaveBeenCalledWith("/api/lineage/test-session-123");
		expect(mockFetch).toHaveBeenCalledWith("/api/replay/test-session-123");
	});

	it("should handle fetch errors gracefully", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.runAllTimersAsync();
		});

		await waitFor(() => {
			expect(result.current.error).toBe("Network error");
		});
	});

	it("should clean up on unmount", async () => {
		const { unmount } = renderHook(() => useSessionStream({ sessionId: "test-session-123" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		const wsInstance = mockWebSocketInstance;

		unmount();

		expect(wsInstance?.close).toHaveBeenCalled();
	});

	it("should reconnect with new sessionId", async () => {
		const { result, rerender } = renderHook(({ sessionId }) => useSessionStream({ sessionId }), {
			initialProps: { sessionId: "session-1" },
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		expect(mockWebSocketInstance?.url).toContain("session-1");

		// Change sessionId
		rerender({ sessionId: "session-2" });

		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

		// New WebSocket should be created with new sessionId
		expect(mockWebSocketInstance?.url).toContain("session-2");
	});
});
