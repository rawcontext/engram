import { apiError, apiSuccess } from "@lib/api-response";
import { getConflictReports, getConflictStats } from "@lib/conflict-queries";
import { withAuth } from "@lib/rbac";

/**
 * List conflict reports with filtering
 * @queryParams status - Filter by status (pending_review, confirmed, dismissed, auto_resolved)
 * @queryParams project - Filter by project
 * @queryParams limit - Max conflicts to return (default 50)
 * @queryParams offset - Pagination offset (default 0)
 * @queryParams includeStats - Include stats in response (default false)
 */
export const GET = withAuth(async (request: Request) => {
	try {
		const { searchParams } = new URL(request.url);
		const status = searchParams.get("status") || undefined;
		const project = searchParams.get("project") || undefined;
		const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
		const offset = parseInt(searchParams.get("offset") || "0", 10);
		const includeStats = searchParams.get("includeStats") === "true";

		// For now, use a default org ID (in production, get from session)
		const orgId = searchParams.get("orgId") || "default";

		const { conflicts, total } = await getConflictReports({
			orgId,
			status,
			project,
			limit,
			offset,
		});

		const response: Record<string, unknown> = {
			conflicts,
			pagination: {
				total,
				limit,
				offset,
				hasMore: offset + conflicts.length < total,
			},
		};

		if (includeStats) {
			response.stats = await getConflictStats(orgId);
		}

		return apiSuccess(response);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "CONFLICTS_QUERY_FAILED");
	}
});
