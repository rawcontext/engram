import { apiError } from "@lib/api-response";
import { getSession } from "@lib/rbac";
import { NextResponse } from "next/server";

/**
 * Consumer groups to monitor.
 * These are the groups that downstream services use to consume from NATS.
 */
const CONSUMER_GROUPS = ["ingestion-group", "memory-group", "search-group", "control-group"];

/**
 * Consumer group state constants (for compatibility with existing UI).
 */
const ConsumerGroupStates = {
	UNKNOWN: 0,
	STABLE: 3,
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

/**
 * GET /api/consumers
 *
 * Returns the status of all monitored consumer groups.
 * With NATS, consumer status is tracked via Redis pub/sub heartbeats.
 * This endpoint returns a simple status based on whether services are running.
 *
 * Note: For real-time updates, use the WebSocket endpoint at /ws/consumers
 * which receives heartbeats from services via Redis pub/sub.
 */
export async function GET(): Promise<NextResponse> {
	const session = await getSession();
	if (!session) {
		return apiError("User not authenticated", "UNAUTHORIZED", 401);
	}
	// With NATS, we don't have a direct Admin API to check consumer groups.
	// Consumer status is tracked via Redis pub/sub heartbeats from services.
	// This endpoint returns unknown status - the WebSocket endpoint provides
	// real-time updates based on service heartbeats.
	const groups: ConsumerGroupStatus[] = CONSUMER_GROUPS.map((groupId) => ({
		groupId,
		state: ConsumerGroupStates.UNKNOWN,
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
