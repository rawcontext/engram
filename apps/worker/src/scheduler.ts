/**
 * Scheduler Module
 *
 * Cron job scheduling using Croner library with NATS integration.
 * Manages scheduled intelligence tasks and publishes triggers to NATS.
 * Supports activity-based scheduling for adaptive job triggering.
 */

import type { Logger } from "@engram/logger";
import type { NatsClient } from "@engram/storage";
import { Cron } from "croner";
import { type ActivityThresholds, ActivityTracker } from "./activity-tracker";
import type { IntelligenceConfig } from "./config";

/**
 * Job schedule configuration mapping
 */
interface JobSchedule {
	name: string;
	schedule: string;
	natsSubject: string;
	description: string;
}

/**
 * Next run information for a scheduled job
 */
export interface JobNextRun {
	name: string;
	nextRun: Date | null;
	schedule: string;
	description: string;
}

/**
 * Scheduler manages cron jobs, activity-based triggers, and publishes to NATS
 */
export class Scheduler {
	private jobs: Map<string, Cron> = new Map();
	private schedules: JobSchedule[];
	private logger: Logger;
	private natsClient: NatsClient;
	private config: IntelligenceConfig;
	private activityTracker: ActivityTracker | null = null;

	constructor(config: IntelligenceConfig, natsClient: NatsClient, logger: Logger) {
		this.config = config;
		this.natsClient = natsClient;
		this.logger = logger.child({ component: "scheduler" });

		// Define job schedules based on configuration
		this.schedules = [
			{
				name: "decay-calculation",
				schedule: config.sessionSummaryCron, // Default: "0 2 * * *" (daily at 2am UTC)
				natsSubject: "engram.jobs.decay-calculation",
				description: "Calculate memory decay scores and update graph weights",
			},
			{
				name: "community-detection",
				schedule: config.graphCompactionCron, // Default: "0 3 * * *" (daily at 3am UTC)
				natsSubject: "engram.jobs.community-detection",
				description: "Detect communities and clusters in the memory graph",
			},
			{
				name: "conflict-scan",
				schedule: config.conflictScanCron, // Default: "0 4 * * 0" (Sunday at 4am UTC)
				natsSubject: "engram.jobs.conflict-scan",
				description: "Scan for conflicting memories and create ConflictReport nodes for review",
			},
		];

		// Initialize activity tracker if enabled
		if (config.enableActivityScheduling) {
			const thresholds: ActivityThresholds = {
				entityCreationThreshold: config.activityEntityThreshold,
				memoryCreationThreshold: config.activityMemoryThreshold,
				cooldownMinutes: config.activityCooldownMinutes,
			};

			this.activityTracker = new ActivityTracker(
				logger,
				async (project, reason) => {
					await this.triggerCommunityDetection(project, reason);
				},
				thresholds,
			);
		}
	}

	/**
	 * Start all scheduled cron jobs and activity tracking
	 */
	async start(): Promise<void> {
		// Connect to NATS if not already connected
		await this.natsClient.connect();

		// Initialize activity tracker connection
		if (this.activityTracker) {
			const nc = await this.natsClient.getConnection();
			await this.activityTracker.connect(nc);
			this.logger.info(
				{
					entityThreshold: this.config.activityEntityThreshold,
					memoryThreshold: this.config.activityMemoryThreshold,
					cooldownMinutes: this.config.activityCooldownMinutes,
				},
				"Activity-based scheduling enabled",
			);
		}

		if (!this.config.enableCron) {
			this.logger.info("Cron jobs disabled via configuration");
			return;
		}

		for (const jobConfig of this.schedules) {
			const job = new Cron(
				jobConfig.schedule,
				{
					timezone: "UTC",
					protect: true, // Prevent overlapping executions
				},
				async () => {
					await this.handleJobExecution(jobConfig);
				},
			);

			this.jobs.set(jobConfig.name, job);

			this.logger.info(
				{
					job: jobConfig.name,
					schedule: jobConfig.schedule,
					nextRun: job.nextRun()?.toISOString(),
				},
				`Scheduled job: ${jobConfig.description}`,
			);
		}

		this.logger.info(
			{
				jobCount: this.jobs.size,
				jobs: Array.from(this.jobs.keys()),
			},
			"Scheduler started",
		);
	}

