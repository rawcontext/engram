import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SamplingService } from "../capabilities";

export function registerExtractFactsTool(server: McpServer, samplingService: SamplingService) {
	server.registerTool(
		"extract_facts",
		{
			title: "Extract Facts",
			description:
				"Parse unstructured text into discrete, atomic facts suitable for storage. Use before remember when processing: documentation, chat logs, meeting notes, or verbose command outputs. Each extracted fact can be stored and searched independently, improving retrieval precision. Requires client sampling capability.",
			inputSchema: {
				text: z
					.string()
					.describe(
						"Unstructured text containing multiple facts to extract. Works well with: documentation sections, error logs with multiple issues, conversation transcripts, or configuration explanations. Each distinct fact becomes a separate item in the output array.",
					),
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
