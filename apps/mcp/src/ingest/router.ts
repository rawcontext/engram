import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
import type { MemoryStore } from "../services/memory-store";
import {
	handleIngestEvent,
	handleToolIngest,
	handlePromptIngest,
	handleSessionIngest,
	type IngestHandlerDeps,
} from "./handlers";

export interface IngestRouterOptions {
	memoryStore: MemoryStore;
	graphClient: GraphClient;
	logger: Logger;
}

/**
 * Create the HTTP ingest router with all endpoints
 */
export function createIngestRouter(options: IngestRouterOptions) {
	const { memoryStore, graphClient, logger } = options;

	const app = new Hono();

	// Middleware
	app.use("*", cors());
	app.use("*", honoLogger());

	// Health check
	app.get("/health", (c) => {
		return c.json({
			status: "healthy",
			service: "engram-mcp-ingest",
			timestamp: new Date().toISOString(),
		});
	});

	// Handler dependencies
	const deps: IngestHandlerDeps = {
		memoryStore,
		graphClient,
		logger,
	};

	// Ingest endpoints
	app.post("/ingest/event", (c) => handleIngestEvent(c, deps));
	app.post("/ingest/tool", (c) => handleToolIngest(c, deps));
	app.post("/ingest/prompt", (c) => handlePromptIngest(c, deps));
	app.post("/ingest/session", (c) => handleSessionIngest(c, deps));

	// Error handler
	app.onError((err, c) => {
		logger.error({ error: err }, "Unhandled error in ingest router");
		return c.json({ error: "Internal server error" }, 500);
	});

	// Not found handler
	app.notFound((c) => {
		return c.json({ error: "Not found" }, 404);
	});

	return app;
}

/**
 * Start the HTTP ingest server using Node.js
 */
export async function startIngestServer(
	options: IngestRouterOptions & { port: number },
): Promise<{ close: () => Promise<void> }> {
	const { port, logger, ...routerOptions } = options;
	const app = createIngestRouter({ ...routerOptions, logger });

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
			logger.info("HTTP ingest server stopped");
		},
	};
}
