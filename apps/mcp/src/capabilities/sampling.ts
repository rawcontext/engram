import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface SamplingOptions {
	maxTokens?: number;
	temperature?: number;
	/** Hint to use fast/cheap model */
	preferFast?: boolean;
}

export interface SamplingResult {
	text: string;
	model?: string;
}

/**
 * Wrapper for MCP sampling capability.
 * Sampling allows the server to request LLM completions from the client.
 * Only available when client has sampling capability.
 */
export class SamplingService {
	private server: McpServer;
	private logger: Logger;
	private _enabled = false;

	constructor(server: McpServer, logger: Logger) {
		this.server = server;
		this.logger = logger;
	}

	/**
	 * Enable sampling after capability negotiation confirms client support
	 */
	enable(): void {
		this._enabled = true;
		this.logger.info("Sampling capability enabled");
	}

	/**
	 * Check if sampling is available.
	 * This checks both negotiated capabilities and known client overrides.
	 */
	get enabled(): boolean {
		// Manual override
		if (this._enabled) {
			return true;
		}

		try {
			// Check negotiated capabilities from the underlying MCP server
			const clientCaps = (this.server.server as any).getClientCapabilities();
			if (clientCaps?.sampling) {
				return true;
			}

			// Fallback: check client name against known clients that support sampling
			const clientInfo = (this.server.server as any).getClientVersion();
			if (clientInfo?.name) {
				const clientName = clientInfo.name.toLowerCase();
				// VS Code Copilot and Cursor are known to support sampling
				if (
					clientName.includes("vscode") ||
					clientName.includes("code") ||
					clientName.includes("cursor")
				) {
					return true;
				}
			}
		} catch (error) {
			this.logger.debug({ error }, "Error checking client capabilities");
		}

		return false;
	}

	/**
	 * Request a text completion from the client's LLM
	 */
	async createMessage(
		prompt: string,
		options: SamplingOptions = {},
	): Promise<SamplingResult | null> {
		if (!this.enabled) {
			this.logger.debug("Sampling not available, skipping createMessage");
			return null;
		}

		try {
			// Add a timeout to the sampling request
			const timeoutMs = 30000; // 30 seconds
			const timeoutPromise = new Promise<null>((_, reject) =>
				setTimeout(() => reject(new Error("Sampling request timed out")), timeoutMs),
			);

			const samplingPromise = this.server.server.createMessage({
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: prompt,
						},
					},
				],
				maxTokens: options.maxTokens ?? 500,
				// Model preferences hint to client
				...(options.preferFast && {
					modelPreferences: {
						costPriority: 0.8,
						speedPriority: 0.8,
						intelligencePriority: 0.3,
					},
				}),
			});

			const response = (await Promise.race([samplingPromise, timeoutPromise])) as any;

			if (!response) {
				return null;
			}

			const text = response.content.type === "text" ? response.content.text : "";

			return {
				text,
				model: response.model,
			};
		} catch (error) {
			this.logger.warn({ error }, "Sampling request failed or timed out");
			return null;
		}
	}

	/**
	 * Summarize text using the client's LLM
	 */
	async summarize(text: string, maxWords = 100): Promise<string | null> {
		// Truncate input to avoid token limits/timeouts
		const truncatedText = text.length > 4000 ? `${text.substring(0, 4000)}...` : text;
		const result = await this.createMessage(
			`Summarize the following text in no more than ${maxWords} words. Be concise and focus on key points:\n\n${truncatedText}`,
			{ maxTokens: Math.ceil(maxWords * 1.5), preferFast: true },
		);

		return result?.text ?? null;
	}

	/**
	 * Extract key facts from text
	 */
	async extractFacts(text: string): Promise<string[] | null> {
		// Truncate input to avoid token limits/timeouts
		const truncatedText = text.length > 4000 ? `${text.substring(0, 4000)}...` : text;
		const result = await this.createMessage(
			`Extract the key facts from this text as a JSON array of strings. Return only the JSON array, no other text:\n\n${truncatedText}`,
			{ maxTokens: 500, preferFast: true },
		);

		if (!result?.text) {
			return null;
		}

		const parsed = this.parseJson(result.text);
		if (Array.isArray(parsed)) {
			return parsed.map(String);
		}

		// Fallback: split by newlines and clean up
		return result.text
			.split("\n")
			.map((line) => line.replace(/^[-*•]\s*/, "").trim())
			.filter((line) => line.length > 0);
	}

	/**
	 * Enrich a memory with additional context
	 */
	async enrichMemory(content: string): Promise<{
		summary: string;
		keywords: string[];
		category: string;
		_raw?: string;
	} | null> {
		// Truncate input to avoid token limits/timeouts
		const truncatedContent = content.length > 2000 ? `${content.substring(0, 2000)}...` : content;
		const result = await this.createMessage(
			`Analyze this memory and return a JSON object.
Format your response EXACTLY as a JSON code block:
\`\`\`json
{
  "summary": "one sentence summary",
  "keywords": ["key1", "key2", "key3"],
  "category": "one of: decision, context, insight, preference, fact"
}
\`\`\`

Memory content:
${truncatedContent}`,
			{ maxTokens: 300, preferFast: true },
		);

		if (!result?.text) {
			return null;
		}

		const parsed = this.parseJson(result.text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return {
				summary: String(parsed.summary || ""),
				keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
				category: String(parsed.category || "fact"),
			};
		}

		// If parsing failed, return the raw text for debugging (the tool will handle it)
		return {
			summary: "",
			keywords: [],
			category: "fact",
			_raw: result.text,
		};
	}

	/**
	 * Helper to parse JSON from LLM response, handling markdown code blocks
	 */
	private parseJson(text: string): any {
		const trimmed = text.trim();
		try {
			// Try direct parse first
			return JSON.parse(trimmed);
		} catch {
			// Try to extract from markdown code block
			const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
			if (codeBlockMatch?.[1]) {
				try {
					return JSON.parse(codeBlockMatch[1].trim());
				} catch (error) {
					this.logger.debug(
						{ text: codeBlockMatch[1], error },
						"Failed to parse JSON from markdown block",
					);
				}
			}

			// Try to find anything that looks like a JSON object or array
			try {
				const startObj = trimmed.indexOf("{");
				const endObj = trimmed.lastIndexOf("}");
				if (startObj !== -1 && endObj !== -1 && endObj > startObj) {
					const potentialJson = trimmed.substring(startObj, endObj + 1);
					return JSON.parse(potentialJson);
				}

				const startArr = trimmed.indexOf("[");
				const endArr = trimmed.lastIndexOf("]");
				if (startArr !== -1 && endArr !== -1 && endArr > startArr) {
					const potentialJson = trimmed.substring(startArr, endArr + 1);
					return JSON.parse(potentialJson);
				}
			} catch (error) {
				this.logger.debug({ text, error }, "Failed to extract JSON from text");
			}

			return null;
		}
	}
}
