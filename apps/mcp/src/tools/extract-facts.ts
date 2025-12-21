import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SamplingService } from "../capabilities";

export function registerExtractFactsTool(server: McpServer, samplingService: SamplingService) {
	server.registerTool(
		"engram_extract_facts",
		{
			title: "Extract Facts",
			description:
				"Extract key facts from text using the client's LLM (requires sampling capability)",
			inputSchema: {
				text: z.string().describe("Text to extract facts from"),
			},
			outputSchema: {
				facts: z.array(z.string()).nullable(),
				available: z.boolean(),
				count: z.number(),
			},
		},
		async ({ text }) => {
			if (!samplingService.enabled) {
				const output = {
					facts: null,
					available: false,
					count: 0,
				};

				return {
					content: [
						{
							type: "text" as const,
							text: "Fact extraction not available: client does not support sampling capability",
						},
					],
					structuredContent: output,
				};
			}

			const facts = await samplingService.extractFacts(text);

			const output = {
				facts,
				available: true,
				count: facts?.length ?? 0,
			};

			return {
				content: [
					{
						type: "text" as const,
						text: facts ? JSON.stringify(facts, null, 2) : "Failed to extract facts",
					},
				],
				structuredContent: output,
			};
		},
	);
}
