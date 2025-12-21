import type { GraphClient } from "@engram/storage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SamplingService } from "../capabilities";
import type { MemoryRetriever } from "../services/memory-retriever";

interface ContextItem {
	type: string;
	content: string;
	relevance: number;
	source: string;
}

export function registerContextTool(
	server: McpServer,
	memoryRetriever: MemoryRetriever,
	graphClient: GraphClient,
	getSessionContext: () => { project?: string; workingDir?: string },
	samplingService?: SamplingService,
) {
	server.registerTool(
		"engram_context",
		{
			title: "Get Context",
			description: "Retrieve relevant context for the current task from memory",
			inputSchema: {
				task: z.string().describe("Description of current task"),
				files: z
					.array(z.string())
					.optional()
					.describe("Relevant file paths to include context for"),
				depth: z
					.enum(["shallow", "medium", "deep"])
					.default("medium")
					.describe("How deep to search for context"),
			},
			outputSchema: {
				context: z.array(
					z.object({
						type: z.string(),
						content: z.string(),
						relevance: z.number(),
						source: z.string(),
					}),
				),
				task: z.string(),
				summary: z.string().optional(),
			},
		},
		async ({ task, files, depth }) => {
			const sessionContext = getSessionContext();
			const contextItems: ContextItem[] = [];

			// Determine search limits based on depth
			const limits = {
				shallow: { memories: 3, files: 2 },
				medium: { memories: 5, files: 5 },
				deep: { memories: 10, files: 10 },
			}[depth ?? "medium"];

			// 1. Search memories for relevant context
			const memories = await memoryRetriever.recall(task, limits.memories, {
				project: sessionContext.project,
			});

			for (const memory of memories) {
				contextItems.push({
					type: memory.type,
					content: memory.content,
					relevance: memory.score,
					source: `memory:${memory.id}`,
				});
			}

			// 2. Search file history if files are provided
			if (files && files.length > 0) {
				await graphClient.connect();

				for (const filePath of files.slice(0, limits.files)) {
					// Find recent file touches
					const touches = await graphClient.query(
						`MATCH (ft:FileTouch {file_path: $filePath})
						 RETURN ft
						 ORDER BY ft.vt_start DESC
						 LIMIT 3`,
						{ filePath },
					);

					if (Array.isArray(touches) && touches.length > 0) {
						const touch = (
							touches[0] as { ft: { properties: { action: string; diff_preview?: string } } }
						).ft.properties;
						contextItems.push({
							type: "file_history",
							content: `File ${filePath}: Last action was ${touch.action}${touch.diff_preview ? `. Changes: ${touch.diff_preview}` : ""}`,
							relevance: 0.7,
							source: `file:${filePath}`,
						});
					}
				}
			}

			// 3. Search for related decisions
			const decisions = await memoryRetriever.recall(`decisions about ${task}`, 3, {
				type: "decision",
				project: sessionContext.project,
			});

			for (const decision of decisions) {
				if (!contextItems.some((c) => c.source === `memory:${decision.id}`)) {
					contextItems.push({
						type: "decision",
						content: decision.content,
						relevance: decision.score * 0.9, // Slightly lower priority
						source: `memory:${decision.id}`,
					});
				}
			}

			// Sort by relevance
			const sortedContext = contextItems.toSorted((a, b) => b.relevance - a.relevance);

			const output = {
				context: sortedContext,
				task,
				summary: undefined as string | undefined,
			};

			// If sampling is available and we have significant context, summarize it
			if (samplingService?.enabled && contextItems.length > 3) {
				const contextText = contextItems
					.slice(0, 10)
					.map((c) => `[${c.type}] ${c.content}`)
					.join("\n\n");

				const summaryResult = await samplingService.summarize(
					`Task: ${task}\n\nContext:\n${contextText}`,
					150,
				);

				if (summaryResult) {
					output.summary = summaryResult;
				} else {
					// Fallback to simple summary
					output.summary = `Found ${contextItems.length} relevant context items including ${memories.length} memories and ${decisions.length} decisions.`;
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(output, null, 2),
					},
				],
				structuredContent: output,
			};
		},
	);
}
