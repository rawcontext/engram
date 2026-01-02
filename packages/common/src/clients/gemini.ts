/**
 * @fileoverview Gemini API client with structured output support
 *
 * This module provides a type-safe interface for generating structured JSON
 * responses from Google's Gemini models using Zod schemas. Built on the
 * Vercel AI SDK for standardized LLM interactions.
 *
 * @example
 * ```typescript
 * import { createGeminiClient } from "@engram/common/clients";
 * import { z } from "zod";
 *
 * const client = createGeminiClient({
 *   apiKey: process.env.GEMINI_API_KEY,
 *   model: "gemini-3-flash-preview"
 * });
 *
 * const RecipeSchema = z.object({
 *   name: z.string(),
 *   ingredients: z.array(z.string()),
 *   steps: z.array(z.string())
 * });
 *
 * const recipe = await client.generateStructuredOutput({
 *   prompt: "Create a recipe for chocolate chip cookies",
 *   schema: RecipeSchema
 * });
 * ```
 *
 * @module clients/gemini
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject, generateText } from "ai";
import type { z } from "zod";
import { EngramError } from "../errors";
import { withRetry } from "../utils";

/**
 * Configuration options for the Gemini client
 */
export interface GeminiClientConfig {
	/**
	 * Google AI API key for authentication
	 * @default process.env.GEMINI_API_KEY
	 */
	apiKey?: string;

	/**
	 * Default model to use for generation
	 * @default "gemini-3-flash-preview"
	 */
	model?: string;

	/**
	 * Maximum number of retry attempts for failed requests
	 * @default 3
	 */
	maxRetries?: number;

	/**
	 * Base delay in milliseconds for exponential backoff
	 * @default 1000
	 */
	retryDelay?: number;
}

/**
 * Options for generating structured output
 */
export interface GenerateStructuredOutputOptions<T> {
	/**
	 * The prompt to send to the model
	 */
	prompt: string;

	/**
	 * Zod schema describing the expected response structure
	 */
	schema: z.ZodSchema<T>;

	/**
	 * Override the default model for this request
	 */
	model?: string;

	/**
	 * System instruction to guide model behavior
	 */
	systemInstruction?: string;

	/**
	 * Temperature for response generation (0.0-2.0)
	 * Lower values are more deterministic
	 */
	temperature?: number;
}

/**
 * Options for generating plain text output
 */
export interface GenerateTextOptions {
	/**
	 * The prompt to send to the model
	 */
	prompt: string;

	/**
	 * Override the default model for this request
	 */
	model?: string;

	/**
	 * System instruction to guide model behavior
	 */
	systemInstruction?: string;

	/**
	 * Temperature for response generation (0.0-2.0)
	 * Lower values are more deterministic
	 */
	temperature?: number;

	/**
	 * Maximum number of tokens in the response
	 */
	maxTokens?: number;
}

/**
 * Options for batch generation
 */
export interface GenerateBatchOptions<T> {
	/**
	 * Array of prompts to process in parallel
	 */
	prompts: string[];

	/**
	 * Zod schema describing the expected response structure
	 */
	schema: z.ZodSchema<T>;

	/**
	 * Override the default model for these requests
	 */
	model?: string;

	/**
	 * System instruction to guide model behavior
	 */
	systemInstruction?: string;

	/**
	 * Temperature for response generation (0.0-2.0)
	 */
	temperature?: number;

	/**
	 * Maximum number of concurrent requests
	 * @default 5
	 */
	concurrency?: number;
}

/**
 * Error thrown when Gemini API requests fail
 */
export class GeminiError extends EngramError {
	constructor(message: string, cause?: unknown) {
		const errorCause = cause instanceof Error ? cause : undefined;
		super(message, "GEMINI_ERROR", errorCause);
	}
}

/**
 * Gemini client for generating structured outputs using Vercel AI SDK
 */
export class GeminiClient {
	private readonly google: ReturnType<typeof createGoogleGenerativeAI>;
	private readonly defaultModel: string;
	private readonly maxRetries: number;
	private readonly retryDelay: number;

	constructor(config: GeminiClientConfig = {}) {
		const apiKey = config.apiKey ?? process.env.GEMINI_API_KEY;
		if (!apiKey) {
			throw new GeminiError(
				"GEMINI_API_KEY is required. Provide it via config.apiKey or GEMINI_API_KEY environment variable.",
			);
		}

		this.google = createGoogleGenerativeAI({ apiKey });
		this.defaultModel = config.model ?? "gemini-3-flash-preview";
		this.maxRetries = config.maxRetries ?? 3;
		this.retryDelay = config.retryDelay ?? 1000;
	}

