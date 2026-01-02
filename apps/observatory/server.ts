import { createServer } from "node:http";
import { createNodeLogger } from "@engram/logger";
import next from "next";
import { WebSocketServer } from "ws";
import {
	handleConsumerStatusConnection,
	handleSessionConnection,
	handleSessionsConnection,
} from "./lib/websocket-server";

const logger = createNodeLogger({ service: "observatory", base: { component: "server" } });

const port = parseInt(process.env.PORT || "6178", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "", `http://localhost:${port}`);
		handle(req, res, { pathname: url.pathname, query: Object.fromEntries(url.searchParams) });
	});

	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (request, socket, head) => {
		const { pathname } = new URL(request.url || "", `http://localhost:${port}`);

		// Match /api/ws/sessions (global sessions list)
		if (pathname === "/api/ws/sessions") {
			wss.handleUpgrade(request, socket, head, (ws) => {
				handleSessionsConnection(ws);
			});
			return;
		}

		// Match /api/ws/consumers (consumer group status stream)
		if (pathname === "/api/ws/consumers") {
			wss.handleUpgrade(request, socket, head, (ws) => {
				handleConsumerStatusConnection(ws);
			});
			return;
		}

		// Match /api/ws/session/:sessionId (individual session)
		if (pathname?.startsWith("/api/ws/session/")) {
			const parts = pathname.split("/");
			// /api/ws/session/123 -> ['', 'api', 'ws', 'session', '123']
			const sessionId = parts[4];

			if (sessionId) {
				wss.handleUpgrade(request, socket, head, (ws) => {
					handleSessionConnection(ws, sessionId);
				});
				return;
			}
		}

		// Do not destroy the socket here.
		// Next.js (in dev mode) attaches its own upgrade listener for HMR (/_next/webpack-hmr).
		// If we destroy it, HMR fails and causes page reloads.
	});

	server.listen(port, () => {
		logger.info({ port }, "Observatory server ready");
	});
});
