import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SamplingService } from "../capabilities";

export function registerEnrichMemoryTool(server: McpServer, samplingService: SamplingService) {
	server.registerTool(
		"engram_enrich_memory",
		{
			title: "Enrich Memory",
			description:
				"Enrich a memory with summary, keywords, and category using the client's LLM (requires sampling capability)",
			inputSchema: {
				content: z.string().describe("Memory content to enrich"),
			},
			outputSchema: {
				enrichment: z
					.object({
						summary: z.string().optional(),
						keywords: z.array(z.string()).optional(),
						category: z.string().optional(),
					})
					.nullable(),
				available: z.boolean(),
			},
		},
		async ({ content }) => {
			if (!samplingService.enabled) {
				const output = {
					enrichment: null,
					available: false,
				};

				return {
					content: [
						{
							type: "text" as const,
							text: "Memory enrichment not available: client does not support sampling capability",
						},
					],
					structuredContent: output,
				};
			}

			const enrichment = await samplingService.enrichMemory(content);

			const output = {
				enrichment,
				available: true,
			};

			return {
				content: [
					{
						type: "text" as const,
						text: enrichment ? JSON.stringify(enrichment, null, 2) : "Failed to enrich memory",
					},
				],
				structuredContent: output,
			};
		},
	);
}
