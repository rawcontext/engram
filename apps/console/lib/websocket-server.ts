/**
 * WebSocket handlers for Console real-time features
 *
 * Handles:
 * - Log streaming from Docker containers via NATS pub/sub
 * - Metrics updates for dashboard widgets
 */

import { createNatsPubSubSubscriber } from "@engram/storage/nats";
import type { ServerWebSocket } from "bun";

interface WebSocketData {
	type: "logs" | "metrics";
	service?: string;
	unsubscribe?: () => Promise<void>;
	messageHandler?: (message: string | Buffer) => void;
}

type WSConnection = ServerWebSocket<WebSocketData>;

// =============================================================================
// NATS Subjects for Console
// =============================================================================

/**
 * NATS subjects for log streaming.
 * Services publish logs to these subjects.
 */
const LOG_SUBJECTS = {
	/** All logs from all services */
	global: "console.logs.>",
	/** Logs from a specific service */
	service: (name: string) => `console.logs.${name}`,
} as const;

/**
 * NATS subjects for metrics streaming.
 */
const METRICS_SUBJECTS = {
	/** All metrics updates */
	global: "console.metrics.>",
} as const;

// =============================================================================
// Log Entry Types
// =============================================================================

export interface LogEntry {
	/** Timestamp in ISO format */
	timestamp: string;
	/** Log level: debug, info, warn, error */
	level: "debug" | "info" | "warn" | "error";
	/** Service name (api, ingestion, memory, search, etc.) */
	service: string;
	/** Log message */
	message: string;
	/** Additional structured data */
	data?: Record<string, unknown>;
	/** Trace ID for distributed tracing */
	traceId?: string;
}

// =============================================================================
// Metrics Types
// =============================================================================

export interface MetricsUpdate {
	/** Metric name */
	name: string;
	/** Metric value */
	value: number;
	/** Metric unit (count, ms, bytes, percent) */
	unit: string;
	/** Service producing the metric */
	service: string;
	/** Timestamp in milliseconds */
	timestamp: number;
	/** Additional labels */
	labels?: Record<string, string>;
}

// =============================================================================
// Connection Tracking
// =============================================================================

const connectedLogClients = new Set<WSConnection>();
const connectedMetricsClients = new Set<WSConnection>();

// Subscriber instances (lazy-initialized)
let logsSubscriber: ReturnType<typeof createNatsPubSubSubscriber> | null = null;
let metricsSubscriber: ReturnType<typeof createNatsPubSubSubscriber> | null = null;
let logsSubscriptionActive = false;
let metricsSubscriptionActive = false;

// =============================================================================
// Log Streaming
// =============================================================================

/**
 * Broadcast a log entry to all connected log clients.
 * Optionally filters by service if clients have specified a service filter.
 */
function broadcastLogEntry(entry: LogEntry) {
	const message = JSON.stringify({ type: "log", data: entry });

	for (const client of connectedLogClients) {
		if (client.readyState !== 1) continue; // 1 = OPEN

		// Filter by service if client has specified one
		const { service } = client.data;
		if (service && entry.service !== service) continue;

		client.send(message);
	}
}

/**
 * Handle incoming log events from NATS pub/sub.
 */
function handleLogEvent(entry: LogEntry) {
	broadcastLogEntry(entry);
}

/**
 * Initialize NATS subscription for logs (runs once).
 */
async function initLogsSubscription() {
	if (logsSubscriptionActive) return;

	try {
		logsSubscriber = createNatsPubSubSubscriber();
		await logsSubscriber.connect();

		// Subscribe to global logs subject
		await logsSubscriber.subscribe<LogEntry>(LOG_SUBJECTS.global, handleLogEvent);
		logsSubscriptionActive = true;
	} catch {
		logsSubscriptionActive = false;
	}
}

/**
 * Handle WebSocket connection for log streaming.
 *
 * @param ws - WebSocket connection
 * @param service - Optional service filter (only show logs from this service)
 */
export async function handleLogsConnection(ws: WSConnection, service?: string) {
	// Track this client
	connectedLogClients.add(ws);

	// Send connection acknowledgment
	ws.send(
		JSON.stringify({
			type: "connected",
			data: {
				service: service || "all",
				timestamp: Date.now(),
			},
		}),
	);

	// Start NATS subscription in background (non-blocking)
	initLogsSubscription().catch(() => {
		// Background subscription failed - log updates won't be real-time
	});

	// Store cleanup callback
	ws.data.unsubscribe = async () => {
		connectedLogClients.delete(ws);

		// If no more clients, we could optionally disconnect from NATS
		// For now, keep the subscription active for quick reconnects
	};

	// Store message handler for client commands
	ws.data.messageHandler = async (message: string | Buffer) => {
		try {
			const data = JSON.parse(message.toString());

			switch (data.type) {
				case "subscribe":
					// Allow client to change service filter
					if (data.service) {
						ws.data.service = data.service;
					}
					break;

				case "unsubscribe":
					// Remove service filter
					ws.data.service = undefined;
					break;

				case "ping":
					// Respond to ping with pong
					ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
					break;
			}
		} catch {
			// Invalid message - ignore
		}
	};
}

// =============================================================================
// Metrics Streaming
// =============================================================================

/**
 * Broadcast a metrics update to all connected metrics clients.
 */
function broadcastMetricsUpdate(update: MetricsUpdate) {
	const message = JSON.stringify({ type: "metric", data: update });

	for (const client of connectedMetricsClients) {
		if (client.readyState === 1) {
			// 1 = OPEN
			client.send(message);
		}
	}
}

/**
 * Handle incoming metrics events from NATS pub/sub.
 */
function handleMetricsEvent(update: MetricsUpdate) {
	broadcastMetricsUpdate(update);
}

/**
 * Initialize NATS subscription for metrics (runs once).
 */
async function initMetricsSubscription() {
	if (metricsSubscriptionActive) return;

	try {
		metricsSubscriber = createNatsPubSubSubscriber();
		await metricsSubscriber.connect();

		// Subscribe to global metrics subject
		await metricsSubscriber.subscribe<MetricsUpdate>(METRICS_SUBJECTS.global, handleMetricsEvent);
		metricsSubscriptionActive = true;
	} catch {
		metricsSubscriptionActive = false;
	}
}

/**
 * Handle WebSocket connection for metrics streaming.
 */
export async function handleMetricsConnection(ws: WSConnection) {
	// Track this client
	connectedMetricsClients.add(ws);

	// Send connection acknowledgment
	ws.send(
		JSON.stringify({
			type: "connected",
			data: {
				timestamp: Date.now(),
			},
		}),
	);

	// Start NATS subscription in background (non-blocking)
	initMetricsSubscription().catch(() => {
		// Background subscription failed - metrics updates won't be real-time
	});

	// Store cleanup callback
	ws.data.unsubscribe = async () => {
		connectedMetricsClients.delete(ws);
	};

	// Store message handler
	ws.data.messageHandler = async (message: string | Buffer) => {
		try {
			const data = JSON.parse(message.toString());

			if (data.type === "ping") {
				ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
			}
		} catch {
			// Invalid message - ignore
		}
	};
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Clean up WebSocket server resources.
 * Call this during shutdown or HMR.
 */
export async function cleanupWebSocketServer(): Promise<void> {
	connectedLogClients.clear();
	connectedMetricsClients.clear();

	if (logsSubscriber) {
		await logsSubscriber.disconnect();
		logsSubscriber = null;
	}

	if (metricsSubscriber) {
		await metricsSubscriber.disconnect();
		metricsSubscriber = null;
	}

	logsSubscriptionActive = false;
	metricsSubscriptionActive = false;
}
