/**
 * Activity Tracker Module
 *
 * Monitors entity creation rate and triggers community detection when thresholds are exceeded.
 * Uses NATS KV Store for atomic counter operations with project-level isolation.
 */

import type { Logger } from "@engram/logger";
import type { KV } from "@nats-io/kv";
import { Kvm } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/transport-node";

/**
 * Activity threshold configuration
 */
export interface ActivityThresholds {
	/** Trigger community detection after this many entity creations (default: 100) */
	entityCreationThreshold: number;
	/** Trigger community detection after this many memory creations (default: 500) */
	memoryCreationThreshold: number;
	/** Minimum minutes between triggers to prevent thrashing (default: 60) */
	cooldownMinutes: number;
}

/**
 * Activity counter state stored in NATS KV
 */
interface ActivityCounterState {
	/** Number of entities created since last community detection */
	entityCount: number;
	/** Number of memories created since last community detection */
	memoryCount: number;
	/** Timestamp of last community detection trigger */
	lastTriggerTime: number;
	/** Last update timestamp */
	updatedAt: number;
}

const DEFAULT_THRESHOLDS: ActivityThresholds = {
	entityCreationThreshold: 100,
	memoryCreationThreshold: 500,
	cooldownMinutes: 60,
};

const BUCKET_NAME = "engram-activity";
const COUNTER_KEY_PREFIX = "counter";

/**
 * Callback when activity threshold triggers a job
 */
export type ActivityTriggerCallback = (project: string, reason: string) => Promise<void>;

/**
 * ActivityTracker monitors entity/memory creation rates and triggers
 * community detection when thresholds are exceeded.
 */
export class ActivityTracker {
	private kv: KV | null = null;
	private logger: Logger;
	private thresholds: ActivityThresholds;
	private onTrigger: ActivityTriggerCallback;

	constructor(
		logger: Logger,
		onTrigger: ActivityTriggerCallback,
		thresholds?: Partial<ActivityThresholds>,
	) {
		this.logger = logger.child({ component: "activity-tracker" });
		this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
		this.onTrigger = onTrigger;
	}

	/**
	 * Initialize NATS KV connection
	 */
	async connect(nc: NatsConnection): Promise<void> {
		const kvm = new Kvm(nc);

		// Create or open the activity bucket
		try {
			this.kv = await kvm.create(BUCKET_NAME, {
				history: 1, // Only keep latest value
				ttl: 24 * 60 * 60 * 1000, // 24 hour TTL on keys
			});
			this.logger.info({ bucket: BUCKET_NAME }, "Created activity KV bucket");
		} catch (err) {
			// Bucket may already exist
			const error = err as Error;
			if (
				error.message?.includes("already exists") ||
				error.message?.includes("stream name already in use")
			) {
				this.kv = await kvm.open(BUCKET_NAME);
				this.logger.info({ bucket: BUCKET_NAME }, "Opened existing activity KV bucket");
			} else {
				throw err;
			}
		}
	}

	/**
	 * Get the counter key for a project
	 */
	private getCounterKey(project: string): string {
		// Sanitize project name for NATS key (replace invalid chars)
		const sanitized = project.replace(/[^a-zA-Z0-9._-]/g, "_");
		return `${COUNTER_KEY_PREFIX}.${sanitized}`;
	}

	/**
	 * Get current counter state for a project
	 */
	private async getCounterState(project: string): Promise<ActivityCounterState> {
		if (!this.kv) {
			throw new Error("ActivityTracker not connected");
		}

		const key = this.getCounterKey(project);
		const entry = await this.kv.get(key);

		if (!entry || entry.operation === "DEL" || entry.operation === "PURGE") {
			return {
				entityCount: 0,
				memoryCount: 0,
				lastTriggerTime: 0,
				updatedAt: Date.now(),
			};
		}

		try {
			return JSON.parse(entry.string()) as ActivityCounterState;
		} catch {
			// Corrupted state, reset
			this.logger.warn({ project, key }, "Corrupted counter state, resetting");
			return {
				entityCount: 0,
				memoryCount: 0,
				lastTriggerTime: 0,
				updatedAt: Date.now(),
			};
		}
	}

