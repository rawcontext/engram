import { createLogger } from "@engram/logger";
import type { z } from "zod";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface ChatOptions {
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	seed?: number;
}

export interface XAIClientOptions {
	/** xAI API key - defaults to XAI_API_KEY env var */
	apiKey?: string;
	/** Model to use - defaults to grok-4-1-fast-reasoning */
	model?: string;
	/** Request timeout in milliseconds - defaults to 30000ms */
	timeout?: number;
	/** Base URL for xAI API - defaults to https://api.x.ai/v1 */
	baseUrl?: string;
	/** Maximum retry attempts - defaults to 3 */
	maxRetries?: number;
}

interface XAIAPIResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: {
			role: string;
			content: string;
		};
		finish_reason: string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

interface XAIErrorResponse {
	error: {
		message: string;
		type: string;
		code?: string;
	};
}

/**
 * XAI API client for Grok models via xAI API.
 *
 * Features:
 * - Async API calls with retry logic
 * - Rate limiting awareness
 * - Error handling (rate limits, timeouts, API errors)
 * - Cost tracking per query
 * - JSON schema validation using Zod
 *
 * @example
 * ```ts
 * const client = new XAIClient({ apiKey: "..." });
 * const response = await client.chat([
 *   { role: "user", content: "Rank these documents..." }
 * ]);
 * ```
 */
export class XAIClient {
	private apiKey: string;
	private model: string;
	private timeout: number;
	private baseUrl: string;
	private maxRetries: number;
	private logger = createLogger({ component: "XAIClient" });
	private totalCostCents = 0;
	private totalTokens = 0;

	constructor(options: XAIClientOptions = {}) {
		this.apiKey = options.apiKey ?? process.env.XAI_API_KEY ?? "";
		this.model = options.model ?? "grok-4-1-fast-reasoning";
		this.timeout = options.timeout ?? 30000;
		this.baseUrl = options.baseUrl ?? "https://api.x.ai/v1";
		this.maxRetries = options.maxRetries ?? 3;

		if (!this.apiKey) {
			this.logger.warn({
				msg: "XAI_API_KEY not set - API calls will fail",
			});
		}
	}

	/**
	 * Send a chat completion request to xAI API.
	 *
	 * @param messages - Array of chat messages
	 * @param options - Optional chat parameters
	 * @returns The assistant's response content
	 */
	async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
		const startTime = Date.now();

		this.logger.debug({
			msg: "Chat request started",
			model: this.model,
			messageCount: messages.length,
		});

		try {
			const response = await this.makeRequest<XAIAPIResponse>("/chat/completions", {
				model: this.model,
				messages,
				temperature: options?.temperature ?? 0.0,
				max_tokens: options?.maxTokens ?? 2000,
				top_p: options?.topP,
				seed: options?.seed,
			});

			const content = response.choices[0]?.message?.content ?? "";
			const latencyMs = Date.now() - startTime;

			// Track usage and cost
			if (response.usage) {
				this.totalTokens += response.usage.total_tokens;
				// Cost estimation for grok-4-1-fast-reasoning (example rates)
				// Input: $5/1M tokens, Output: $15/1M tokens
				const costCents =
					(response.usage.prompt_tokens / 1_000_000) * 500 +
					(response.usage.completion_tokens / 1_000_000) * 1500;
				this.totalCostCents += costCents;

				this.logger.info({
					msg: "Chat request completed",
					model: this.model,
					latencyMs,
					promptTokens: response.usage.prompt_tokens,
					completionTokens: response.usage.completion_tokens,
					totalTokens: response.usage.total_tokens,
					costCents: costCents.toFixed(4),
				});
			}

			return content;
		} catch (error) {
			const latencyMs = Date.now() - startTime;
			this.logger.error({
				msg: "Chat request failed",
				model: this.model,
				latencyMs,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Send a chat completion request and parse JSON response.
	 *
	 * @param messages - Array of chat messages
	 * @param schema - Zod schema to validate response against
	 * @returns Parsed and validated response
	 */
	async chatJSON<T>(messages: ChatMessage[], schema: z.ZodSchema<T>): Promise<T> {
		const content = await this.chat(messages);

		try {
			// Try to extract JSON from markdown code blocks if present
			const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
			const jsonStr = jsonMatch ? jsonMatch[1] : content;

			const parsed = JSON.parse(jsonStr);
			const validated = schema.parse(parsed);

			this.logger.debug({
				msg: "JSON response parsed and validated",
				model: this.model,
			});

			return validated;
		} catch (error) {
			this.logger.error({
				msg: "Failed to parse JSON response",
				model: this.model,
				content: content.slice(0, 500), // Log first 500 chars for debugging
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(
				`Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Make HTTP request to xAI API with retry logic.
	 */
	private async makeRequest<T>(endpoint: string, body: unknown, retryCount = 0): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`;

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this.timeout);

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const errorData = (await response.json()) as XAIErrorResponse;
				const errorMessage = errorData.error?.message ?? "Unknown API error";
				const errorType = errorData.error?.type ?? "unknown";

				// Handle rate limiting with retry
				if (response.status === 429 && retryCount < this.maxRetries) {
					const retryAfter = response.headers.get("Retry-After");
					const delayMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 2000;

					this.logger.warn({
						msg: "Rate limited - retrying after delay",
						retryCount,
						delayMs,
					});

					await this.sleep(delayMs);
					return this.makeRequest<T>(endpoint, body, retryCount + 1);
				}

				// Handle server errors with exponential backoff retry
				if (response.status >= 500 && retryCount < this.maxRetries) {
					const delayMs = 2 ** retryCount * 1000; // Exponential backoff

					this.logger.warn({
						msg: "Server error - retrying with exponential backoff",
						status: response.status,
						retryCount,
						delayMs,
					});

					await this.sleep(delayMs);
					return this.makeRequest<T>(endpoint, body, retryCount + 1);
				}

				throw new Error(`xAI API error (${response.status}): ${errorType} - ${errorMessage}`);
			}

			const data = (await response.json()) as T;
			return data;
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(`xAI API request timeout after ${this.timeout}ms`);
			}

			// Retry on network errors
			if (retryCount < this.maxRetries && this.isNetworkError(error)) {
				const delayMs = 2 ** retryCount * 1000;

				this.logger.warn({
					msg: "Network error - retrying with exponential backoff",
					retryCount,
					delayMs,
					error: error instanceof Error ? error.message : String(error),
				});

				await this.sleep(delayMs);
				return this.makeRequest<T>(endpoint, body, retryCount + 1);
			}

			throw error;
		}
	}

	/**
	 * Check if error is a network error that should be retried.
	 */
	private isNetworkError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;

		const networkErrorMessages = [
			"fetch failed",
			"ECONNREFUSED",
			"ENOTFOUND",
			"ETIMEDOUT",
			"ECONNRESET",
		];

		return networkErrorMessages.some((msg) =>
			error.message.toLowerCase().includes(msg.toLowerCase()),
		);
	}

	/**
	 * Sleep for specified milliseconds.
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Get total cost in cents for all API calls made by this client instance.
	 */
	getTotalCost(): number {
		return this.totalCostCents;
	}

	/**
	 * Get total tokens used for all API calls made by this client instance.
	 */
	getTotalTokens(): number {
		return this.totalTokens;
	}

	/**
	 * Reset cost and token counters.
	 */
	resetCounters(): void {
		this.totalCostCents = 0;
		this.totalTokens = 0;
	}
}
