import { apiError, apiSuccess } from "@lib/api-response";
import { getConflictById, invalidateMemory, resolveConflictReport } from "@lib/conflict-queries";
import { getSession } from "@lib/rbac";

interface ResolveRequestBody {
	action: "invalidate_a" | "invalidate_b" | "keep_both" | "merge";
	reason?: string;
}

/**
 * Resolve a conflict report
 * Confirms the conflict and optionally invalidates one of the memories
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
	const session = await getSession();
	if (!session) {
		return apiError("User not authenticated", "UNAUTHORIZED", 401);
	}

	try {
		const params = await props.params;
		const body = (await request.json()) as ResolveRequestBody;

		if (!body.action) {
			return apiError("Missing action field", "VALIDATION_ERROR", 400);
		}

		const validActions = ["invalidate_a", "invalidate_b", "keep_both", "merge"];
		if (!validActions.includes(body.action)) {
			return apiError(
				`Invalid action. Must be one of: ${validActions.join(", ")}`,
				"VALIDATION_ERROR",
				400,
			);
		}

		// Get current conflict to check it exists and get memory IDs
		const existing = await getConflictById(params.id);
		if (!existing) {
			return apiError("Conflict not found", "NOT_FOUND", 404);
		}

		if (existing.status !== "pending_review") {
			return apiError(
				`Conflict has already been resolved with status: ${existing.status}`,
				"ALREADY_RESOLVED",
				400,
			);
		}

		// Get current user ID
		const reviewedBy = session?.user?.id || "unknown";

		// If action is to invalidate a memory, do so
		if (body.action === "invalidate_a") {
			await invalidateMemory(existing.memoryIdA);
		} else if (body.action === "invalidate_b") {
			await invalidateMemory(existing.memoryIdB);
		}
		// For "keep_both" and "merge", no memory invalidation needed

		// Update the conflict report
		const resolved = await resolveConflictReport(params.id, {
			status: "confirmed",
			reviewedBy,
			resolutionAction: body.action,
		});

		return apiSuccess({
			conflict: resolved,
			message: getResolutionMessage(body.action),
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "RESOLVE_FAILED");
	}
}

function getResolutionMessage(action: string): string {
	switch (action) {
		case "invalidate_a":
			return "Conflict resolved. Memory A has been invalidated.";
		case "invalidate_b":
			return "Conflict resolved. Memory B has been invalidated.";
		case "keep_both":
			return "Conflict resolved. Both memories have been kept.";
		case "merge":
			return "Conflict resolved with merge action.";
		default:
			return "Conflict resolved.";
	}
}
