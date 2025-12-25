import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IMemoryRetriever } from "../services/interfaces";

interface DecisionResult {
	id: string;
	content: string;
	score: number;
	created_at: string;
	project?: string;
}

/**
 * Format decisions for display
 */
function formatDecisions(decisions: DecisionResult[]): string {
	if (decisions.length === 0) {
		return "No decisions found matching your query.";
	}

	return decisions
		.map((decision, i) => {
			const date = new Date(decision.created_at).toLocaleDateString();
			const confidence = decision.score > 0.8 ? "High" : decision.score > 0.5 ? "Medium" : "Low";
			const projectInfo = decision.project ? ` (${decision.project})` : "";

			return `### Decision ${i + 1}${projectInfo}
**Date**: ${date} | **Confidence**: ${confidence}

${decision.content}`;
		})
		.join("\n\n---\n\n");
}

export function registerWhyPrompt(
	server: McpServer,
	memoryRetriever: IMemoryRetriever,
	getSessionContext: () => { project?: string },
) {
	server.registerPrompt(
		"decision-history",
		{
			description:
				"Find past decisions and their rationale for a topic. Use when: you're about to make an architectural choice and want to check for precedent, the user asks 'why did we...', or you encounter code that seems intentional but unclear. Returns decisions ranked by relevance with dates and confidence scores.",
			argsSchema: {
				topic: z
					.string()
					.optional()
					.describe(
						"The topic or area to search for decisions about. Be specific - 'authentication flow' works better than 'auth'. Include context words that would appear in relevant decisions.",
					),
				include_insights: z
					.boolean()
					.default(false)
					.describe(
						"Also include related insights and observations. Enable when you want broader context beyond just decisions.",
					),
				limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of results"),
			},
		},
		async ({ topic, include_insights, limit }) => {
			const sessionContext = getSessionContext();

			// Use topic or fallback to recent decisions
			const searchTopic = topic ?? "recent";

			// Search for decisions
			const decisions = await memoryRetriever.recall(`decisions about ${searchTopic}`, limit ?? 5, {
				type: "decision",
				project: sessionContext.project,
			});

			const decisionResults: DecisionResult[] = decisions.map((d) => ({
				id: d.id,
				content: d.content,
				score: d.score,
				created_at: d.created_at,
				project: d.project,
			}));

			let insightsSection = "";

			if (include_insights) {
				// Also search for insights
				const insights = await memoryRetriever.recall(`insights about ${searchTopic}`, 3, {
					type: "insight",
					project: sessionContext.project,
				});

				if (insights.length > 0) {
					insightsSection = `\n\n## Related Insights\n\n${insights
						.map((insight, i) => {
							const date = new Date(insight.created_at).toLocaleDateString();
							return `### Insight ${i + 1}
**Date**: ${date}

${insight.content}`;
						})
						.join("\n\n---\n\n")}`;
				}
			}

			const formattedDecisions = formatDecisions(decisionResults);
			const projectInfo = sessionContext.project
				? `\n\nSearching in project: ${sessionContext.project}`
				: "";

			const heading = topic ? `Past Decisions: "${topic}"` : "Recent Decisions";
			const topicRef = topic ? `"${topic}"` : "these topics";

			return {
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: `# ${heading}${projectInfo}

## Decisions Found

${formattedDecisions}${insightsSection}

---

Please analyze these decisions and:
1. Summarize the key decisions made about ${topicRef}
2. Explain the rationale behind each decision (if apparent)
3. Note any patterns or evolution in decision-making
4. Highlight if any decisions might conflict or need updating`,
						},
					},
				],
			};
		},
	);
}
