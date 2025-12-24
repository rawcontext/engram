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
						summary: z.string(),
						keywords: z.array(z.string()),
						category: z.string(),
					})
					.nullable(),
				available: z.boolean(),
			},
		},
		async ({ content }) => {
			if (!samplingService.enabled) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Memory enrichment not available: client does not support sampling capability",
						},
					],
					structuredContent: {
						enrichment: null,
						available: false,
					},
				};
			}

			const enrichment = await samplingService.enrichMemory(content);

			if (!enrichment) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Failed to enrich memory. No response from LLM.",
						},
					],
					structuredContent: {
						enrichment: null,
						available: true,
					},
				};
			}

			if (enrichment._raw) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to parse JSON. Raw response:\n${enrichment._raw}`,
						},
					],
					structuredContent: {
						enrichment: null,
						available: true,
					},
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(enrichment, null, 2),
					},
				],
				structuredContent: {
					enrichment: {
						summary: enrichment.summary,
						keywords: enrichment.keywords,
						category: enrichment.category,
					},
					available: true,
				},
			};
		},
	);
}
