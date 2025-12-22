import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsumerStatusResponse } from "../api/consumers/route";

export interface UseConsumerStatusOptions {
	/** Whether to enable the WebSocket connection (default: true) */
	enabled?: boolean;
}

export interface UseConsumerStatusResult {
	/** Response from the consumer status stream */
	data: ConsumerStatusResponse | null;
	/** Whether we're connected to the WebSocket */
	isConnected: boolean;
	/** Error message if connection failed */
	error: string | null;
	/** Force a refresh of the status */
	refresh: () => void;
}

/**
 * Hook to stream NATS consumer group status via WebSocket.
 *
 * @example
 * ```tsx
 * const { data, isConnected, error } = useConsumerStatus();
 *
 * if (data?.allReady) {
 *   return <StatusIndicator status="online" label="All Consumers Ready" />;
 * }
 * ```
 */
export function useConsumerStatus(options: UseConsumerStatusOptions = {}): UseConsumerStatusResult {
	const { enabled = true } = options;

	const [data, setData] = useState<ConsumerStatusResponse | null>(null);
	const [isConnected, setIsConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const connect = useCallback(() => {
		if (!enabled || typeof window === "undefined") return;

		// Build WebSocket URL
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/api/ws/consumers`;

		try {
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				console.log("[useConsumerStatus] WebSocket connected");
				setIsConnected(true);
				setError(null);
			};

			ws.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data);
					if (message.type === "status" && message.data) {
						setData(message.data);
					}
				} catch (e) {
					console.error("[useConsumerStatus] Failed to parse message:", e);
				}
			};

			ws.onerror = (event) => {
				console.error("[useConsumerStatus] WebSocket error:", event);
				setError("WebSocket connection error");
			};

			ws.onclose = (event) => {
				console.log("[useConsumerStatus] WebSocket closed:", event.code, event.reason);
				setIsConnected(false);
				wsRef.current = null;

				// Reconnect after 5 seconds if not a clean close
				if (enabled && event.code !== 1000) {
					reconnectTimeoutRef.current = setTimeout(() => {
						console.log("[useConsumerStatus] Attempting to reconnect...");
						connect();
					}, 5000);
				}
			};
		} catch (e) {
			console.error("[useConsumerStatus] Failed to create WebSocket:", e);
			setError("Failed to connect to consumer status stream");
		}
	}, [enabled]);

	const disconnect = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}
		if (wsRef.current) {
			wsRef.current.close(1000, "Component unmounting");
			wsRef.current = null;
		}
	}, []);

	const refresh = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "refresh" }));
		}
	}, []);

	// Connect on mount, disconnect on unmount
	useEffect(() => {
		if (enabled) {
			connect();
		}

		return () => {
			disconnect();
		};
	}, [enabled, connect, disconnect]);

	return {
		data,
		isConnected,
		error,
		refresh,
	};
}
