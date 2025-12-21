import { apiError, apiSuccess } from "@lib/api-response";
import { getSessionTimeline } from "@lib/graph-queries";
import { z } from "zod";

export const _ReplayParams = z.object({
	sessionId: z.string(),
});

/**
 * Get linear session history (replay) - returns Turn nodes
 * @pathParams ReplayParams
 */
export async function GET(_request: Request, props: { params: Promise<{ sessionId: string }> }) {
	try {
		const params = await props.params;
		const { sessionId } = params;
		if (!sessionId) {
			return apiError("Missing sessionId", "INVALID_REQUEST", 400);
		}

		const data = await getSessionTimeline(sessionId);
		return apiSuccess(data);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "REPLAY_QUERY_FAILED");
	}
}
