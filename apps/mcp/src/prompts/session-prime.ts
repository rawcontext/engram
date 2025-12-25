import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IEngramClient, IMemoryRetriever } from "../services/interfaces";

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
	memoryRetriever: IMemoryRetriever,
	client: IEngramClient,
	getSessionContext: () => { project?: string; workingDir?: string },
) {
	server.registerPrompt(
		"session-prime",
		{
			title: "Prime Session",
			description:
				"Initialize a work session with relevant context from memory. Retrieves: semantic matches to your task, related past decisions, and recent file modification history. Use this at the START of any significant task - especially when resuming previous work, working on files you've touched before, or making decisions that might have prior art.",
			argsSchema: {
				task: z
					.string()
					.optional()
					.describe(
						"Description of the task you're starting. Be specific - 'implement OAuth2 login' retrieves better context than 'add auth'. This is used for semantic search across all memory types.",
					),
				files: z
					.string()
					.optional()
					.describe(
						"Comma-separated list of relevant file paths to retrieve modification history for. Useful when resuming work on specific files.",
					),
				depth: z
					.enum(["shallow", "medium", "deep"])
					.default("medium")
					.describe(
						"Search thoroughness. 'shallow': Quick scan, 3 memories + 2 files. 'medium': Balanced, 5 memories + 5 files (default). 'deep': Comprehensive, 10 memories + 10 files.",
					),
			},
		},
		async ({ task, files, depth }) => {
			const sessionContext = getSessionContext();
			const contextItems: Array<{ type: string; content: string; relevance: number }> = [];

			// Use task or fallback to generic recent context query
			const searchQuery = task ?? "recent work and context";

			// Determine search limits based on depth
			const limits = {
				shallow: { memories: 3, decisions: 2, files: 2 },
				medium: { memories: 5, decisions: 3, files: 5 },
				deep: { memories: 10, decisions: 5, files: 10 },
			}[depth ?? "medium"];

			// 1. Search memories for relevant context
			const memories = await memoryRetriever.recall(searchQuery, limits.memories, {
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
			const decisions = await memoryRetriever.recall(
				`decisions about ${searchQuery}`,
				limits.decisions,
				{
					type: "decision",
					project: sessionContext.project,
				},
			);

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

				for (const filePath of filePaths.slice(0, limits.files)) {
					const touches = await client.query(
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
			const sortedContext = contextItems.toSorted((a, b) => b.relevance - a.relevance);

			// Build the prompt message
			const projectInfo = sessionContext.project ? `\n\nProject: ${sessionContext.project}` : "";

			const formattedContext = formatContext(sortedContext);

			const taskDescription = task ? `I'm starting work on: ${task}` : "Starting a new session";

			return {
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: `${taskDescription}${projectInfo}

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
