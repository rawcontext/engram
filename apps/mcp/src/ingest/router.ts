import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { createApiKeyAuth, requireScopes } from "../middleware/auth";
import type { MemoryStore } from "../services/memory-store";
import {
	handleIngestEvent,
	handlePromptIngest,
	handleSessionIngest,
	handleToolIngest,
	type IngestHandlerDeps,
} from "./handlers";

export interface IngestRouterOptions {
	memoryStore: MemoryStore;
	graphClient: GraphClient;
	logger: Logger;
	authEnabled?: boolean;
	authPostgresUrl?: string;
}

export interface IngestRouterResult {
	app: Hono;
	close: () => Promise<void>;
}

/**
 * Create the HTTP ingest router with all endpoints
 */
export function createIngestRouter(options: IngestRouterOptions): IngestRouterResult {
	const { memoryStore, graphClient, logger, authEnabled = true, authPostgresUrl } = options;

	const app = new Hono();
	let authClose: (() => Promise<void>) | undefined;

	// Middleware
	app.use("*", cors());
	app.use("*", honoLogger());

	// Health check (public)
	app.get("/health", (c) => {
		return c.json({
			status: "healthy",
			service: "engram-mcp-ingest",
			timestamp: new Date().toISOString(),
		});
	});

	// Protected routes
	const protectedRoutes = new Hono();

	if (authEnabled && authPostgresUrl) {
		const auth = createApiKeyAuth({ logger, postgresUrl: authPostgresUrl });
		authClose = auth.close;
		protectedRoutes.use("*", auth.middleware);
		protectedRoutes.use("*", requireScopes("memory:write", "ingest:write"));
		logger.info("API key authentication enabled for ingest routes");
	} else {
		logger.info("API key authentication disabled for ingest routes (local mode)");
	}

	// Handler dependencies
	const deps: IngestHandlerDeps = {
		memoryStore,
		graphClient,
		logger,
	};

	// Ingest endpoints (protected)
	protectedRoutes.post("/ingest/event", (c) => handleIngestEvent(c, deps));
	protectedRoutes.post("/ingest/tool", (c) => handleToolIngest(c, deps));
	protectedRoutes.post("/ingest/prompt", (c) => handlePromptIngest(c, deps));
	protectedRoutes.post("/ingest/session", (c) => handleSessionIngest(c, deps));

	app.route("/", protectedRoutes);

	// Error handler
	app.onError((err, c) => {
		logger.error({ error: err }, "Unhandled error in ingest router");
		return c.json({ error: "Internal server error" }, 500);
	});

	// Not found handler
	app.notFound((c) => {
		return c.json({ error: "Not found" }, 404);
	});

	return {
		app,
		close: async () => {
			if (authClose) {
				await authClose();
			}
		},
	};
}

/**
 * Start the HTTP ingest server using Node.js
 */
export async function startIngestServer(
	options: IngestRouterOptions & { port: number },
): Promise<{ close: () => Promise<void> }> {
	const { port, logger, ...routerOptions } = options;
	const { app, close: closeRouter } = createIngestRouter({ ...routerOptions, logger });

	// Use Node.js native server via Hono's serve
	const { serve } = await import("@hono/node-server");
	const server = serve({
		fetch: app.fetch,
		port,
	});

	logger.info({ port }, "HTTP ingest server started");

	return {
		close: async () => {
			server.close();
			await closeRouter();
			logger.info("HTTP ingest server stopped");
		},
	};
}
