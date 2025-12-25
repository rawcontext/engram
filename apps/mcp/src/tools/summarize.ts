import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SamplingService } from "../capabilities";

export function registerSummarizeTool(server: McpServer, samplingService: SamplingService) {
	server.registerTool(
		"summarize",
		{
			title: "Summarize Text",
			description:
				"Condense long text into key points using the MCP client's LLM. Use before storing memories to create compact, searchable summaries. Also useful for: distilling verbose error logs, compressing context that exceeds limits, or creating session recaps. Requires client sampling capability - returns available=false if unsupported.",
			inputSchema: {
				text: z
					.string()
					.describe(
						"Text to condense. Works best with structured content like logs, documentation, or conversation history. Very long texts may be truncated - consider chunking inputs over 10,000 characters.",
					),
				maxWords: z
					.number()
					.int()
					.min(10)
					.max(500)
					.default(100)
					.describe(
						"Target summary length. 10-30 words for memory tags/titles. 50-100 words for memory content. 200-500 words for detailed session recaps. Actual output may vary slightly.",
					),
			},
			outputSchema: {
				summary: z.string().nullable(),
				available: z.boolean(),
			},
		},
		async ({ text, maxWords }) => {
			if (!samplingService.enabled) {
				const output = {
					summary: null,
					available: false,
				};

				return {
					content: [
						{
							type: "text" as const,
							text: "Summarization not available: client does not support sampling capability",
						},
					],
					structuredContent: output,
				};
			}

			const summary = await samplingService.summarize(text, maxWords ?? 100);

			const output = {
				summary,
				available: true,
			};

			return {
				content: [
					{
						type: "text" as const,
						text: summary ?? "Failed to generate summary",
					},
				],
				structuredContent: output,
			};
		},
	);
}
