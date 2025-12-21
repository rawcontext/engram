import { apiError, apiSuccess } from "@lib/api-response";
import { getSessionLineage } from "@lib/graph-queries";
import { z } from "zod";

export const _LineageParams = z.object({
	sessionId: z.string(),
});

export const _LineageResponse = z.object({
	nodes: z.array(z.record(z.string(), z.any())),
	links: z.array(
		z.object({
			source: z.string(),
			target: z.string(),
			type: z.string(),
			properties: z.record(z.string(), z.any()).optional(),
		}),
	),
});

/**
 * Get lineage graph for a session
 * @pathParams LineageParams
 * @response LineageResponse
 */
export async function GET(_request: Request, props: { params: Promise<{ sessionId: string }> }) {
	try {
		const params = await props.params;
		const { sessionId } = params;
		if (!sessionId) {
			return apiError("Missing sessionId", "INVALID_REQUEST", 400);
		}

		const graph = await getSessionLineage(sessionId);
		return apiSuccess(graph);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "LINEAGE_QUERY_FAILED");
	}
}
