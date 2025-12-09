import { checkConsumerGroups, type ConsumerGroupStatus } from "@engram/storage";
import { NextResponse } from "next/server";

/**
 * Consumer groups to monitor.
 * These are the groups that downstream services use to consume from Kafka.
 */
const CONSUMER_GROUPS = [
	"ingestion-group",
	"memory-group",
	"search-group",
	"control-group",
];

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
			state: 0, // UNKNOWN
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
