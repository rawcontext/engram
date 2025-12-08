import { createServer } from "http";
import next from "next";
import { parse } from "url";
import { WebSocketServer } from "ws";
import { handleSessionConnection, handleSessionsConnection } from "./lib/websocket-server";

const port = parseInt(process.env.PORT || "5000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
	const server = createServer((req, res) => {
		const parsedUrl = parse(req.url!, true);
		handle(req, res, parsedUrl);
	});

	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (request, socket, head) => {
		const { pathname } = parse(request.url || "", true);

		// Match /api/ws/sessions (global sessions list)
		if (pathname === "/api/ws/sessions") {
			wss.handleUpgrade(request, socket, head, (ws) => {
				handleSessionsConnection(ws);
			});
			return;
		}

		// Match /api/ws/session/:sessionId (individual session)
		if (pathname && pathname.startsWith("/api/ws/session/")) {
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
		console.log(`> Ready on http://localhost:${port}`);
	});
});