	/**
	 * Stop all running cron jobs and activity tracking
	 */
	async stop(): Promise<void> {
		this.logger.info({ jobCount: this.jobs.size }, "Stopping scheduler");

		for (const [name, job] of this.jobs.entries()) {
			job.stop();
			this.logger.debug({ job: name }, "Stopped job");
		}

		this.jobs.clear();

		// Disconnect activity tracker
		if (this.activityTracker) {
			await this.activityTracker.disconnect();
			this.logger.debug("Activity tracker disconnected");
		}

		this.logger.info("Scheduler stopped");
	}

	/**
	 * Get next run times for all scheduled jobs
	 */
	getNextRuns(): JobNextRun[] {
		const runs: JobNextRun[] = [];

		for (const jobConfig of this.schedules) {
			const job = this.jobs.get(jobConfig.name);
			const nextRun = job?.nextRun() ?? null;

			runs.push({
				name: jobConfig.name,
				nextRun,
				schedule: jobConfig.schedule,
				description: jobConfig.description,
			});
		}

		return runs;
	}

	/**
	 * Handle job execution by publishing event to NATS
	 */
	private async handleJobExecution(jobConfig: JobSchedule): Promise<void> {
		const startTime = Date.now();
		const executionId = `${jobConfig.name}-${startTime}`;

		this.logger.info(
			{
				job: jobConfig.name,
				executionId,
				timestamp: new Date(startTime).toISOString(),
			},
			`Executing job: ${jobConfig.description}`,
		);

		try {
			// Publish job trigger to NATS
			await this.natsClient.sendEvent(jobConfig.natsSubject, executionId, {
				job: jobConfig.name,
				executionId,
				timestamp: startTime,
				triggeredBy: "cron",
			});

			const duration = Date.now() - startTime;

			this.logger.info(
				{
					job: jobConfig.name,
					executionId,
					duration,
				},
				`Job trigger published successfully`,
			);
		} catch (error) {
			const duration = Date.now() - startTime;

			this.logger.error(
				{
					job: jobConfig.name,
					executionId,
					duration,
					error: error instanceof Error ? error.message : String(error),
				},
				`Failed to publish job trigger`,
			);
		}
	}

	/**
	 * Trigger community detection for a specific project.
	 * Called by activity tracker when thresholds are exceeded.
	 */
	private async triggerCommunityDetection(project: string, reason: string): Promise<void> {
		const startTime = Date.now();
		const executionId = `community-detection-activity-${project}-${startTime}`;

		this.logger.info(
			{
				project,
				reason,
				executionId,
				triggeredBy: "activity",
			},
			"Triggering community detection due to activity threshold",
		);

		await this.natsClient.sendEvent("engram.jobs.community-detection", executionId, {
			job: "community-detection",
			executionId,
			timestamp: startTime,
			triggeredBy: "activity",
			project,
			reason,
		});
	}

	/**
	 * Track entity creation for activity-based scheduling.
	 * Call this when new entities are created in the graph.
	 * @param project - Project identifier (e.g., git remote or working directory)
	 * @param count - Number of entities created (default: 1)
	 */
	async trackEntityCreation(project: string, count = 1): Promise<void> {
		if (!this.activityTracker) {
			return;
		}
		await this.activityTracker.trackEntityCreation(project, count);
	}

	/**
	 * Track memory creation for activity-based scheduling.
	 * Call this when new memories are created.
	 * @param project - Project identifier
	 * @param count - Number of memories created (default: 1)
	 */
	async trackMemoryCreation(project: string, count = 1): Promise<void> {
		if (!this.activityTracker) {
			return;
		}
		await this.activityTracker.trackMemoryCreation(project, count);
	}

	/**
	 * Get activity statistics for a project (for monitoring/debugging)
	 */
	async getActivityStats(project: string): Promise<{
		entityCount: number;
		memoryCount: number;
		lastTriggerTime: number;
		thresholds: ActivityThresholds;
	} | null> {
		if (!this.activityTracker) {
			return null;
		}
		return this.activityTracker.getStats(project);
	}

	/**
	 * Reset activity counters for a project (e.g., after manual community detection)
	 */
	async resetActivityCounters(project: string): Promise<void> {
		if (!this.activityTracker) {
			return;
		}
		await this.activityTracker.resetCounters(project);
	}

	/**
	 * Check if activity-based scheduling is enabled
	 */
	isActivityTrackingEnabled(): boolean {
		return this.activityTracker !== null;
	}
}
