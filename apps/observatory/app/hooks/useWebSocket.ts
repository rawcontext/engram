"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * WebSocket connection status
 */
export type WebSocketStatus = "connecting" | "open" | "closed" | "error";

/**
 * Configuration options for the useWebSocket hook
 */
export interface UseWebSocketOptions<T = unknown> {
	/**
	 * WebSocket URL to connect to. If null, no connection will be made.
	 * Can be a full URL or a path (will be converted to ws:// or wss://)
	 */
	url: string | null;

	/**
	 * Callback invoked when a message is received.
	 * The data is automatically parsed as JSON if possible.
	 */
	onMessage: (data: T) => void;

	/**
	 * Optional callback invoked when connection opens.
	 * Receives the WebSocket instance for sending initial messages (e.g., subscribe).
	 */
	onOpen?: (ws: WebSocket) => void;

	/**
	 * Optional callback invoked on connection close
	 */
	onClose?: (event: CloseEvent) => void;

	/**
	 * Optional callback invoked on connection error
	 */
	onError?: (event: Event) => void;

	/**
	 * Whether to automatically reconnect on close. Default: true
	 */
	reconnect?: boolean;

	/**
	 * Maximum number of reconnection attempts. Default: 5
	 */
	maxReconnectAttempts?: number;

	/**
	 * Maximum reconnection delay in ms (exponential backoff caps at this). Default: 30000
	 */
	maxReconnectDelay?: number;

	/**
	 * Base delay for exponential backoff calculation. Default: 1000
	 */
	baseReconnectDelay?: number;
}

/**
 * Return type for the useWebSocket hook
 */
export interface UseWebSocketReturn {
	/**
	 * Current connection status
	 */
	status: WebSocketStatus;

	/**
	 * Whether the WebSocket is currently connected
	 */
	isConnected: boolean;

	/**
	 * Send a message through the WebSocket. Automatically stringifies objects.
	 */
	send: (data: string | object) => void;

	/**
	 * Manually close the connection (disables auto-reconnect)
	 */
	close: () => void;

	/**
	 * Manually trigger a reconnection (resets attempt counter)
	 */
	reconnect: () => void;

	/**
	 * Current reconnection attempt number (0 when connected)
	 */
	reconnectAttempt: number;
}

/**
 * Constructs a WebSocket URL from a path, using the current page's protocol/host
 */
function buildWebSocketUrl(urlOrPath: string): string {
	// If already a full URL, return as-is
	if (urlOrPath.startsWith("ws://") || urlOrPath.startsWith("wss://")) {
		return urlOrPath;
	}

	// Build from current location
	const protocol =
		typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
	const host = typeof window !== "undefined" ? window.location.host : "localhost";

	// Ensure path starts with /
	const path = urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;

	return `${protocol}//${host}${path}`;
}

/**
 * A reusable WebSocket hook with automatic reconnection and exponential backoff.
 *
 * Features:
 * - Automatic JSON parsing of incoming messages
 * - Exponential backoff reconnection with configurable limits
 * - Manual send/close/reconnect controls
 * - TypeScript generics for message typing
 *
 * @example
 * ```tsx
 * const { status, send, isConnected } = useWebSocket<MyMessage>({
 *   url: '/api/ws/my-endpoint',
 *   onMessage: (data) => console.log('Received:', data),
 *   onOpen: (ws) => ws.send(JSON.stringify({ type: 'subscribe' })),
 * });
 * ```
 */
export function useWebSocket<T = unknown>(options: UseWebSocketOptions<T>): UseWebSocketReturn {
	const {
		url,
		onMessage,
		onOpen,
		onClose,
		onError,
		reconnect: shouldReconnect = true,
		maxReconnectAttempts = 5,
		maxReconnectDelay = 30000,
		baseReconnectDelay = 1000,
	} = options;

	const [status, setStatus] = useState<WebSocketStatus>("closed");
	const [reconnectAttempt, setReconnectAttempt] = useState(0);

	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectAttemptsRef = useRef(0);
	const manualCloseRef = useRef(false);

	// Store callbacks in refs to avoid reconnection on callback changes
	const onMessageRef = useRef(onMessage);
	const onOpenRef = useRef(onOpen);
	const onCloseRef = useRef(onClose);
	const onErrorRef = useRef(onError);

	useEffect(() => {
		onMessageRef.current = onMessage;
	}, [onMessage]);

	useEffect(() => {
		onOpenRef.current = onOpen;
	}, [onOpen]);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		onErrorRef.current = onError;
	}, [onError]);

	const clearReconnectTimeout = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}
	}, []);

	const connect = useCallback(() => {
		if (!url) {
			setStatus("closed");
			return;
		}

		// Don't create duplicate connections
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			return;
		}

		// Close existing connection if any
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}

		const wsUrl = buildWebSocketUrl(url);

		try {
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;
			setStatus("connecting");

			ws.onopen = () => {
				setStatus("open");
				reconnectAttemptsRef.current = 0;
				setReconnectAttempt(0);
				manualCloseRef.current = false;
				onOpenRef.current?.(ws);
			};

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data) as T;
					onMessageRef.current(data);
				} catch {
					// If not JSON, pass raw data
					onMessageRef.current(event.data as T);
				}
			};

			ws.onerror = (event) => {
				setStatus("error");
				onErrorRef.current?.(event);
			};

			ws.onclose = (event) => {
				setStatus("closed");
				wsRef.current = null;
				onCloseRef.current?.(event);

				// Auto-reconnect logic (unless manually closed)
				if (
					!manualCloseRef.current &&
					shouldReconnect &&
					reconnectAttemptsRef.current < maxReconnectAttempts
				) {
					const delay = Math.min(
						baseReconnectDelay * 2 ** reconnectAttemptsRef.current,
						maxReconnectDelay,
					);
					reconnectAttemptsRef.current++;
					setReconnectAttempt(reconnectAttemptsRef.current);

					reconnectTimeoutRef.current = setTimeout(connect, delay);
				}
			};
		} catch {
			setStatus("error");
		}
	}, [url, shouldReconnect, maxReconnectAttempts, maxReconnectDelay, baseReconnectDelay]);

	const send = useCallback((data: string | object) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			const message = typeof data === "string" ? data : JSON.stringify(data);
			wsRef.current.send(message);
		}
	}, []);

	const close = useCallback(() => {
		manualCloseRef.current = true;
		clearReconnectTimeout();
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
		setStatus("closed");
	}, [clearReconnectTimeout]);

	const manualReconnect = useCallback(() => {
		manualCloseRef.current = false;
		clearReconnectTimeout();
		reconnectAttemptsRef.current = 0;
		setReconnectAttempt(0);
		connect();
	}, [clearReconnectTimeout, connect]);

	// Connect on mount, disconnect on unmount
	useEffect(() => {
		connect();

		return () => {
			clearReconnectTimeout();
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
		};
	}, [connect, clearReconnectTimeout]);

	return {
		status,
		isConnected: status === "open",
		send,
		close,
		reconnect: manualReconnect,
		reconnectAttempt,
	};
}
