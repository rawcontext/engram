/**
 * Intelligence Layer Worker Configuration
 *
 * Manages environment variables and settings for cron jobs, LLM-driven algorithms,
 * and manual HTTP triggers.
 */

import { z } from "zod";

/**
 * Configuration schema with environment variable mapping and defaults
 */
export const IntelligenceConfigSchema = z.object({
	/** Service name for logging and metrics */
	serviceName: z.string().default("intelligence-worker"),

	/** NATS connection URL */
	natsUrl: z.string().default("nats://localhost:6181"),

	/** FalkorDB connection URL */
	falkorUrl: z.string().default("redis://localhost:6179"),

	/** HTTP server port for manual triggers */
	httpPort: z.number().default(6186),

	/** Log level (debug, info, warn, error) */
	logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),

	/** Enable cron jobs (disable for manual-only mode) */
	enableCron: z.boolean().default(true),

	/** Cron schedule for session summarization (default: every 6 hours) */
	sessionSummaryCron: z.string().default("0 */6 * * *"),

	/** Cron schedule for graph compaction (default: daily at 2 AM) */
	graphCompactionCron: z.string().default("0 2 * * *"),

	/** Cron schedule for insight extraction (default: every 4 hours) */
	insightExtractionCron: z.string().default("0 */4 * * *"),

	/** LLM provider for intelligence tasks (gemini, anthropic, openai) */
	llmProvider: z.enum(["gemini", "anthropic", "openai"]).default("gemini"),

	/** LLM model identifier */
	llmModel: z.string().default("gemini-2.0-flash-thinking-exp"),

	/** LLM temperature for creativity vs consistency (0.0-1.0) */
	llmTemperature: z.number().min(0).max(1).default(0.3),

	/** Maximum tokens for LLM completion */
	llmMaxTokens: z.number().default(4096),

	/** Batch size for processing sessions/turns */
	batchSize: z.number().default(10),

	/** Retention period for old summaries (days) */
	summaryRetentionDays: z.number().default(90),

	/** Minimum turns required to trigger session summary */
	minTurnsForSummary: z.number().default(5),

	/** Enable Prometheus metrics endpoint */
	enableMetrics: z.boolean().default(true),
});

export type IntelligenceConfig = z.infer<typeof IntelligenceConfigSchema>;

/**
 * Load configuration from environment variables with validation
 */
export function loadConfig(): IntelligenceConfig {
	const raw = {
		serviceName: process.env.SERVICE_NAME,
		natsUrl: process.env.NATS_URL,
		falkorUrl: process.env.FALKOR_URL,
		httpPort: process.env.HTTP_PORT ? Number.parseInt(process.env.HTTP_PORT, 10) : undefined,
		logLevel: process.env.LOG_LEVEL,
		enableCron: process.env.ENABLE_CRON ? process.env.ENABLE_CRON === "true" : undefined,
		sessionSummaryCron: process.env.SESSION_SUMMARY_CRON,
		graphCompactionCron: process.env.GRAPH_COMPACTION_CRON,
		insightExtractionCron: process.env.INSIGHT_EXTRACTION_CRON,
		llmProvider: process.env.LLM_PROVIDER,
		llmModel: process.env.LLM_MODEL,
		llmTemperature: process.env.LLM_TEMPERATURE
			? Number.parseFloat(process.env.LLM_TEMPERATURE)
			: undefined,
		llmMaxTokens: process.env.LLM_MAX_TOKENS
			? Number.parseInt(process.env.LLM_MAX_TOKENS, 10)
			: undefined,
		batchSize: process.env.BATCH_SIZE ? Number.parseInt(process.env.BATCH_SIZE, 10) : undefined,
		summaryRetentionDays: process.env.SUMMARY_RETENTION_DAYS
			? Number.parseInt(process.env.SUMMARY_RETENTION_DAYS, 10)
			: undefined,
		minTurnsForSummary: process.env.MIN_TURNS_FOR_SUMMARY
			? Number.parseInt(process.env.MIN_TURNS_FOR_SUMMARY, 10)
			: undefined,
		enableMetrics: process.env.ENABLE_METRICS ? process.env.ENABLE_METRICS === "true" : undefined,
	};

	return IntelligenceConfigSchema.parse(raw);
}
