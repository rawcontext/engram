import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SamplingService } from "../capabilities";

export function registerSummarizeTool(server: McpServer, samplingService: SamplingService) {
	server.registerTool(
		"engram_summarize",
		{
			title: "Summarize Text",
			description: "Summarize text using the client's LLM (requires sampling capability)",
			inputSchema: {
				text: z.string().describe("Text to summarize"),
				maxWords: z
					.number()
					.int()
					.min(10)
					.max(500)
					.default(100)
					.describe("Maximum number of words in summary"),
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
