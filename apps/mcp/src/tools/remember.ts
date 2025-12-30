import { type MemoryType, MemoryTypeEnum } from "@engram/graph";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IMemoryStore } from "../services/interfaces";

export function registerRememberTool(
	server: McpServer,
	memoryStore: IMemoryStore,
	getSessionContext: () => {
		sessionId?: string;
		workingDir?: string;
		project?: string;
		orgId?: string;
		orgSlug?: string;
	},
) {
	server.registerTool(
		"remember",
		{
			title: "Remember",
			description:
				"Persist valuable information to long-term memory for future sessions. Use PROACTIVELY when you learn: user preferences, architectural decisions, project conventions, debugging insights, or facts worth preserving. Memories are searchable across sessions and survive context boundaries.",
			inputSchema: {
				content: z
					.string()
					.describe(
						"The information to store. Be specific and self-contained - this will be retrieved out of context. Include relevant details like file paths, reasoning, or constraints. Avoid storing transient information like 'working on X' - store conclusions and decisions instead.",
					),
				type: MemoryTypeEnum.optional().describe(
					"Memory classification for retrieval. 'decision': Architectural or implementation choices with rationale (e.g., 'Chose in-memory cache over distributed cache for simplicity'). 'preference': User preferences for tools, style, or workflow (e.g., 'User prefers tabs over spaces'). 'insight': Debugging discoveries or non-obvious learnings (e.g., 'The flaky test was caused by timezone assumptions'). 'fact': Objective information about codebase or domain (e.g., 'API rate limit is 100 req/min'). 'context': Background for ongoing work (e.g., 'Migration to v2 API is in progress').",
				),
				tags: z
					.array(z.string())
					.optional()
					.describe(
						"Keywords for filtering and discovery. Use lowercase, specific terms. Good: ['authentication', 'postgres', 'performance']. Avoid generic tags like ['important', 'remember'].",
					),
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
				tenant:
					context.orgId && context.orgSlug
						? { orgId: context.orgId, orgSlug: context.orgSlug }
						: undefined,
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
