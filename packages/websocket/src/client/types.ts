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
