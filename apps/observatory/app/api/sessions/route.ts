import { apiError, apiSuccess } from "@lib/api-response";
import { getAllSessions } from "@lib/graph-queries";
import { withAuth } from "@lib/rbac";

/**
 * List all sessions with metadata
 * @queryParams limit - Max sessions to return (default 50)
 * @queryParams offset - Pagination offset (default 0)
 */
export const GET = withAuth(async (request: Request) => {
	try {
		const { searchParams } = new URL(request.url);
		const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
		const offset = parseInt(searchParams.get("offset") || "0", 10);

		const data = await getAllSessions({ limit, offset });

		return apiSuccess({
			active: data.active,
			recent: data.recent,
			sessions: data.sessions,
			pagination: data.pagination,
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "SESSIONS_QUERY_FAILED");
	}
});
