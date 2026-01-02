import { createServer } from "node:http";
import { createNodeLogger } from "@engram/logger";
import type { ServerWebSocket } from "bun";
import next from "next";
import {
	handleConsumerStatusConnection,
	handleSessionConnection,
	handleSessionsConnection,
} from "./lib/websocket-server";

const logger = createNodeLogger({ service: "observatory", base: { component: "server" } });

const port = parseInt(process.env.PORT || "6178", 10);
const nextPort = port + 1; // Next.js runs on port+1 internally
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, hostname: "localhost", port: nextPort });
const handle = app.getRequestHandler();

interface WebSocketData {
	type: "sessions" | "consumers" | "session";
	sessionId?: string;
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
			const { pathname } = url;

			// Match /api/ws/sessions (global sessions list)
			if (pathname === "/api/ws/sessions") {
				const upgraded = server.upgrade(req, {
					data: { type: "sessions" },
				});
				if (upgraded) return undefined;
				return new Response("WebSocket upgrade failed", { status: 400 });
			}

			// Match /api/ws/consumers (consumer group status stream)
			if (pathname === "/api/ws/consumers") {
				const upgraded = server.upgrade(req, {
					data: { type: "consumers" },
				});
				if (upgraded) return undefined;
				return new Response("WebSocket upgrade failed", { status: 400 });
			}

			// Match /api/ws/session/:sessionId (individual session)
			if (pathname?.startsWith("/api/ws/session/")) {
				const parts = pathname.split("/");
				// /api/ws/session/123 -> ['', 'api', 'ws', 'session', '123']
				const sessionId = parts[4];

				if (sessionId) {
					const upgraded = server.upgrade(req, {
						data: { type: "session", sessionId },
					});
					if (upgraded) return undefined;
					return new Response("WebSocket upgrade failed", { status: 400 });
				}
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
				const { type, sessionId } = ws.data;

				if (type === "sessions") {
					handleSessionsConnection(ws);
				} else if (type === "consumers") {
					handleConsumerStatusConnection(ws);
				} else if (type === "session" && sessionId) {
					handleSessionConnection(ws, sessionId);
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

	logger.info({ port }, "Observatory server ready");
});
