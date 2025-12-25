import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SamplingService } from "../capabilities";
import type { IEngramClient, IMemoryRetriever } from "../services/interfaces";

interface ContextItem {
	type: string;
	content: string;
	relevance: number;
	source: string;
}

export function registerContextTool(
	server: McpServer,
	memoryRetriever: IMemoryRetriever,
	client: IEngramClient,
	getSessionContext: () => { project?: string; workingDir?: string },
	samplingService?: SamplingService,
) {
	server.registerTool(
		"context",
		{
			title: "Get Context",
			description:
				"Assemble comprehensive context for a task by combining: semantic memory search, past decisions, and file modification history. Use PROACTIVELY at the START of complex tasks to prime yourself with institutional knowledge before diving in. More thorough than recall alone - automatically searches multiple dimensions and cross-references results.",
			inputSchema: {
				task: z
					.string()
					.describe(
						"Description of the task you're starting. Be specific - 'implement OAuth2 login' retrieves better context than 'add auth'. The task description is used for semantic search across all memory types.",
					),
				files: z
					.array(z.string())
					.optional()
					.describe(
						"File paths to retrieve modification history for. Useful when resuming work on specific files - shows recent changes and which sessions touched them. Use absolute paths or paths relative to project root.",
					),
				depth: z
					.enum(["shallow", "medium", "deep"])
					.default("medium")
					.describe(
						"Search thoroughness. 'shallow': Quick scan, 3 memories + 2 files - use for simple tasks or time-sensitive situations. 'medium': Balanced, 5 memories + 5 files - good default for most tasks. 'deep': Comprehensive, 10 memories + 10 files - use for complex tasks or when you need extensive background.",
					),
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
				for (const filePath of files.slice(0, limits.files)) {
					// Find recent file touches
					const touches = await client.query(
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
