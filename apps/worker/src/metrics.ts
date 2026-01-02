/**
 * Prometheus Metrics for Worker Service
 *
 * Tracks job execution metrics including:
 * - Job duration histograms (by type and status)
 * - Job outcome counters (success/error by type)
 * - Last run timestamps (by type)
 */

import client from "prom-client";

/**
 * Histogram for job duration tracking.
 * Tracks how long each job type takes to complete.
 */
const jobDuration = new client.Histogram({
	name: "engram_worker_job_duration_seconds",
	help: "Duration of worker jobs",
	labelNames: ["job_type", "status"],
	buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120],
});

/**
 * Counter for total job executions.
 * Tracks total number of jobs by type and outcome status.
 */
const jobTotal = new client.Counter({
	name: "engram_worker_job_total",
	help: "Total worker jobs by type and status",
	labelNames: ["job_type", "status"],
});

/**
 * Gauge for last job run timestamp.
 * Tracks when each job type last executed (Unix timestamp).
 */
const lastRun = new client.Gauge({
	name: "engram_worker_job_last_run_timestamp",
	help: "Timestamp of last job run",
	labelNames: ["job_type"],
});

/**
 * Job timer interface returned by recordJobStart.
 * Provides end() method to complete timing and record metrics.
 */
export interface JobTimer {
	/**
	 * Complete job timing and record success/error metrics.
	 * @param status - Job outcome ('success' or 'error')
	 */
	end: (status: "success" | "error") => void;
}

/**
 * Worker Metrics class for tracking job execution.
 */
export class WorkerMetrics {
	private registry: client.Registry;

	constructor() {
		this.registry = new client.Registry();

		// Register metrics with the registry
		this.registry.registerMetric(jobDuration);
		this.registry.registerMetric(jobTotal);
		this.registry.registerMetric(lastRun);

		// Register default Node.js metrics (CPU, memory, event loop, etc.)
		client.collectDefaultMetrics({ register: this.registry });
	}

	/**
	 * Start timing a job execution.
	 * Returns a timer object with end() method to record completion.
	 *
	 * @param jobType - Type of job being executed (e.g., 'session-summary', 'graph-compaction')
	 * @returns JobTimer with end() method
	 *
	 * @example
	 * const timer = metrics.recordJobStart('session-summary');
	 * try {
	 *   await runJob();
	 *   timer.end('success');
	 * } catch (err) {
	 *   timer.end('error');
	 * }
	 */
	recordJobStart(jobType: string): JobTimer {
		const endTimer = jobDuration.startTimer({ job_type: jobType });

		return {
			end: (status: "success" | "error") => {
				// Record duration in histogram
				endTimer({ status });

				// Update last run timestamp
				lastRun.set({ job_type: jobType }, Date.now() / 1000);

				// Increment total counter
				jobTotal.inc({ job_type: jobType, status });
			},
		};
	}

	/**
	 * Record a successful job execution.
	 * Convenience method when not using timer pattern.
	 *
	 * @param jobType - Type of job that succeeded
	 */
	recordJobSuccess(jobType: string): void {
		jobTotal.inc({ job_type: jobType, status: "success" });
		lastRun.set({ job_type: jobType }, Date.now() / 1000);
	}

	/**
	 * Record a failed job execution.
	 * Convenience method when not using timer pattern.
	 *
	 * @param jobType - Type of job that failed
	 */
	recordJobError(jobType: string): void {
		jobTotal.inc({ job_type: jobType, status: "error" });
		lastRun.set({ job_type: jobType }, Date.now() / 1000);
	}

	/**
	 * Get metrics in Prometheus text format.
	 * Used by /metrics endpoint for scraping.
	 *
	 * @returns Prometheus-formatted metrics string
	 */
	async getMetrics(): Promise<string> {
		return this.registry.metrics();
	}

	/**
	 * Get the metrics registry.
	 * Useful for advanced integrations or testing.
	 *
	 * @returns Prometheus Registry instance
	 */
	getRegistry(): client.Registry {
		return this.registry;
	}
}

/**
 * Singleton metrics instance.
 * Import and use this instance throughout the worker service.
 */
export const metrics = new WorkerMetrics();
