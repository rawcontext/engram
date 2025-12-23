import { useEffect, useRef, useState } from "react";
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
	// Unique connection ID to track which connection callbacks belong to
	const connectionIdRef = useRef(0);

	const refresh = () => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "refresh" }));
		}
	};

	// Connect on mount, disconnect on unmount
	useEffect(() => {
		if (!enabled || typeof window === "undefined") return;

		// Increment connection ID - this invalidates callbacks from previous connections
		const thisConnectionId = ++connectionIdRef.current;

		// Helper to check if this connection is still valid
		const isValidConnection = () => connectionIdRef.current === thisConnectionId;

		// Build WebSocket URL
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/api/ws/consumers`;

		let ws: WebSocket;
		try {
			ws = new WebSocket(wsUrl);
			wsRef.current = ws;
		} catch (e) {
			console.error("[useConsumerStatus] Failed to create WebSocket:", e);
			setError("Failed to connect to consumer status stream");
			return;
		}

		ws.onopen = () => {
			if (!isValidConnection()) {
				ws.close(1000, "Stale connection");
				return;
			}
			console.log("[useConsumerStatus] WebSocket connected");
			setIsConnected(true);
			setError(null);
		};

		ws.onmessage = (event) => {
			if (!isValidConnection()) return;
			try {
				const message = JSON.parse(event.data);
				if (message.type === "status" && message.data) {
					setData(message.data);
				}
			} catch (e) {
				console.error("[useConsumerStatus] Failed to parse message:", e);
			}
		};

		ws.onerror = () => {
			// Only log/set error if this is still the active connection
			if (!isValidConnection()) return;
			console.error("[useConsumerStatus] WebSocket error connecting to", wsUrl);
			setError(
				`WebSocket connection failed - ensure custom server is running (not next dev directly)`,
			);
		};

		ws.onclose = (event) => {
			if (!isValidConnection()) return;

			console.log("[useConsumerStatus] WebSocket closed:", event.code, event.reason);
			setIsConnected(false);
			wsRef.current = null;

			// Reconnect after 5 seconds if not a clean close
			if (event.code !== 1000) {
				reconnectTimeoutRef.current = setTimeout(() => {
					// Connection ID will have changed, so this won't reconnect
					// The next effect run will create a new connection if still enabled
				}, 5000);
			}
		};

		// Cleanup function
		return () => {
			// Invalidate this connection's callbacks by letting the next effect increment the ID
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
				ws.close(1000, "Component unmounting");
			}
			wsRef.current = null;
		};
	}, [enabled]);

	return {
		data,
		isConnected,
		error,
		refresh,
	};
}
