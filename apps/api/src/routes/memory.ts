import type { Logger } from "@engram/logger";
import { Hono } from "hono";
import { z } from "zod";
import { requireScopes } from "../middleware/scopes";
import type { MemoryService } from "../services/memory";

// Request schemas
const RememberSchema = z.object({
	content: z.string().min(1).max(50000),
	type: z.enum(["decision", "context", "insight", "preference", "fact"]).optional(),
	tags: z.array(z.string()).optional(),
	project: z.string().optional(),
});

const RecallSchema = z.object({
	query: z.string().min(1).max(1000),
	limit: z.number().int().min(1).max(20).default(5),
	filters: z
		.object({
			type: z.enum(["decision", "context", "insight", "preference", "fact"]).optional(),
			project: z.string().optional(),
			after: z.string().datetime().optional(),
			before: z.string().datetime().optional(),
		})
		.optional(),
});

const QuerySchema = z.object({
	cypher: z.string().min(1).max(5000),
	params: z.record(z.string(), z.unknown()).optional(),
});

const ContextSchema = z.object({
	task: z.string().min(1).max(2000),
	files: z.array(z.string()).optional(),
	depth: z.enum(["shallow", "medium", "deep"]).default("medium"),
});

export interface MemoryRoutesOptions {
	memoryService: MemoryService;
	logger: Logger;
}

export function createMemoryRoutes(options: MemoryRoutesOptions) {
	const { memoryService, logger } = options;
	const app = new Hono();

	// POST /v1/memory/remember - Store a memory
	app.post("/remember", requireScopes("memory:write"), async (c) => {
		try {
			const body = await c.req.json();
			const parsed = RememberSchema.safeParse(body);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const result = await memoryService.remember(parsed.data);

			return c.json({
				success: true,
				data: result,
				meta: {
					usage: { operation: "remember" },
				},
			});
		} catch (error) {
			logger.error({ error }, "Error in remember endpoint");
			throw error;
		}
	});

	// POST /v1/memory/recall - Search memories
	app.post("/recall", requireScopes("memory:read"), async (c) => {
		try {
			const body = await c.req.json();
			const parsed = RecallSchema.safeParse(body);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const results = await memoryService.recall(
				parsed.data.query,
				parsed.data.limit,
				parsed.data.filters,
			);

			return c.json({
				success: true,
				data: { memories: results },
				meta: {
					usage: { operation: "recall", resultCount: results.length },
				},
			});
		} catch (error) {
			logger.error({ error }, "Error in recall endpoint");
			throw error;
		}
	});

	// POST /v1/memory/query - Execute read-only Cypher
	app.post("/query", requireScopes("query:read"), async (c) => {
		try {
			const body = await c.req.json();
			const parsed = QuerySchema.safeParse(body);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const results = await memoryService.query(parsed.data.cypher, parsed.data.params);

			return c.json({
				success: true,
				data: { results },
				meta: {
					usage: { operation: "query", resultCount: results.length },
				},
			});
		} catch (error) {
			logger.error({ error }, "Error in query endpoint");
			throw error;
		}
	});

	// POST /v1/memory/context - Get comprehensive context
	app.post("/context", requireScopes("memory:read"), async (c) => {
		try {
			const body = await c.req.json();
			const parsed = ContextSchema.safeParse(body);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const context = await memoryService.getContext(
				parsed.data.task,
				parsed.data.files,
				parsed.data.depth,
			);

			return c.json({
				success: true,
				data: { context },
				meta: {
					usage: { operation: "context", itemCount: context.length },
				},
			});
		} catch (error) {
			logger.error({ error }, "Error in context endpoint");
			throw error;
		}
	});

	return app;
}
