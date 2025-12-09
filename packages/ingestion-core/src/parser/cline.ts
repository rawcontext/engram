import type { ParserStrategy, StreamDelta } from "./interface";

/**
 * Parser for Cline CLI's `--output-format json` output.
 *
 * Cline CLI JSON events have these types:
 * - say (type="say"): Contains subtype in "say" field
 *   - say="text": User or assistant text content
 *   - say="checkpoint_created": Checkpoint event
 *   - say="api_req_started": API request with usage info in JSON text field
 *   - say="tool": Tool call event
 *   - say="api_req_finished": API request completed with usage
 */
export class ClineParser implements ParserStrategy {
	parse(payload: unknown): StreamDelta | null {
		const p = payload as Record<string, unknown>;
		const type = p.type as string;

		// Only handle "say" type events
		if (type !== "say") {
			return null;
		}

		const sayType = p.say as string;
		const text = p.text as string | undefined;

		// Handle text events (assistant content)
		if (sayType === "text") {
			if (!text) return null;

			return {
				type: "content",
				role: "assistant",
				content: text,
			};
		}

		// Handle api_req_started events (contains usage info)
		if (sayType === "api_req_started" && text) {
			try {
				const apiData = JSON.parse(text) as Record<string, unknown>;
				const tokensIn = (apiData.tokensIn as number) || 0;
				const tokensOut = (apiData.tokensOut as number) || 0;

				// Only return usage if we have actual token counts
				if (tokensIn === 0 && tokensOut === 0) return null;

				return {
					type: "usage",
					usage: {
						input: tokensIn,
						output: tokensOut,
					},
				};
			} catch {
				// Invalid JSON in text field, skip
				return null;
			}
		}

		// Handle api_req_finished events (also contains usage info)
		if (sayType === "api_req_finished" && text) {
			try {
				const apiData = JSON.parse(text) as Record<string, unknown>;
				const tokensIn = (apiData.tokensIn as number) || 0;
				const tokensOut = (apiData.tokensOut as number) || 0;

				// Only return usage if we have actual token counts
				if (tokensIn === 0 && tokensOut === 0) return null;

				return {
					type: "usage",
					usage: {
						input: tokensIn,
						output: tokensOut,
					},
				};
			} catch {
				return null;
			}
		}

		// Handle tool events
		if (sayType === "tool" && text) {
			try {
				const toolData = JSON.parse(text) as Record<string, unknown>;
				const tool = (toolData.tool as string) || "";
				const toolInput = toolData.input as Record<string, unknown> | undefined;

				return {
					type: "tool_call",
					toolCall: {
						id: (toolData.id as string) || "",
						name: tool,
						args: toolInput ? JSON.stringify(toolInput) : "{}",
						index: 0,
					},
				};
			} catch {
				return null;
			}
		}

		// Ignore other say types (checkpoint_created, etc.)
		return null;
	}
}
