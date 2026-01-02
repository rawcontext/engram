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
import type { CronOptions } from "croner";
import { Cron } from "croner";
import { Hono } from "hono";
import { type IntelligenceConfig, loadConfig } from "./config";
import { metrics } from "./metrics";

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
 * Initialize scheduled cron jobs for intelligence tasks
 */
export function initializeCronJobs(
	config: IntelligenceConfig,
	logger: Logger,
): { sessionSummary: Cron; graphCompaction: Cron; insightExtraction: Cron } {
	if (!config.enableCron) {
		logger.info("Cron jobs disabled via configuration");
		return {} as any; // Return empty object if cron is disabled
	}

	const cronOptions: CronOptions = {
		timezone: "UTC",
		protect: true, // Prevent overlapping executions
	};

	// Session summarization job
	const sessionSummary = new Cron(config.sessionSummaryCron, cronOptions, async () => {
		const timer = metrics.recordJobStart("session-summary");
		try {
			logger.info("Starting session summarization job");
			// TODO: Implement session summarization logic
			timer.end("success");
		} catch (err) {
			logger.error({ err }, "Session summarization job failed");
			timer.end("error");
			throw err;
		}
	});

	// Graph compaction job
	const graphCompaction = new Cron(config.graphCompactionCron, cronOptions, async () => {
		const timer = metrics.recordJobStart("graph-compaction");
		try {
			logger.info("Starting graph compaction job");
			// TODO: Implement graph compaction logic
			timer.end("success");
		} catch (err) {
			logger.error({ err }, "Graph compaction job failed");
			timer.end("error");
			throw err;
		}
	});

	// Insight extraction job
	const insightExtraction = new Cron(config.insightExtractionCron, cronOptions, async () => {
		const timer = metrics.recordJobStart("insight-extraction");
		try {
			logger.info("Starting insight extraction job");
			// TODO: Implement insight extraction logic
			timer.end("success");
		} catch (err) {
			logger.error({ err }, "Insight extraction job failed");
			timer.end("error");
			throw err;
		}
	});

	logger.info(
		{
			sessionSummaryCron: config.sessionSummaryCron,
			graphCompactionCron: config.graphCompactionCron,
			insightExtractionCron: config.insightExtractionCron,
		},
		"Cron jobs initialized",
	);

	return { sessionSummary, graphCompaction, insightExtraction };
}

/**
 * Create HTTP server for manual job triggers and health checks
 */
export function createHttpServer(config: IntelligenceConfig, logger: Logger): Hono {
	const app = new Hono();

	// Health check endpoint
	app.get("/health", (c) => {
		return c.json({ status: "healthy", service: config.serviceName });
	});

	// Kubernetes readiness probe
	app.get("/ready", (c) => {
		return c.json({ status: "ready" });
	});

	// Metrics endpoint - Prometheus scraping
	app.get("/metrics", async (c) => {
		const metricsText = await metrics.getMetrics();
		return c.text(metricsText);
	});

	// Manual trigger endpoints (placeholders)
	app.post("/api/jobs/session-summary", async (c) => {
		logger.info("Manual session summary triggered");
		// TODO: Trigger session summary job
		return c.json({ status: "started", job: "session-summary" });
	});

	app.post("/api/jobs/graph-compaction", async (c) => {
		logger.info("Manual graph compaction triggered");
		// TODO: Trigger graph compaction job
		return c.json({ status: "started", job: "graph-compaction" });
	});

	app.post("/api/jobs/insight-extraction", async (c) => {
		logger.info("Manual insight extraction triggered");
		// TODO: Trigger insight extraction job
		return c.json({ status: "started", job: "insight-extraction" });
	});

	return app;
}

/**
 * Main entry point for the Intelligence Worker service
 */
export async function main() {
	const { config, logger, graphClient } = createIntelligenceWorkerDeps();

	logger.info({ config }, "Intelligence Worker starting");

	// Connect to services
	await graphClient.connect();
	logger.info("Connected to FalkorDB");

	// Initialize cron jobs
	const cronJobs = config.enableCron ? initializeCronJobs(config, logger) : null;

	// Start HTTP server for manual triggers
	const app = createHttpServer(config, logger);
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

		// Stop cron jobs
		if (cronJobs) {
			cronJobs.sessionSummary?.stop();
			cronJobs.graphCompaction?.stop();
			cronJobs.insightExtraction?.stop();
			logger.info("Stopped cron jobs");
		}

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
