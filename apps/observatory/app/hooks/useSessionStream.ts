"use client";

import type { LineageResponse, ReplayResponse } from "@lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket, type WebSocketStatus } from "./useWebSocket";

interface SessionStreamState {
	lineage: LineageResponse | null;
	replay: ReplayResponse | null;
	error: string | null;
}

interface UseSessionStreamOptions {
	sessionId: string;
	onLineageUpdate?: (data: LineageResponse) => void;
	onReplayUpdate?: (data: ReplayResponse) => void;
}

interface SessionMessage {
	type: "lineage" | "replay" | "update" | "error";
	data?: LineageResponse | ReplayResponse | { type: string };
	lineage?: LineageResponse;
	replay?: ReplayResponse;
	message?: string;
}

/**
 * Custom hook for real-time session data streaming.
 * Uses WebSocket when available, falls back to polling.
 * Built on the shared useWebSocket hook.
 */
export function useSessionStream({
	sessionId,
	onLineageUpdate,
	onReplayUpdate,
}: UseSessionStreamOptions) {
	const [state, setState] = useState<SessionStreamState>({
		lineage: null,
		replay: null,
		error: null,
	});

	const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const wsConnectedRef = useRef(false);
	const fallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Store callbacks in refs to avoid effect re-runs
	const onLineageUpdateRef = useRef(onLineageUpdate);
	const onReplayUpdateRef = useRef(onReplayUpdate);

	useEffect(() => {
		onLineageUpdateRef.current = onLineageUpdate;
	}, [onLineageUpdate]);

	useEffect(() => {
		onReplayUpdateRef.current = onReplayUpdate;
	}, [onReplayUpdate]);

	// Fetch data via REST (used for initial load and polling fallback)
	const fetchData = useCallback(async () => {
		try {
			const [lineageRes, replayRes] = await Promise.all([
				fetch(`/api/lineage/${sessionId}`),
				fetch(`/api/replay/${sessionId}`),
			]);

			const lineageJson = await lineageRes.json();
			const replayJson = await replayRes.json();

			const lineageData = lineageJson.data as LineageResponse;
			const replayData = replayJson.data as ReplayResponse;

			setState((prev) => ({
				...prev,
				lineage: lineageData,
				replay: replayData,
				error: null,
			}));

			if (lineageData) onLineageUpdateRef.current?.(lineageData);
			if (replayData) onReplayUpdateRef.current?.(replayData);

			return { lineage: lineageData, replay: replayData };
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to fetch session data";
			setState((prev) => ({ ...prev, error: message }));
			return null;
		}
	}, [sessionId]);

	// Start polling fallback
	const startPolling = useCallback(() => {
		if (pollingIntervalRef.current) return;

		console.log("[SessionStream] Starting polling fallback");
		// Initial fetch
		fetchData();

		// Poll every 2 seconds
		pollingIntervalRef.current = setInterval(() => {
			fetchData();
		}, 2000);
	}, [fetchData]);

	// Stop polling
	const stopPolling = useCallback(() => {
		if (pollingIntervalRef.current) {
			clearInterval(pollingIntervalRef.current);
			pollingIntervalRef.current = null;
		}
	}, []);

	// WebSocket send function ref (populated by useWebSocket)
	const sendRef = useRef<(data: string | object) => void>(() => {});

	const handleMessage = useCallback((message: SessionMessage) => {
		switch (message.type) {
			case "lineage":
				setState((prev) => ({ ...prev, lineage: message.data as LineageResponse }));
				onLineageUpdateRef.current?.(message.data as LineageResponse);
				break;

			case "replay":
				setState((prev) => ({ ...prev, replay: message.data as ReplayResponse }));
				onReplayUpdateRef.current?.(message.data as ReplayResponse);
				break;

			case "update": {
				// Real-time incremental update from Redis Pub/Sub
				const updateData = message.data as { type: string } | undefined;
				if (updateData?.type === "node_created" || updateData?.type === "graph_node_created") {
					// New node was created - request full refresh
					sendRef.current({ type: "refresh" });
				}
				break;
			}

			case "error":
				setState((prev) => ({ ...prev, error: message.message || "Unknown error" }));
				break;

			default:
				console.log("[SessionStream] Unknown message type:", message.type);
		}
	}, []);

	const handleOpen = useCallback(
		(ws: WebSocket) => {
			console.log("[SessionStream] WebSocket connected");
			wsConnectedRef.current = true;
			setState((prev) => ({ ...prev, error: null }));
			stopPolling();

			// Clear fallback timeout since we connected
			if (fallbackTimeoutRef.current) {
				clearTimeout(fallbackTimeoutRef.current);
				fallbackTimeoutRef.current = null;
			}

			// Subscribe to session updates
			ws.send(
				JSON.stringify({
					type: "subscribe",
					sessionId,
				}),
			);
		},
		[sessionId, stopPolling],
	);

	const handleClose = useCallback(() => {
		console.log("[SessionStream] WebSocket closed");
		wsConnectedRef.current = false;
	}, []);

	const handleError = useCallback(() => {
		console.error("[SessionStream] WebSocket connection error");
	}, []);

	const { status, isConnected, send, close, reconnect, reconnectAttempt } =
		useWebSocket<SessionMessage>({
			url: `/api/ws/session/${sessionId}`,
			onMessage: handleMessage,
			onOpen: handleOpen,
			onClose: handleClose,
			onError: handleError,
			reconnect: true,
			maxReconnectAttempts: 5,
		});

	// Store send in ref for use in handleMessage
	useEffect(() => {
		sendRef.current = send;
	}, [send]);

	// Fall back to polling if max reconnect attempts reached
	useEffect(() => {
		if (!isConnected && reconnectAttempt >= 5) {
			console.log("[SessionStream] Max reconnect attempts reached, falling back to polling");
			startPolling();
		}
	}, [isConnected, reconnectAttempt, startPolling]);

	// Initial data fetch and fallback timeout
	useEffect(() => {
		// Initial data fetch
		fetchData();

		// If WebSocket doesn't connect within 3 seconds, start polling
		fallbackTimeoutRef.current = setTimeout(() => {
			if (!wsConnectedRef.current) {
				console.log("[SessionStream] WebSocket not available, using polling");
				startPolling();
			}
		}, 3000);

		return () => {
			if (fallbackTimeoutRef.current) {
				clearTimeout(fallbackTimeoutRef.current);
			}
			stopPolling();
		};
	}, [fetchData, startPolling, stopPolling]);

	// Manual refresh function
	const refresh = useCallback(() => {
		return fetchData();
	}, [fetchData]);

	// Disconnect handler that also stops polling
	const disconnect = useCallback(() => {
		close();
		stopPolling();
	}, [close, stopPolling]);

	return {
		lineage: state.lineage,
		replay: state.replay,
		isConnected,
		status,
		error: state.error,
		refresh,
		disconnect,
		reconnect,
	};
}

// Re-export WebSocketStatus for consumers
export type { WebSocketStatus };
