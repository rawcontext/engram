import { createRequire } from "node:module";
import { NextResponse } from "next/server";

// Dynamic require for native Kafka module (avoids bundling issues in Next.js)
const require = createRequire(import.meta.url);
const Kafka = require("@confluentinc/kafka-javascript");

/**
 * Consumer groups to monitor.
 * These are the groups that downstream services use to consume from Kafka.
 */
const CONSUMER_GROUPS = ["ingestion-group", "memory-group", "search-group", "control-group"];

/**
 * Consumer group state from Kafka Admin API.
 */
const ConsumerGroupStates = {
	UNKNOWN: 0,
	PREPARING_REBALANCE: 1,
	COMPLETING_REBALANCE: 2,
	STABLE: 3,
	DEAD: 4,
	EMPTY: 5,
} as const;

type ConsumerGroupState = (typeof ConsumerGroupStates)[keyof typeof ConsumerGroupStates];

interface ConsumerGroupStatus {
	groupId: string;
	state: ConsumerGroupState;
	stateName: string;
	memberCount: number;
	isReady: boolean;
}

export interface ConsumerStatusResponse {
	groups: ConsumerGroupStatus[];
	allReady: boolean;
	readyCount: number;
	totalCount: number;
	timestamp: number;
}

// Admin client type
type AdminClient = {
	connect: () => void;
	disconnect: () => void;
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

function isGroupReady(description: GroupDescription): boolean {
	return description.state === ConsumerGroupStates.STABLE && description.members.length >= 1;
}

async function checkConsumerGroups(groupIds: string[]): Promise<ConsumerGroupStatus[]> {
	const brokers = process.env.REDPANDA_BROKERS || "localhost:19092";

	const admin: AdminClient = Kafka.AdminClient.create({
		"client.id": "consumer-readiness-checker",
		"bootstrap.servers": brokers,
	});
	admin.connect();

	try {
		const result = await new Promise<unknown>((resolve, reject) => {
			admin.describeGroups(groupIds, { timeout: 5000 }, (err, res) => {
				if (err) reject(err);
				else resolve(res);
			});
		});

		// The API may return an object with groups property or an array directly
		// Handle both cases
		let descriptions: GroupDescription[];
		if (Array.isArray(result)) {
			descriptions = result as GroupDescription[];
		} else if (result && typeof result === "object" && "groups" in result) {
			descriptions = (result as { groups: GroupDescription[] }).groups;
		} else {
			console.error("[Consumer Status API] Unexpected response format:", typeof result, result);
			throw new Error(`Unexpected response format: ${typeof result}`);
		}

		return descriptions.map((desc) => ({
			groupId: desc.groupId,
			state: desc.state,
			stateName: getStateName(desc.state),
			memberCount: desc.members?.length ?? 0,
			isReady: isGroupReady(desc),
		}));
	} finally {
		admin.disconnect();
	}
}

/**
 * GET /api/consumers
 *
 * Returns the status of all monitored consumer groups.
 * Used by the UI to show Kafka consumer readiness in the footer.
 */
export async function GET(): Promise<NextResponse<ConsumerStatusResponse>> {
	try {
		const groups = await checkConsumerGroups(CONSUMER_GROUPS);

		const readyCount = groups.filter((g) => g.isReady).length;
		const allReady = readyCount === groups.length;

		return NextResponse.json({
			groups,
			allReady,
			readyCount,
			totalCount: groups.length,
			timestamp: Date.now(),
		});
	} catch (error) {
		// If we can't connect to Kafka, return all groups as unknown
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error("[Consumer Status API] Error:", errorMessage);

		const groups: ConsumerGroupStatus[] = CONSUMER_GROUPS.map((groupId) => ({
			groupId,
			state: 0 as ConsumerGroupState, // UNKNOWN
			stateName: "UNKNOWN",
			memberCount: 0,
			isReady: false,
		}));

		return NextResponse.json({
			groups,
			allReady: false,
			readyCount: 0,
			totalCount: groups.length,
			timestamp: Date.now(),
		});
	}
}
