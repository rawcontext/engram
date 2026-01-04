import { createServer } from "node:http";
import { createNodeLogger } from "@engram/logger";
import type { ServerWebSocket } from "bun";
import next from "next";
import { handleLogsConnection, handleMetricsConnection } from "./lib/websocket-server";

const logger = createNodeLogger({ service: "console", base: { component: "server" } });

const port = parseInt(process.env.PORT || "6185", 10);
const nextPort = port + 1; // Next.js runs on port+1 internally
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, hostname: "localhost", port: nextPort });
const handle = app.getRequestHandler();

/**
 * WebSocket connection data types for Console
 */
interface WebSocketData {
	type: "logs" | "metrics";
	service?: string;
	unsubscribe?: () => Promise<void>;
	messageHandler?: (message: string | Buffer) => void;
}

app.prepare().then(() => {
	// Start Next.js on internal port
	const httpServer = createServer((req, res) => {
		handle(req, res);
	});
	httpServer.listen(nextPort);

	// Bun.serve handles WebSocket upgrades and proxies other requests to Next.js
	Bun.serve<WebSocketData>({
		port,
		async fetch(req, server) {
			const url = new URL(req.url);
			const { pathname, searchParams } = url;

			// Match /api/ws/logs (global log stream)
			// Query params: ?service=api,ingestion,memory to filter by service
			if (pathname === "/api/ws/logs") {
				const service = searchParams.get("service") || undefined;
				const upgraded = server.upgrade(req, {
					data: { type: "logs", service },
				});
				if (upgraded) return undefined;
				return new Response("WebSocket upgrade failed", { status: 400 });
			}

			// Match /api/ws/logs/:service (service-specific log stream)
			if (pathname?.startsWith("/api/ws/logs/")) {
				const parts = pathname.split("/");
				// /api/ws/logs/api -> ['', 'api', 'ws', 'logs', 'api']
				const service = parts[4];

				if (service) {
					const upgraded = server.upgrade(req, {
						data: { type: "logs", service },
					});
					if (upgraded) return undefined;
					return new Response("WebSocket upgrade failed", { status: 400 });
				}
			}

			// Match /api/ws/metrics (real-time metrics stream)
			if (pathname === "/api/ws/metrics") {
				const upgraded = server.upgrade(req, {
					data: { type: "metrics" },
				});
				if (upgraded) return undefined;
				return new Response("WebSocket upgrade failed", { status: 400 });
			}

			// Proxy all other requests to Next.js
			const nextUrl = new URL(req.url.replace(`:${port}`, `:${nextPort}`));
			return fetch(nextUrl, {
				method: req.method,
				headers: req.headers,
				body: req.body,
			});
		},
		websocket: {
			open(ws: ServerWebSocket<WebSocketData>) {
				const { type, service } = ws.data;

				if (type === "logs") {
					handleLogsConnection(ws, service);
				} else if (type === "metrics") {
					handleMetricsConnection(ws);
				}
			},
			message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
				// Delegate to the handler stored in ws.data
				if (ws.data.messageHandler) {
					ws.data.messageHandler(message);
				}
			},
			close(ws: ServerWebSocket<WebSocketData>) {
				// Call cleanup callback if set
				if (ws.data.unsubscribe) {
					ws.data.unsubscribe();
				}
			},
		},
	});

	logger.info({ port }, "Console server ready with WebSocket support");
});