	/**
	 * Generate structured output that conforms to a Zod schema
	 *
	 * @example
	 * ```typescript
	 * const PersonSchema = z.object({
	 *   name: z.string(),
	 *   age: z.number(),
	 *   email: z.string().email()
	 * });
	 *
	 * const person = await client.generateStructuredOutput({
	 *   prompt: "Extract person info: John Doe, 30 years old, john@example.com",
	 *   schema: PersonSchema
	 * });
	 * ```
	 */
	async generateStructuredOutput<T>(options: GenerateStructuredOutputOptions<T>): Promise<T> {
		const modelName = options.model ?? this.defaultModel;

		return withRetry(
			async () => {
				try {
					const result = await generateObject({
						model: this.google(modelName),
						schema: options.schema,
						prompt: options.prompt,
						system: options.systemInstruction,
						temperature: options.temperature,
					});

					return result.object;
				} catch (error) {
					throw new GeminiError(
						`Gemini API request failed: ${error instanceof Error ? error.message : String(error)}`,
						error,
					);
				}
			},
			{
				maxRetries: this.maxRetries,
				initialDelayMs: this.retryDelay,
				onRetry: (error, attempt) => {
					console.warn(
						`[GeminiClient] Retry attempt ${attempt}/${this.maxRetries} after error:`,
						error,
					);
				},
			},
		);
	}

	/**
	 * Generate plain text output (for simple yes/no confirmations, etc.)
	 *
	 * @example
	 * ```typescript
	 * const response = await client.generateText({
	 *   prompt: "Is the sky blue? Reply YES or NO.",
	 *   maxTokens: 10
	 * });
	 * ```
	 */
	async generateText(options: GenerateTextOptions): Promise<string> {
		const modelName = options.model ?? this.defaultModel;

		return withRetry(
			async () => {
				try {
					const result = await generateText({
						model: this.google(modelName),
						prompt: options.prompt,
						system: options.systemInstruction,
						temperature: options.temperature,
						maxTokens: options.maxTokens,
					});

					return result.text;
				} catch (error) {
					throw new GeminiError(
						`Gemini API request failed: ${error instanceof Error ? error.message : String(error)}`,
						error,
					);
				}
			},
			{
				maxRetries: this.maxRetries,
				initialDelayMs: this.retryDelay,
				onRetry: (error, attempt) => {
					console.warn(
						`[GeminiClient] Retry attempt ${attempt}/${this.maxRetries} after error:`,
						error,
					);
				},
			},
		);
	}

	/**
	 * Generate structured outputs for multiple prompts in parallel
	 *
	 * @example
	 * ```typescript
	 * const SummarySchema = z.object({
	 *   summary: z.string(),
	 *   keyPoints: z.array(z.string())
	 * });
	 *
	 * const summaries = await client.generateBatch({
	 *   prompts: [
	 *     "Summarize: The quick brown fox...",
	 *     "Summarize: Lorem ipsum dolor..."
	 *   ],
	 *   schema: SummarySchema,
	 *   concurrency: 2
	 * });
	 * ```
	 */
	async generateBatch<T>(options: GenerateBatchOptions<T>): Promise<T[]> {
		const concurrency = options.concurrency ?? 5;
		const results: T[] = new Array(options.prompts.length);
		const errors: Array<{ index: number; error: unknown }> = [];

		// Process prompts in batches
		for (let i = 0; i < options.prompts.length; i += concurrency) {
			const batch = options.prompts.slice(i, i + concurrency);
			const batchPromises = batch.map(async (prompt, batchIndex) => {
				const globalIndex = i + batchIndex;
				try {
					const result = await this.generateStructuredOutput({
						prompt,
						schema: options.schema,
						model: options.model,
						systemInstruction: options.systemInstruction,
						temperature: options.temperature,
					});
					results[globalIndex] = result;
				} catch (error) {
					errors.push({ index: globalIndex, error });
				}
			});

			await Promise.all(batchPromises);
		}

		// If any requests failed, throw an error with details
		if (errors.length > 0) {
			const errorDetails = errors
				.map(
					({ index, error }) =>
						`  [${index}]: ${error instanceof Error ? error.message : String(error)}`,
				)
				.join("\n");
			throw new GeminiError(
				`Batch generation failed for ${errors.length}/${options.prompts.length} prompts:\n${errorDetails}`,
			);
		}

		return results;
	}
}

/**
 * Factory function to create a Gemini client
 *
 * @example
 * ```typescript
 * const client = createGeminiClient({
 *   apiKey: process.env.GEMINI_API_KEY,
 *   model: "gemini-3-flash-preview"
 * });
 * ```
 */
export function createGeminiClient(config?: GeminiClientConfig): GeminiClient {
	return new GeminiClient(config);
}
