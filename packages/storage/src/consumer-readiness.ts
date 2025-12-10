import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Kafka = require("@confluentinc/kafka-javascript");

/**
 * Consumer group state from Kafka Admin API.
 * Maps to librdkafka ConsumerGroupStates.
 */
export const ConsumerGroupStates = {
	UNKNOWN: 0,
	PREPARING_REBALANCE: 1,
	COMPLETING_REBALANCE: 2,
	STABLE: 3,
	DEAD: 4,
	EMPTY: 5,
} as const;

export type ConsumerGroupState = (typeof ConsumerGroupStates)[keyof typeof ConsumerGroupStates];

/**
 * Result of checking a consumer group's readiness.
 */
export interface ConsumerGroupStatus {
	groupId: string;
	state: ConsumerGroupState;
	stateName: string;
	memberCount: number;
	isReady: boolean;
}

/**
 * Configuration for waitForConsumers.
 */
export interface WaitForConsumersConfig {
	/** Consumer group IDs to wait for */
	groupIds: string[];
	/** Kafka broker addresses (default: localhost:19092) */
	brokers?: string;
	/** Maximum time to wait in ms (default: 60000) */
	timeoutMs?: number;
	/** Polling interval in ms (default: 2000) */
	pollIntervalMs?: number;
	/** Minimum number of members required per group (default: 1) */
	minMembers?: number;
	/** Optional logger function */
	logger?: (message: string) => void;
}

/**
 * Result of waitForConsumers.
 */
export interface WaitResult {
	success: boolean;
	groups: ConsumerGroupStatus[];
	elapsedMs: number;
	error?: string;
}

// Admin client wrapper type
type AdminClient = {
	connect: () => void;
	disconnect: () => void;
	listGroups: (
		options: Record<string, unknown>,
		callback: (err: Error | null, groups: unknown[]) => void,
	) => void;
	describeGroups: (
		groupIds: string[],
		options: Record<string, unknown>,
		callback: (err: Error | null, descriptions: GroupDescription[]) => void,
	) => void;
};

interface GroupDescription {
	groupId: string;
	state: ConsumerGroupState;
	members: unknown[];
	error?: { message: string };
}

/**
 * Get the string name for a consumer group state.
 */
function getStateName(state: ConsumerGroupState): string {
	const names: Record<ConsumerGroupState, string> = {
		[ConsumerGroupStates.UNKNOWN]: "UNKNOWN",
		[ConsumerGroupStates.PREPARING_REBALANCE]: "PREPARING_REBALANCE",
		[ConsumerGroupStates.COMPLETING_REBALANCE]: "COMPLETING_REBALANCE",
		[ConsumerGroupStates.STABLE]: "STABLE",
		[ConsumerGroupStates.DEAD]: "DEAD",
		[ConsumerGroupStates.EMPTY]: "EMPTY",
	};
	return names[state] ?? "UNKNOWN";
}

/**
 * Check if a consumer group is ready for message processing.
 * A group is considered ready when it's in STABLE state with at least minMembers.
 */
function isGroupReady(description: GroupDescription, minMembers: number): boolean {
	return (
		description.state === ConsumerGroupStates.STABLE && description.members.length >= minMembers
	);
}

/**
 * Create an AdminClient instance.
 */
function createAdminClient(brokers: string): AdminClient {
	const client = Kafka.AdminClient.create({
		"client.id": "consumer-readiness-checker",
		"bootstrap.servers": brokers,
	});
	return client;
}

/**
 * Describe consumer groups using the Admin API.
 */
async function describeGroups(admin: AdminClient, groupIds: string[]): Promise<GroupDescription[]> {
	return new Promise((resolve, reject) => {
		admin.describeGroups(groupIds, { timeout: 10000 }, (err, descriptions) => {
			if (err) {
				reject(err);
			} else {
				resolve(descriptions);
			}
		});
	});
}

/**
 * Wait for all specified consumer groups to be ready.
 *
 * This function polls the Kafka Admin API to check if consumer groups
 * have at least minMembers active members in a STABLE state.
 *
 * @example
 * ```ts
 * import { waitForConsumers } from "@engram/storage";
 *
 * // Wait for downstream consumers before starting producer
 * const result = await waitForConsumers({
 *   groupIds: ["memory-group", "search-group", "control-group"],
 *   timeoutMs: 30000,
 *   logger: console.log,
 * });
 *
 * if (result.success) {
 *   console.log("All consumers ready, starting ingestion...");
 *   await startIngestion();
 * } else {
 *   console.error("Consumers not ready:", result.error);
 * }
 * ```
 */
