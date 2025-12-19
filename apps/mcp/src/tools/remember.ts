import { type MemoryType, MemoryTypeEnum } from "@engram/graph";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStore } from "../services/memory-store";

export function registerRememberTool(
	server: McpServer,
	memoryStore: MemoryStore,
	getSessionContext: () => { sessionId?: string; workingDir?: string; project?: string },
) {
	server.registerTool(
		"engram_remember",
		{
			title: "Remember",
			description: "Store information in long-term memory for later retrieval",
			inputSchema: {
				content: z.string().describe("The information to remember"),
				type: MemoryTypeEnum.optional().describe(
					"Type of memory: decision, context, insight, preference, fact",
				),
				tags: z.array(z.string()).optional().describe("Optional tags for categorization"),
			},
			outputSchema: {
				id: z.string(),
				stored: z.boolean(),
				duplicate: z.boolean().optional(),
			},
		},
		async ({ content, type, tags }) => {
			const context = getSessionContext();

			const memory = await memoryStore.createMemory({
				content,
				type: type as MemoryType | undefined,
				tags,
				project: context.project,
				workingDir: context.workingDir,
				sourceSessionId: context.sessionId,
				source: "user",
			});

			const output = {
				id: memory.id,
				stored: true,
				duplicate: false,
			};

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(output),
					},
				],
				structuredContent: output,
			};
		},
	);
}
