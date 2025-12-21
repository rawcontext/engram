import type { Logger } from "@engram/logger";
import { Hono } from "hono";
import { z } from "zod";
import type { UsageRepository } from "../db/usage";
import type { ApiKeyContext } from "../middleware/auth";

type Env = {
	Variables: {
		apiKey: ApiKeyContext;
	};
};

// Request schemas
const UsageQuerySchema = z.object({
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	granularity: z.enum(["summary", "detailed"]).default("summary"),
});

export interface UsageRoutesOptions {
	usageRepo: UsageRepository;
	logger: Logger;
}

export function createUsageRoutes(options: UsageRoutesOptions) {
	const { usageRepo, logger } = options;
	const app = new Hono<Env>();

	// GET /v1/usage - Get usage statistics for the authenticated API key
	app.get("/", async (c) => {
		try {
			const apiKey = c.get("apiKey") as ApiKeyContext;

			// Parse query parameters
			const queryParams = {
				startDate: c.req.query("startDate"),
				endDate: c.req.query("endDate"),
				granularity: c.req.query("granularity") ?? "summary",
			};

			const parsed = UsageQuerySchema.safeParse(queryParams);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid query parameters",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const options = {
				startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
				endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
			};

			if (parsed.data.granularity === "summary") {
				const summary = await usageRepo.getUsageSummary(apiKey.keyId, options);

				return c.json({
					success: true,
					data: {
						summary: {
							totalRequests: summary.totalRequests,
							totalErrors: summary.totalErrors,
							errorRate:
								summary.totalRequests > 0 ? summary.totalErrors / summary.totalRequests : 0,
							operations: summary.operations,
							periodStart: summary.periodStart,
							periodEnd: summary.periodEnd,
						},
					},
					meta: {
						usage: { operation: "get_usage_summary" },
					},
				});
			}

			const periods = await usageRepo.getUsageStats(apiKey.keyId, {
				...options,
				limit: 100,
			});

			return c.json({
				success: true,
				data: {
					periods: periods.map((p) => ({
						periodStart: p.periodStart,
						periodEnd: p.periodEnd,
						requestCount: p.requestCount,
						errorCount: p.errorCount,
						operations: p.operations,
					})),
				},
				meta: {
					usage: { operation: "get_usage_detailed", periodCount: periods.length },
				},
			});
		} catch (error) {
			logger.error({ error }, "Error retrieving usage statistics");
			throw error;
		}
	});

	return app;
}
