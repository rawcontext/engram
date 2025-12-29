/**
 * HTTP Transport for MCP Server
 *
 * Implements Streamable HTTP transport with OAuth 2.1 authentication.
 * Uses Express for HTTP handling and the MCP SDK's StreamableHTTPServerTransport.
 *
 * @see https://modelcontextprotocol.io/docs/tutorials/security/authorization
 */

import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Application, Request, Response } from "express";
import type { SessionStore } from "../auth/session-store";
import type { AccessToken } from "../auth/token-verifier";

export interface HttpTransportOptions {
	port: number;
	mcpServer: McpServer;
	logger: Logger;
	/** Base URL for this MCP server (used in OAuth metadata) */
	serverUrl: string;
	/** Authorization server URL */
	authServerUrl?: string;
	/** Session store for secure session management */
	sessionStore?: SessionStore;
	/** Whether auth is enabled (false for local development) */
	authEnabled?: boolean;
}

export interface HttpTransportResult {
	app: Application;
	start: () => Promise<Server>;
	stop: () => Promise<void>;
}

/**
 * Create an HTTP transport for the MCP server
 *
 * Handles:
 * - POST /mcp - Initialize sessions and handle JSON-RPC requests
 * - GET /mcp - SSE stream for server-to-client notifications
 * - DELETE /mcp - Session termination
 * - GET /.well-known/oauth-protected-resource - OAuth resource metadata
 */
export async function createHttpTransport(
	options: HttpTransportOptions,
): Promise<HttpTransportResult> {
	const { port, mcpServer, logger, serverUrl, sessionStore, authEnabled = true } = options;

	// Dynamic import to avoid requiring express for stdio transport
	const express = (await import("express")).default;

	const app = express();
	app.use(express.json());

	// In-memory transport store (used when sessionStore not provided)
	const transports: Map<string, StreamableHTTPServerTransport> = new Map();

	let httpServer: Server | null = null;

	// Health check endpoint
	app.get("/health", (_req: Request, res: Response) => {
		res.json({ status: "ok", transport: "http", authEnabled });
	});

	// MCP endpoint - POST for JSON-RPC requests
	app.post("/mcp", async (req: Request, res: Response) => {
		const sessionId = req.headers["mcp-session-id"] as string | undefined;
		const auth = (req as Request & { auth?: AccessToken }).auth;

		logger.debug({ sessionId, hasAuth: !!auth }, "Handling POST /mcp");

		let transport: StreamableHTTPServerTransport | undefined;

		if (sessionId) {
			// Existing session - retrieve transport
			if (sessionStore) {
				const session = sessionStore.get(sessionId);
				if (session) {
					// Validate session owner if auth is present
					if (auth && session.userId !== auth.userId) {
						logger.warn(
							{ sessionId, expectedUser: session.userId, actualUser: auth.userId },
							"Session ownership mismatch",
						);
						res.status(403).json({
							jsonrpc: "2.0",
							error: { code: -32003, message: "Session access denied" },
							id: null,
						});
						return;
					}
					transport = session.transport;
					sessionStore.touch(sessionId);
				}
			} else {
				transport = transports.get(sessionId);
			}

			if (!transport) {
				logger.warn({ sessionId }, "Session not found");
				res.status(400).json({
					jsonrpc: "2.0",
					error: { code: -32000, message: "Invalid session" },
					id: null,
				});
				return;
			}
		} else if (isInitializeRequest(req.body)) {
			// New session initialization
			const newSessionId = auth?.userId ? `${auth.userId}:${randomUUID()}` : randomUUID();

			const newTransport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => newSessionId,
				onsessioninitialized: (id) => {
					if (sessionStore && auth) {
						sessionStore.set(id, {
							transport: newTransport,
							userId: auth.userId ?? "anonymous",
							clientId: auth.clientId,
							scopes: auth.scopes,
							createdAt: Date.now(),
							lastAccessAt: Date.now(),
						});
					} else {
						transports.set(id, newTransport);
					}
					logger.info({ sessionId: id, userId: auth?.userId }, "Session initialized");
				},
				onsessionclosed: (id) => {
					if (sessionStore) {
						sessionStore.delete(id);
					} else {
						transports.delete(id);
					}
					logger.info({ sessionId: id }, "Session closed");
				},
			});

			newTransport.onclose = () => {
				const sid = newTransport.sessionId;
				if (sid) {
					if (sessionStore) {
						sessionStore.delete(sid);
					} else {
						transports.delete(sid);
					}
				}
			};

			transport = newTransport;

			await mcpServer.connect(transport);
		} else {
			// Invalid request - no session and not an initialize request
			logger.warn("Invalid request: no session and not an initialize request");
			res.status(400).json({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Session required" },
				id: null,
			});
			return;
		}

		await transport.handleRequest(req, res, req.body);
	});

	// MCP endpoint - GET for SSE notifications stream
	app.get("/mcp", async (req: Request, res: Response) => {
		const sessionId = req.headers["mcp-session-id"] as string;
		const auth = (req as Request & { auth?: AccessToken }).auth;

		if (!sessionId) {
			res.status(400).json({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Session ID required" },
				id: null,
			});
			return;
		}

		let transport: StreamableHTTPServerTransport | undefined;

		if (sessionStore) {
			const session = sessionStore.get(sessionId);
			if (session) {
				// Validate session owner
				if (auth && session.userId !== auth.userId) {
					res.status(403).json({
						jsonrpc: "2.0",
						error: { code: -32003, message: "Session access denied" },
						id: null,
					});
					return;
				}
				transport = session.transport;
				sessionStore.touch(sessionId);
			}
		} else {
			transport = transports.get(sessionId);
		}

		if (!transport) {
			res.status(400).json({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Invalid session" },
				id: null,
			});
			return;
		}

		await transport.handleRequest(req, res);
	});

	// MCP endpoint - DELETE for session termination
	app.delete("/mcp", async (req: Request, res: Response) => {
		const sessionId = req.headers["mcp-session-id"] as string;
		const auth = (req as Request & { auth?: AccessToken }).auth;

		if (!sessionId) {
			res.status(400).json({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Session ID required" },
				id: null,
			});
			return;
		}

		let transport: StreamableHTTPServerTransport | undefined;

		if (sessionStore) {
			const session = sessionStore.get(sessionId);
			if (session) {
				// Validate session owner
				if (auth && session.userId !== auth.userId) {
					res.status(403).json({
						jsonrpc: "2.0",
						error: { code: -32003, message: "Session access denied" },
						id: null,
					});
					return;
				}
				transport = session.transport;
			}
		} else {
			transport = transports.get(sessionId);
		}

		if (!transport) {
			res.status(400).json({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Invalid session" },
				id: null,
			});
			return;
		}

		await transport.handleRequest(req, res);
	});

	return {
		app,
		start: () => {
			return new Promise((resolve) => {
				const server = app.listen(port, () => {
					logger.info({ port, serverUrl, authEnabled }, "HTTP transport started");
					resolve(server);
				});
				httpServer = server;
			});
		},
		stop: () => {
			return new Promise((resolve, reject) => {
				if (!httpServer) {
					resolve();
					return;
				}

				// Close all sessions
				if (sessionStore) {
					for (const [id, session] of sessionStore.entries()) {
						session.transport.close();
						sessionStore.delete(id);
					}
				} else {
					for (const [id, transport] of transports) {
						transport.close();
						transports.delete(id);
					}
				}

				httpServer.close((err) => {
					if (err) {
						reject(err);
					} else {
						logger.info("HTTP transport stopped");
						resolve();
					}
				});
			});
		},
	};
}
