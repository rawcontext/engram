import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SamplingService } from "../capabilities";

export function registerEnrichMemoryTool(server: McpServer, samplingService: SamplingService) {
	server.registerTool(
		"enrich_memory",
		{
			title: "Enrich Memory",
			description:
				"Auto-generate metadata for memory content before storing. Returns: one-line summary, searchable keywords, and suggested category (maps to memory type). Recommended workflow: call enrich_memory first, then pass the enriched metadata to remember for better future retrieval. Requires client sampling capability.",
			inputSchema: {
				content: z
					.string()
					.describe(
						"The memory content you plan to store. The LLM analyzes this to generate: a concise summary (for quick scanning), relevant keywords (for search), and a category suggestion (decision/insight/fact/preference/context). Use the output to populate remember parameters.",
					),
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
