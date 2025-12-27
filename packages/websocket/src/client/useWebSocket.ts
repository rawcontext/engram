"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseWebSocketOptions, UseWebSocketReturn, WebSocketStatus } from "./types";

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
 * - Heartbeat/ping-pong for connection health monitoring
 * - Offline message queueing with automatic flush on reconnect
 * - Page Visibility API integration (reconnect when tab becomes visible)
 *
 * @example
 * ```tsx
 * const { status, send, isConnected } = useWebSocket<MyMessage>({
 *   url: '/api/ws/my-endpoint',
 *   onMessage: (data) => console.log('Received:', data),
 *   onOpen: (ws) => ws.send(JSON.stringify({ type: 'subscribe' })),
 *   heartbeat: { interval: 30000, timeout: 5000 },
 *   queueOfflineMessages: true,
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