	/**
	 * Update counter state for a project
	 */
	private async setCounterState(project: string, state: ActivityCounterState): Promise<void> {
		if (!this.kv) {
			throw new Error("ActivityTracker not connected");
		}

		const key = this.getCounterKey(project);
		await this.kv.put(key, JSON.stringify(state));
	}

	/**
	 * Check if cooldown period has elapsed
	 */
	private isCooldownElapsed(lastTriggerTime: number): boolean {
		const cooldownMs = this.thresholds.cooldownMinutes * 60 * 1000;
		return Date.now() - lastTriggerTime >= cooldownMs;
	}

	/**
	 * Track entity creation and trigger community detection if threshold exceeded
	 * @param project - Project identifier
	 * @param count - Number of entities created (default: 1)
	 */
	async trackEntityCreation(project: string, count = 1): Promise<void> {
		const state = await this.getCounterState(project);
		state.entityCount += count;
		state.updatedAt = Date.now();

		const shouldTrigger =
			state.entityCount >= this.thresholds.entityCreationThreshold &&
			this.isCooldownElapsed(state.lastTriggerTime);

		if (shouldTrigger) {
			this.logger.info(
				{
					project,
					entityCount: state.entityCount,
					threshold: this.thresholds.entityCreationThreshold,
				},
				"Entity creation threshold exceeded, triggering community detection",
			);

			try {
				await this.onTrigger(project, `entity_count=${state.entityCount}`);
				// Reset counter and update trigger time
				state.entityCount = 0;
				state.lastTriggerTime = Date.now();
			} catch (err) {
				this.logger.error({ err, project }, "Failed to trigger community detection");
			}
		}

		await this.setCounterState(project, state);
	}

	/**
	 * Track memory creation and trigger community detection if threshold exceeded
	 * @param project - Project identifier
	 * @param count - Number of memories created (default: 1)
	 */
	async trackMemoryCreation(project: string, count = 1): Promise<void> {
		const state = await this.getCounterState(project);
		state.memoryCount += count;
		state.updatedAt = Date.now();

		const shouldTrigger =
			state.memoryCount >= this.thresholds.memoryCreationThreshold &&
			this.isCooldownElapsed(state.lastTriggerTime);

		if (shouldTrigger) {
			this.logger.info(
				{
					project,
					memoryCount: state.memoryCount,
					threshold: this.thresholds.memoryCreationThreshold,
				},
				"Memory creation threshold exceeded, triggering community detection",
			);

			try {
				await this.onTrigger(project, `memory_count=${state.memoryCount}`);
				// Reset counter and update trigger time
				state.memoryCount = 0;
				state.lastTriggerTime = Date.now();
			} catch (err) {
				this.logger.error({ err, project }, "Failed to trigger community detection");
			}
		}

		await this.setCounterState(project, state);
	}

	/**
	 * Get current activity stats for a project (for monitoring/debugging)
	 */
	async getStats(
		project: string,
	): Promise<ActivityCounterState & { thresholds: ActivityThresholds }> {
		const state = await this.getCounterState(project);
		return {
			...state,
			thresholds: this.thresholds,
		};
	}

	/**
	 * Reset counters for a project (e.g., after manual community detection)
	 */
	async resetCounters(project: string): Promise<void> {
		const state = await this.getCounterState(project);
		state.entityCount = 0;
		state.memoryCount = 0;
		state.lastTriggerTime = Date.now();
		state.updatedAt = Date.now();
		await this.setCounterState(project, state);

		this.logger.info({ project }, "Reset activity counters");
	}

	/**
	 * Disconnect from NATS KV
	 */
	async disconnect(): Promise<void> {
		// KV doesn't need explicit disconnect - connection is managed by NatsConnection
		this.kv = null;
	}
}
