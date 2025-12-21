"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * WebSocket connection status
 */
export type WebSocketStatus = "connecting" | "open" | "closed" | "error";

/**
 * Heartbeat/ping-pong options for connection health monitoring
 */
export interface HeartbeatOptions {
	/**
	 * Message to send as ping. Default: "ping"
	 */
	message?: string;

	/**
	 * Expected pong response message. Default: "pong"
	 */
	returnMessage?: string;

	/**
	 * Interval between heartbeat pings in ms. Default: 30000 (30s)
	 */
	interval?: number;

	/**
	 * Timeout to wait for pong before forcing reconnect in ms. Default: 5000 (5s)
	 */
	timeout?: number;
}

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

	/**
	 * Enable heartbeat/ping-pong to detect stale connections. Default: disabled
	 */
	heartbeat?: HeartbeatOptions;

	/**
	 * Queue messages sent while disconnected and flush on reconnect. Default: false
	 */
	queueOfflineMessages?: boolean;

	/**
	 * Maximum number of messages to queue while offline. Default: 100
	 */
	maxQueueSize?: number;

	/**
	 * Maximum age of queued messages in ms before discarding. Default: 30000 (30s)
	 */
	maxQueueAge?: number;
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

	/**
	 * Last close code received (1000 = normal, etc.)
	 */
	lastCloseCode: number | null;

	/**
	 * Last close reason string
	 */
	lastCloseReason: string;

	/**
	 * Number of messages currently queued (0 if queueing disabled)
	 */
	queuedMessageCount: number;

	/**
	 * Clear all queued messages
	 */
	clearQueue: () => void;
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
		heartbeat,
		queueOfflineMessages = false,
		maxQueueSize = 100,
		maxQueueAge = 30000,
	} = options;

	const [status, setStatus] = useState<WebSocketStatus>("closed");
	const [reconnectAttempt, setReconnectAttempt] = useState(0);
	const [lastCloseCode, setLastCloseCode] = useState<number | null>(null);
	const [lastCloseReason, setLastCloseReason] = useState("");
	const [queuedMessageCount, setQueuedMessageCount] = useState(0);

	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectAttemptsRef = useRef(0);
	const manualCloseRef = useRef(false);
	const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastPongRef = useRef<number>(Date.now());
	const messageQueueRef = useRef<Array<{ message: string; timestamp: number }>>([]);

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

	const clearHeartbeatTimers = useCallback(() => {
		if (heartbeatIntervalRef.current) {
			clearInterval(heartbeatIntervalRef.current);
			heartbeatIntervalRef.current = null;
		}
		if (heartbeatTimeoutRef.current) {
			clearTimeout(heartbeatTimeoutRef.current);
			heartbeatTimeoutRef.current = null;
		}
	}, []);

	const startHeartbeat = useCallback(() => {
		if (!heartbeat || !wsRef.current) return;

		const pingMessage = heartbeat.message ?? "ping";
		const interval = heartbeat.interval ?? 30000;
		const timeout = heartbeat.timeout ?? 5000;

		clearHeartbeatTimers();
		lastPongRef.current = Date.now();

		heartbeatIntervalRef.current = setInterval(() => {
			if (wsRef.current?.readyState === WebSocket.OPEN) {
				// Check if we received a pong within timeout window
				const timeSinceLastPong = Date.now() - lastPongRef.current;
				if (timeSinceLastPong > timeout + interval) {
					// No pong received, force reconnect
					clearHeartbeatTimers();
					if (wsRef.current) {
						wsRef.current.close();
					}
					return;
				}

				// Send ping
				wsRef.current.send(pingMessage);

				// Set timeout to expect pong
				if (heartbeatTimeoutRef.current) {
					clearTimeout(heartbeatTimeoutRef.current);
				}
			}
		}, interval);
	}, [heartbeat, clearHeartbeatTimers]);

	const clearQueue = useCallback(() => {
		messageQueueRef.current = [];
		setQueuedMessageCount(0);
	}, []);

	const flushMessageQueue = useCallback(() => {
		if (!queueOfflineMessages || messageQueueRef.current.length === 0) return;

		const now = Date.now();
		const validMessages = messageQueueRef.current.filter(
			(item) => now - item.timestamp <= maxQueueAge,
		);

		validMessages.forEach((item) => {
			if (wsRef.current?.readyState === WebSocket.OPEN) {
				wsRef.current.send(item.message);
			}
		});

		clearQueue();
	}, [queueOfflineMessages, maxQueueAge, clearQueue]);

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
				startHeartbeat();
				flushMessageQueue();
				onOpenRef.current?.(ws);
			};

			ws.onmessage = (event) => {
				// Check for heartbeat pong response
				if (heartbeat) {
					const pongMessage = heartbeat.returnMessage ?? "pong";
					if (event.data === pongMessage) {
						lastPongRef.current = Date.now();
						return;
					}
				}

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
				clearHeartbeatTimers();
				setLastCloseCode(event.code);
				setLastCloseReason(event.reason);
				onCloseRef.current?.(event);

				// Check if we should reconnect based on close code
				const shouldNotReconnect =
					event.code === 1000 || // Normal closure
					event.code === 1002 || // Protocol error
					event.code === 1003; // Unsupported data

				// Auto-reconnect logic (unless manually closed or specific close codes)
				if (
					!manualCloseRef.current &&
					!shouldNotReconnect &&
					shouldReconnect &&
					reconnectAttemptsRef.current < maxReconnectAttempts
				) {
					const jitter = Math.random() * 1000;
					const delay = Math.min(
						baseReconnectDelay * 2 ** reconnectAttemptsRef.current + jitter,
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
	}, [
		url,
		shouldReconnect,
		maxReconnectAttempts,
		maxReconnectDelay,
		baseReconnectDelay,
		heartbeat,
		startHeartbeat,
		flushMessageQueue,
		clearHeartbeatTimers,
	]);

	const send = useCallback(
		(data: string | object) => {
			const message = typeof data === "string" ? data : JSON.stringify(data);

			if (wsRef.current?.readyState === WebSocket.OPEN) {
				wsRef.current.send(message);
			} else if (queueOfflineMessages) {
				// Queue message if disconnected
				if (messageQueueRef.current.length >= maxQueueSize) {
					// Remove oldest message if queue is full
					messageQueueRef.current.shift();
				}
				messageQueueRef.current.push({
					message,
					timestamp: Date.now(),
				});
				setQueuedMessageCount(messageQueueRef.current.length);
			}
		},
		[queueOfflineMessages, maxQueueSize],
	);

	const close = useCallback(() => {
		manualCloseRef.current = true;
		clearReconnectTimeout();
		clearHeartbeatTimers();
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
		setStatus("closed");
	}, [clearReconnectTimeout, clearHeartbeatTimers]);

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
			clearHeartbeatTimers();
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
		};
	}, [connect, clearReconnectTimeout, clearHeartbeatTimers]);

	// Handle Page Visibility API - reconnect when tab becomes visible
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				// Check if connection is not open
				if (wsRef.current?.readyState !== WebSocket.OPEN) {
					manualReconnect();
				}
			}
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [manualReconnect]);

	return {
		status,
		isConnected: status === "open",
		send,
		close,
		reconnect: manualReconnect,
		reconnectAttempt,
		lastCloseCode,
		lastCloseReason,
		queuedMessageCount,
		clearQueue,
	};
}
