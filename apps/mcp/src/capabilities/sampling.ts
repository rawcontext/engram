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
	 * Check if sampling is available
	 */
	get enabled(): boolean {
		return this._enabled;
	}

	/**
	 * Request a text completion from the client's LLM
	 */
	async createMessage(
		prompt: string,
		options: SamplingOptions = {},
	): Promise<SamplingResult | null> {
		if (!this._enabled) {
			this.logger.debug("Sampling not available, skipping createMessage");
			return null;
		}

		try {
			const response = await this.server.server.createMessage({
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

			const text = response.content.type === "text" ? response.content.text : "";

			return {
				text,
				model: response.model,
			};
		} catch (error) {
			this.logger.warn({ error }, "Sampling request failed");
			return null;
		}
	}

	/**
	 * Summarize text using the client's LLM
	 */
	async summarize(text: string, maxWords = 100): Promise<string | null> {
		const result = await this.createMessage(
			`Summarize the following text in no more than ${maxWords} words. Be concise and focus on key points:\n\n${text}`,
			{ maxTokens: Math.ceil(maxWords * 1.5), preferFast: true },
		);

		return result?.text ?? null;
	}

	/**
	 * Extract key facts from text
	 */
	async extractFacts(text: string): Promise<string[] | null> {
		const result = await this.createMessage(
			`Extract the key facts from this text as a JSON array of strings. Return only the JSON array, no other text:\n\n${text}`,
			{ maxTokens: 500, preferFast: true },
		);

		if (!result?.text) {
			return null;
		}

		try {
			// Try to parse as JSON array
			const parsed = JSON.parse(result.text);
			if (Array.isArray(parsed)) {
				return parsed.map(String);
			}
		} catch {
			// If not valid JSON, split by newlines and clean up
			return result.text
				.split("\n")
				.map((line) => line.replace(/^[-*•]\s*/, "").trim())
				.filter((line) => line.length > 0);
		}

		return null;
	}

	/**
	 * Enrich a memory with additional context
	 */
	async enrichMemory(content: string): Promise<{
		summary?: string;
		keywords?: string[];
		category?: string;
	} | null> {
		const result = await this.createMessage(
			`Analyze this memory and return a JSON object with:
- "summary": A one-sentence summary
- "keywords": An array of 3-5 keywords
- "category": One of: decision, context, insight, preference, fact

Memory content:
${content}

Return only valid JSON:`,
			{ maxTokens: 200, preferFast: true },
		);

		if (!result?.text) {
			return null;
		}

		try {
			return JSON.parse(result.text);
		} catch {
			this.logger.debug({ text: result.text }, "Failed to parse enrichment response");
			return null;
		}
	}
}
