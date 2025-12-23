import { createNodeLogger } from "@engram/logger";
import type { ParserStrategy, StreamDelta } from "./interface";
import { ClineApiDataSchema, ClineSayEventSchema, ClineToolDataSchema } from "./schemas";

const logger = createNodeLogger({
	service: "engram-parser",
	base: { component: "ClineParser" },
});

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
		// Validate the outer event structure
		const parseResult = ClineSayEventSchema.safeParse(payload);
		if (!parseResult.success) {
			return null;
		}

		const data = parseResult.data;

		// Only handle "say" type events
		if (data.type !== "say") {
			return null;
		}

		const sayType = data.say;
		const text = data.text;

		// Handle text events (assistant content)
		if (sayType === "text") {
			if (!text) return null;

			return {
				type: "content",
				role: "assistant",
				content: text,
			};
		}

		// Handle api_req_started events (contains usage info with cache metrics and cost)
		if (sayType === "api_req_started" && text) {
			try {
				const parsedApiData = JSON.parse(text);
				const apiResult = ClineApiDataSchema.safeParse(parsedApiData);
				if (!apiResult.success) {
					logger.warn(
						{ errors: apiResult.error.issues, text },
						"Failed to parse api_req_started data",
					);
					return null;
				}
				const apiData = apiResult.data;
				const tokensIn = apiData.tokensIn || 0;
				const tokensOut = apiData.tokensOut || 0;

				// Only return usage if we have actual token counts
				if (tokensIn === 0 && tokensOut === 0) return null;

				const delta: StreamDelta = {
					type: "usage",
					usage: {
						input: tokensIn,
						output: tokensOut,
						cacheRead: apiData.cacheReads || 0,
						cacheWrite: apiData.cacheWrites || 0,
					},
				};

				// Extract cost if present
				if (apiData.cost !== undefined && apiData.cost !== 0) {
					delta.cost = apiData.cost;
				}

				return delta;
			} catch (error) {
				logger.warn({ error, text }, "Failed to parse JSON in api_req_started event");
				return null;
			}
		}

		// Handle api_req_finished events (also contains usage info with cache and cost)
		if (sayType === "api_req_finished" && text) {
			try {
				const parsedApiData = JSON.parse(text);
				const apiResult = ClineApiDataSchema.safeParse(parsedApiData);
				if (!apiResult.success) {
					logger.warn(
						{ errors: apiResult.error.issues, text },
						"Failed to parse api_req_finished data",
					);
					return null;
				}
				const apiData = apiResult.data;
				const tokensIn = apiData.tokensIn || 0;
				const tokensOut = apiData.tokensOut || 0;

				// Only return usage if we have actual token counts
				if (tokensIn === 0 && tokensOut === 0) return null;

				const delta: StreamDelta = {
					type: "usage",
					usage: {
						input: tokensIn,
						output: tokensOut,
						cacheRead: apiData.cacheReads || 0,
						cacheWrite: apiData.cacheWrites || 0,
					},
				};

				// Extract cost if present
				if (apiData.cost !== undefined && apiData.cost !== 0) {
					delta.cost = apiData.cost;
				}

				return delta;
			} catch (error) {
				logger.warn({ error, text }, "Failed to parse JSON in api_req_finished event");
				return null;
			}
		}

		// Handle tool events
		if (sayType === "tool" && text) {
			try {
				const parsedToolData = JSON.parse(text);
				const toolResult = ClineToolDataSchema.safeParse(parsedToolData);
				if (!toolResult.success) {
					logger.warn({ errors: toolResult.error.issues, text }, "Failed to parse tool event data");
					return null;
				}
				const toolData = toolResult.data;
				const tool = toolData.tool || "";
				const toolInput = toolData.input;

				return {
					type: "tool_call",
					toolCall: {
						id: toolData.id || "",
						name: tool,
						args: toolInput ? JSON.stringify(toolInput) : "{}",
						index: 0,
					},
				};
			} catch (error) {
				logger.warn({ error, text }, "Failed to parse JSON in tool event");
				return null;
			}
		}

		// Ignore other say types (checkpoint_created, etc.)
		return null;
	}
}
