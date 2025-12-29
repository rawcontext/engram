"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type StreamingStatus = "connecting" | "live" | "degraded" | "stale" | "offline";

export interface StreamingState<T> {
	/** Current data */
	data: T | null;
	/** Streaming connection status */
	status: StreamingStatus;
	/** Whether we're receiving live updates */
	isLive: boolean;
	/** Last time data was received */
	lastUpdate: Date | null;
	/** Seconds since last update */
	staleness: number;
	/** Number of reconnection attempts */
	reconnectAttempts: number;
	/** Manually trigger a refresh */
	refresh: () => Promise<void>;
	/** Force reconnect to stream */
	reconnect: () => void;
}

export interface UseStreamingDataOptions<T> {
	/** WebSocket URL for streaming (optional - falls back to polling if not provided) */
	wsUrl?: string;
	/** Polling fallback function */
	fetchData: () => Promise<T>;
	/** Polling interval in ms (used as fallback or primary if no wsUrl) */
	pollInterval?: number;
	/** Threshold in seconds before data is considered stale */
	staleThreshold?: number;
	/** Threshold in seconds before data is considered degraded */
	degradedThreshold?: number;
	/** Called when new data arrives */
	onData?: (data: T) => void;
	/** Called on connection status change */
	onStatusChange?: (status: StreamingStatus) => void;
	/** Enable streaming (can be toggled) */
	enabled?: boolean;
}

/**
 * Hook for streaming data with automatic fallback to polling.
 * Provides real-time status indicators and staleness tracking.
 */
export function useStreamingData<T>(options: UseStreamingDataOptions<T>): StreamingState<T> {
	const {
		wsUrl,
		fetchData,
		pollInterval = 5000,
		staleThreshold = 30,
		degradedThreshold = 15,
		onData,
		onStatusChange,
		enabled = true,
	} = options;

	const [data, setData] = useState<T | null>(null);
	const [status, setStatus] = useState<StreamingStatus>("connecting");
	const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
	const [staleness, setStaleness] = useState(0);
	const [reconnectAttempts, setReconnectAttempts] = useState(0);

	const wsRef = useRef<WebSocket | null>(null);
	const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const stalenessIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const mountedRef = useRef(true);

	// Update status and notify
	const updateStatus = useCallback(
		(newStatus: StreamingStatus) => {
			setStatus(newStatus);
			onStatusChange?.(newStatus);
		},
		[onStatusChange],
	);

	// Handle incoming data
	const handleData = useCallback(
		(newData: T) => {
			if (!mountedRef.current) return;
			setData(newData);
			setLastUpdate(new Date());
			setStaleness(0);
			onData?.(newData);

			// If we were stale/degraded, we're now live
			if (status === "stale" || status === "degraded" || status === "connecting") {
				updateStatus("live");
			}
		},
		[status, onData, updateStatus],
	);

	// Fetch data via polling
	const refresh = useCallback(async () => {
		try {
			const newData = await fetchData();
			handleData(newData);
		} catch (error) {
			console.error("Failed to fetch data:", error);
			if (status === "live") {
				updateStatus("degraded");
			}
		}
	}, [fetchData, handleData, status, updateStatus]);

	// WebSocket connection
	const connectWebSocket = useCallback(() => {
		if (!wsUrl || !enabled) return;

		// Build WebSocket URL
		const protocol =
			typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
		const host = typeof window !== "undefined" ? window.location.host : "localhost";
		const fullUrl = wsUrl.startsWith("ws") ? wsUrl : `${protocol}//${host}${wsUrl}`;

		try {
			const ws = new WebSocket(fullUrl);
			wsRef.current = ws;
			updateStatus("connecting");

			ws.onopen = () => {
				setReconnectAttempts(0);
				updateStatus("live");
			};

			ws.onmessage = (event) => {
				try {
					const parsed = JSON.parse(event.data) as T;
					handleData(parsed);
				} catch {
					// If not JSON, try to use as-is
					handleData(event.data as T);
				}
			};

			ws.onerror = () => {
				updateStatus("degraded");
			};

			ws.onclose = (event) => {
				wsRef.current = null;

				// Don't reconnect on clean close
				if (event.code === 1000) {
					updateStatus("offline");
					return;
				}

				// Attempt reconnection with backoff
				const attempt = reconnectAttempts + 1;
				setReconnectAttempts(attempt);

				if (attempt <= 5) {
					const delay = Math.min(1000 * 2 ** attempt, 30000);
					updateStatus("degraded");
					reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
				} else {
					updateStatus("offline");
				}
			};
		} catch {
			updateStatus("offline");
		}
	}, [wsUrl, enabled, handleData, updateStatus, reconnectAttempts]);

	// Manual reconnect
	const reconnect = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
		}
		if (wsRef.current) {
			wsRef.current.close();
		}
		setReconnectAttempts(0);
		connectWebSocket();
	}, [connectWebSocket]);

	// Staleness tracking
	useEffect(() => {
		stalenessIntervalRef.current = setInterval(() => {
			if (lastUpdate) {
				const seconds = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
				setStaleness(seconds);

				// Update status based on staleness
				if (seconds >= staleThreshold && status !== "stale" && status !== "offline") {
					updateStatus("stale");
				} else if (seconds >= degradedThreshold && seconds < staleThreshold && status === "live") {
					updateStatus("degraded");
				}
			}
		}, 1000);

		return () => {
			if (stalenessIntervalRef.current) {
				clearInterval(stalenessIntervalRef.current);
			}
		};
	}, [lastUpdate, staleThreshold, degradedThreshold, status, updateStatus]);

	// Main effect: connect WebSocket or start polling
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally omitting callback deps to prevent reconnection loops
	useEffect(() => {
		mountedRef.current = true;

		if (!enabled) {
			updateStatus("offline");
			return;
		}

		// Initial fetch
		refresh();

		if (wsUrl) {
			// Use WebSocket with polling fallback
			connectWebSocket();

			// Still poll as backup, but less frequently
			pollIntervalRef.current = setInterval(refresh, pollInterval * 2);
		} else {
			// Polling only mode
			updateStatus("live");
			pollIntervalRef.current = setInterval(refresh, pollInterval);
		}

		return () => {
			mountedRef.current = false;
			if (wsRef.current) {
				wsRef.current.close(1000);
			}
			if (pollIntervalRef.current) {
				clearInterval(pollIntervalRef.current);
			}
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
		};
	}, [enabled, wsUrl, pollInterval]);

	return {
		data,
		status,
		isLive: status === "live",
		lastUpdate,
		staleness,
		reconnectAttempts,
		refresh,
		reconnect,
	};
}

/**
 * Simplified hook for components that just need polling with status tracking.
 * Automatically shows live/stale status based on poll success.
 */
export function usePollingData<T>(
	fetchData: () => Promise<T>,
	options: {
		pollInterval?: number;
		staleThreshold?: number;
		enabled?: boolean;
	} = {},
): StreamingState<T> {
	return useStreamingData({
		fetchData,
		pollInterval: options.pollInterval ?? 5000,
		staleThreshold: options.staleThreshold ?? 30,
		enabled: options.enabled ?? true,
	});
}
