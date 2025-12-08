import { createFalkorClient } from "@engram/storage/falkor";
import { apiError, apiSuccess } from "@lib/api-response";
import { z } from "zod";

const falkor = createFalkorClient();

export const _ReplayParams = z.object({
	sessionId: z.string(),
});

/**
 * Get linear session history (replay)
 * @pathParams ReplayParams
 */
export async function GET(_request: Request, props: { params: Promise<{ sessionId: string }> }) {
	try {
		const params = await props.params;
		const { sessionId } = params;
		if (!sessionId) {
			return apiError("Missing sessionId", "INVALID_REQUEST", 400);
		}

		await falkor.connect();

		// Query for linear history: Session -> Thought -> Thought ...
		// We capture Thoughts and any connected ToolCalls or observations roughly in order.
		// For now, let's stick to the 'get_session_history' logic: chain of Thoughts.
		const cypher = `
            MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(first:Thought)
            MATCH p = (first)-[:NEXT*0..100]->(t:Thought)
            RETURN t
            ORDER BY t.vt_start ASC
        `;

		// biome-ignore lint/suspicious/noExplicitAny: FalkorDB unknown return
		const result: any = await falkor.query(cypher, { sessionId });

		// Transform result: FalkorDB returns named columns { t: Node }
		// We want a flat array of objects
		const timeline = [];
		if (Array.isArray(result)) {
			for (const row of result) {
				// Access by column name 't' (from RETURN t)
				const node = row.t;
				if (node && node.properties) {
					timeline.push({
						...node.properties,
						id: node.properties.id || node.id,
						type: "thought",
					});
				}
			}
		}

		return apiSuccess({ timeline });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "REPLAY_QUERY_FAILED");
	}
}
