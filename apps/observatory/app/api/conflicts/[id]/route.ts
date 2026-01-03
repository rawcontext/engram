import { apiError, apiSuccess } from "@lib/api-response";
import { getConflictById } from "@lib/conflict-queries";
import { getSession } from "@lib/rbac";

/**
 * Get a single conflict report by ID
 */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
	const session = await getSession();
	if (!session) {
		return apiError("User not authenticated", "UNAUTHORIZED", 401);
	}

	try {
		const params = await props.params;
		const conflict = await getConflictById(params.id);

		if (!conflict) {
			return apiError("Conflict not found", "NOT_FOUND", 404);
		}

		return apiSuccess({ conflict });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "CONFLICT_QUERY_FAILED");
	}
}
