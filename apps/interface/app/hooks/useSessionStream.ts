"use client";

import type { LineageResponse, ReplayResponse } from "@lib/types";
import { useCallback, useEffect, useRef, useState } from "react";

interface SessionStreamState {
	lineage: LineageResponse | null;
	replay: ReplayResponse | null;
	isConnected: boolean;
	error: string | null;
}

interface UseSessionStreamOptions {
	sessionId: string;
	onLineageUpdate?: (data: LineageResponse) => void;
	onReplayUpdate?: (data: ReplayResponse) => void;
}

/**
 * Custom hook for real-time session data streaming
 * Uses WebSocket when available, falls back to polling
 */
export function useSessionStream({
	sessionId,
	onLineageUpdate,
	onReplayUpdate,
}: UseSessionStreamOptions) {
	const [state, setState] = useState<SessionStreamState>({
		lineage: null,
		replay: null,
		isConnected: false,
		error: null,
	});

	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectAttempts = useRef(0);
	const maxReconnectAttempts = 5;

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

			if (lineageData) onLineageUpdate?.(lineageData);
			if (replayData) onReplayUpdate?.(replayData);

			return { lineage: lineageData, replay: replayData };
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to fetch session data";
			setState((prev) => ({ ...prev, error: message }));
			return null;
		}
	}, [sessionId, onLineageUpdate, onReplayUpdate]);

	// Start polling fallback
	const startPolling = useCallback(() => {
		if (pollingIntervalRef.current) return;

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

	// Connect to WebSocket
	const connectWebSocket = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) return;

		// Determine WebSocket URL
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/api/ws/session/${sessionId}`;

		try {
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				console.log("[SessionStream] WebSocket connected");
				setState((prev) => ({ ...prev, isConnected: true, error: null }));
				reconnectAttempts.current = 0;
				stopPolling();

				// Subscribe to session updates
				ws.send(
					JSON.stringify({
						type: "subscribe",
						sessionId,
					}),
				);
			};

			ws.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data);

					switch (message.type) {
						case "lineage":
							setState((prev) => ({ ...prev, lineage: message.data }));
							onLineageUpdate?.(message.data);
							break;

						case "replay":
							setState((prev) => ({ ...prev, replay: message.data }));
							onReplayUpdate?.(message.data);
							break;

						case "update":
							// Real-time incremental update from Redis Pub/Sub
							// For now, request a full refresh to get latest data
							// This could be optimized to do incremental updates client-side
							if (message.data?.type === "node_created") {
								// New node was created - request full refresh
								ws.send(JSON.stringify({ type: "refresh" }));
							} else if (message.lineage) {
								// Legacy combined update format
								setState((prev) => ({ ...prev, lineage: message.lineage }));
								onLineageUpdate?.(message.lineage);
							}
							if (message.replay) {
								setState((prev) => ({ ...prev, replay: message.replay }));
								onReplayUpdate?.(message.replay);
							}
							break;

						case "error":
							setState((prev) => ({ ...prev, error: message.message }));
							break;

						default:
							console.log("[SessionStream] Unknown message type:", message.type);
					}
				} catch (err) {
					console.error("[SessionStream] Failed to parse message:", err);
				}
			};

			ws.onclose = (event) => {
				console.log("[SessionStream] WebSocket closed:", event.code, event.reason);
				setState((prev) => ({ ...prev, isConnected: false }));
				wsRef.current = null;

				// Attempt reconnection
				if (reconnectAttempts.current < maxReconnectAttempts) {
					const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
					reconnectAttempts.current++;

					console.log(
						`[SessionStream] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`,
					);
					reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
				} else {
					console.log("[SessionStream] Max reconnect attempts reached, falling back to polling");
					startPolling();
				}
			};

			ws.onerror = () => {
				console.error("[SessionStream] WebSocket connection error");
				// Don't set error state here, let onclose handle reconnection
			};
		} catch (err) {
			console.error("[SessionStream] Failed to create WebSocket:", err);
			// Fall back to polling
			startPolling();
		}
	}, [sessionId, onLineageUpdate, onReplayUpdate, startPolling, stopPolling]);

	// Disconnect WebSocket
	const disconnect = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}

		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}

		stopPolling();
	}, [stopPolling]);

	// Effect to manage connection lifecycle
	useEffect(() => {
		// Initial data fetch
		fetchData();

		// Try WebSocket first, fall back to polling if it fails
		// Check if WebSocket endpoint exists by trying to connect
		connectWebSocket();

		// If WebSocket doesn't connect within 3 seconds, start polling
		const fallbackTimeout = setTimeout(() => {
			if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
				console.log("[SessionStream] WebSocket not available, using polling");
				startPolling();
			}
		}, 3000);

		return () => {
			clearTimeout(fallbackTimeout);
			disconnect();
		};
	}, [sessionId]); // Only re-run if sessionId changes

	// Manual refresh function
	const refresh = useCallback(() => {
		return fetchData();
	}, [fetchData]);

	return {
		...state,
		refresh,
		disconnect,
	};
}
