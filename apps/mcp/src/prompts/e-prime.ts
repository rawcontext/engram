import type { GraphClient } from "@engram/storage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryRetriever } from "../services/memory-retriever";

/**
 * Format context items for display
 */
function formatContext(items: Array<{ type: string; content: string; relevance: number }>): string {
	if (items.length === 0) {
		return "No relevant context found in memory.";
	}

	return items
		.map((item, i) => {
			const relevanceLabel =
				item.relevance > 0.8 ? "HIGH" : item.relevance > 0.5 ? "MEDIUM" : "LOW";
			return `[${i + 1}] ${item.type.toUpperCase()} (${relevanceLabel} relevance):\n${item.content}`;
		})
		.join("\n\n---\n\n");
}

export function registerPrimePrompt(
	server: McpServer,
	memoryRetriever: MemoryRetriever,
	graphClient: GraphClient,
	getSessionContext: () => { project?: string; workingDir?: string },
) {
	server.registerPrompt(
		"e-prime",
		{
			title: "/e prime",
			description:
				"Load relevant context from memory for starting a new task. Retrieves related memories, decisions, and file history.",
			argsSchema: {
				task: z.string().describe("Description of the task you are starting"),
				files: z.string().optional().describe("Comma-separated list of relevant file paths"),
				depth: z
					.enum(["shallow", "medium", "deep"])
					.default("medium")
					.describe("How deeply to search for context"),
			},
		},
		async ({ task, files, depth }) => {
			const sessionContext = getSessionContext();
			const contextItems: Array<{ type: string; content: string; relevance: number }> = [];

			// Determine search limits based on depth
			const limits = {
				shallow: { memories: 3, decisions: 2, files: 2 },
				medium: { memories: 5, decisions: 3, files: 5 },
				deep: { memories: 10, decisions: 5, files: 10 },
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
				});
			}

			// 2. Search for decisions specifically
			const decisions = await memoryRetriever.recall(`decisions about ${task}`, limits.decisions, {
				type: "decision",
				project: sessionContext.project,
			});

			for (const decision of decisions) {
				// Avoid duplicates
				if (!contextItems.some((c) => c.content === decision.content)) {
					contextItems.push({
						type: "decision",
						content: decision.content,
						relevance: decision.score * 0.9, // Slightly lower to avoid overweighting
					});
				}
			}

			// 3. Get file history if files are specified
			if (files) {
				const filePaths = files.split(",").map((f) => f.trim());
				await graphClient.connect();

				for (const filePath of filePaths.slice(0, limits.files)) {
					const touches = await graphClient.query(
						`MATCH (ft:FileTouch {file_path: $filePath})
						 WHERE ft.vt_end > $now
						 RETURN ft
						 ORDER BY ft.vt_start DESC
						 LIMIT 3`,
						{ filePath, now: Date.now() },
					);

					if (Array.isArray(touches) && touches.length > 0) {
						const actions = touches.map((row) => {
							const touch = (row as { ft: { properties: { action: string } } }).ft.properties;
							return touch.action;
						});

						contextItems.push({
							type: "file_history",
							content: `File ${filePath}: Recent actions include ${actions.join(", ")}`,
							relevance: 0.7,
						});
					}
				}
			}

			// Sort by relevance
			contextItems.sort((a, b) => b.relevance - a.relevance);

			// Build the prompt message
			const projectInfo = sessionContext.project ? `\n\nProject: ${sessionContext.project}` : "";

			const formattedContext = formatContext(contextItems);

			return {
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: `I'm starting work on: ${task}${projectInfo}

## Relevant Context from Memory

${formattedContext}

---

Based on this context, please help me with the task. If there are any relevant decisions or patterns from the past, please highlight them.`,
						},
					},
				],
			};
		},
	);
}
