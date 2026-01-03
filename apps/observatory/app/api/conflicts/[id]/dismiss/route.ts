import { apiError, apiSuccess } from "@lib/api-response";
import { getConflictById, resolveConflictReport } from "@lib/conflict-queries";
import { getSession } from "@lib/rbac";

interface DismissRequestBody {
	reason?: string;
}

/**
 * Dismiss a conflict report as a false positive
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
	const session = await getSession();
	if (!session) {
		return apiError("User not authenticated", "UNAUTHORIZED", 401);
	}

	try {
		const params = await props.params;
		const _body = (await request.json().catch(() => ({}))) as DismissRequestBody;

		// Get current conflict to check it exists
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

		// Update the conflict report
		const dismissed = await resolveConflictReport(params.id, {
			status: "dismissed",
			reviewedBy,
		});

		return apiSuccess({
			conflict: dismissed,
			message: "Conflict dismissed as false positive.",
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "DISMISS_FAILED");
	}
}