export async function waitForConsumers(config: WaitForConsumersConfig): Promise<WaitResult> {
	const {
		groupIds,
		brokers = process.env.REDPANDA_BROKERS || "localhost:19092",
		timeoutMs = 60000,
		pollIntervalMs = 2000,
		minMembers = 1,
		logger = () => {},
	} = config;

	if (groupIds.length === 0) {
		return {
			success: true,
			groups: [],
			elapsedMs: 0,
		};
	}

	const startTime = Date.now();
	let admin: AdminClient | null = null;

	try {
		admin = createAdminClient(brokers);
		admin.connect();

		logger(`[ConsumerReadiness] Waiting for consumer groups: ${groupIds.join(", ")}`);
		logger(`[ConsumerReadiness] Timeout: ${timeoutMs}ms, Poll interval: ${pollIntervalMs}ms`);

		while (Date.now() - startTime < timeoutMs) {
			try {
				const descriptions = await describeGroups(admin, groupIds);

				const statuses: ConsumerGroupStatus[] = descriptions.map((desc) => ({
					groupId: desc.groupId,
					state: desc.state,
					stateName: getStateName(desc.state),
					memberCount: desc.members?.length ?? 0,
					isReady: isGroupReady(desc, minMembers),
				}));

				// Log current status
				for (const status of statuses) {
					logger(
						`[ConsumerReadiness] Group "${status.groupId}": ${status.stateName} ` +
							`(${status.memberCount} members) - ${status.isReady ? "READY" : "NOT READY"}`,
					);
				}

				// Check if all groups are ready
				const allReady = statuses.every((s) => s.isReady);
				if (allReady) {
					const elapsedMs = Date.now() - startTime;
					logger(`[ConsumerReadiness] All consumer groups ready after ${elapsedMs}ms`);
					admin.disconnect();
					return {
						success: true,
						groups: statuses,
						elapsedMs,
					};
				}

				// Wait before next poll
				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			} catch (pollError) {
				// Log error but continue polling
				const errorMessage = pollError instanceof Error ? pollError.message : String(pollError);
				logger(`[ConsumerReadiness] Poll error (retrying): ${errorMessage}`);
				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			}
		}

		// Timeout reached
		const elapsedMs = Date.now() - startTime;
		const finalDescriptions = await describeGroups(admin, groupIds);
		const finalStatuses: ConsumerGroupStatus[] = finalDescriptions.map((desc) => ({
			groupId: desc.groupId,
			state: desc.state,
			stateName: getStateName(desc.state),
			memberCount: desc.members?.length ?? 0,
			isReady: isGroupReady(desc, minMembers),
		}));

		const notReady = finalStatuses.filter((s) => !s.isReady);
		const errorMsg = `Timeout waiting for consumer groups: ${notReady.map((s) => s.groupId).join(", ")}`;
		logger(`[ConsumerReadiness] ${errorMsg}`);

		admin.disconnect();
		return {
			success: false,
			groups: finalStatuses,
			elapsedMs,
			error: errorMsg,
		};
	} catch (error) {
		const elapsedMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger(`[ConsumerReadiness] Fatal error: ${errorMessage}`);

		if (admin) {
			try {
				admin.disconnect();
			} catch {
				// Ignore disconnect errors
			}
		}

		return {
			success: false,
			groups: [],
			elapsedMs,
			error: errorMessage,
		};
	}
}

/**
 * Check consumer group readiness without waiting.
 * Returns the current status of all specified groups.
 */
export async function checkConsumerGroups(
	groupIds: string[],
	brokers: string = process.env.REDPANDA_BROKERS || "localhost:19092",
): Promise<ConsumerGroupStatus[]> {
	if (groupIds.length === 0) {
		return [];
	}

	const admin = createAdminClient(brokers);
	admin.connect();

	try {
		const descriptions = await describeGroups(admin, groupIds);

		return descriptions.map((desc) => ({
			groupId: desc.groupId,
			state: desc.state,
			stateName: getStateName(desc.state),
			memberCount: desc.members?.length ?? 0,
			isReady: isGroupReady(desc, 1),
		}));
	} finally {
		admin.disconnect();
	}
}
