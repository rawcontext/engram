/**
 * Intelligence Layer Worker Service
 *
 * Background worker for LLM-driven graph algorithms and cron jobs:
 * - Session summarization
 * - Graph compaction
 * - Insight extraction
 * - Relationship inference
 *
 * Architecture:
 * - NATS consumer for event-driven jobs
 * - Croner for scheduled cron jobs
 * - Hono HTTP server for manual triggers
 * - Prometheus metrics for monitoring
 */

import { createNodeLogger, type Logger } from "@engram/logger";
import { createFalkorClient, createNatsClient, type GraphClient } from "@engram/storage";
import { serve } from "@hono/node-server";
import { createApi } from "./api";
import { type IntelligenceConfig, loadConfig } from "./config";
import { metrics } from "./metrics";
import { Scheduler } from "./scheduler";

/**
 * Dependencies for Intelligence Worker construction.
 * Supports dependency injection for testability.
 */
export interface IntelligenceWorkerDeps {
	/** Configuration object */
	config?: IntelligenceConfig;
	/** Graph client for persistence */
	graphClient?: GraphClient;
	/** NATS client for event streaming */
	natsClient?: ReturnType<typeof createNatsClient>;
	/** Logger instance */
	logger?: Logger;
}

/**
 * Factory function for creating Intelligence Worker dependencies.
 */
export function createIntelligenceWorkerDeps(
	deps?: IntelligenceWorkerDeps,
): Required<IntelligenceWorkerDeps> {
	const config = deps?.config ?? loadConfig();

	const logger =
		deps?.logger ??
		createNodeLogger({
			service: config.serviceName,
			level: config.logLevel,
			base: { component: "worker" },
			pretty: false,
		});

	const graphClient = deps?.graphClient ?? createFalkorClient();
	const natsClient = deps?.natsClient ?? createNatsClient(config.serviceName);

	return {
		config,
		logger,
		graphClient,
		natsClient,
	};
}

/**
 * Main entry point for the Intelligence Worker service
 */
export async function main() {
	const { config, logger, graphClient, natsClient } = createIntelligenceWorkerDeps();

	logger.info({ config }, "Intelligence Worker starting");

	// Connect to services
	await graphClient.connect();
	logger.info("Connected to FalkorDB");

	await natsClient.connect();
	logger.info("Connected to NATS");

	// Initialize scheduler for cron jobs
	const scheduler = new Scheduler(config, natsClient, logger);
	await scheduler.start();

	// Start HTTP server for manual triggers and health checks
	const app = createApi(config, natsClient, metrics, logger);
	const server = serve(
		{
			fetch: app.fetch,
			port: config.httpPort,
		},
		() => {
			logger.info({ port: config.httpPort }, "HTTP server listening");
		},
	);

	// Graceful shutdown handler
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down gracefully...");

		// Stop scheduler
		await scheduler.stop();
		logger.info("Stopped scheduler");

		// Close HTTP server
		server.close(() => {
			logger.info("HTTP server closed");
		});

		// Disconnect from services
		try {
			await graphClient.disconnect();
			logger.info("FalkorDB disconnected");
		} catch (e) {
			logger.error({ err: e }, "Error disconnecting from FalkorDB");
		}

		try {
			await natsClient.disconnect();
			logger.info("NATS disconnected");
		} catch (e) {
			logger.error({ err: e }, "Error disconnecting from NATS");
		}

		process.exit(0);
	};

	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGINT", () => shutdown("SIGINT"));

	logger.info("Intelligence Worker ready");
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("Fatal error:", err);
		process.exit(1);
	});
}
