import type { LLMOptions, LLMProvider, LLMResponse } from "../reader.js";

/**
 * Configuration for the Anthropic LLM provider
 */
export interface AnthropicProviderConfig {
	/** Anthropic API key (defaults to ANTHROPIC_API_KEY env var) */
	apiKey?: string;
	/** Model to use */
	model: string;
	/** Maximum tokens for response */
	maxTokens: number;
}

const DEFAULT_CONFIG: AnthropicProviderConfig = {
	model: "claude-sonnet-4-20250514",
	maxTokens: 1024,
};

/**
 * Anthropic Claude provider for LLM operations
 *
 * Used for:
 * - Answer generation (reading stage)
 * - LLM-based evaluation (QA correctness)
 * - Fact extraction (key expansion)
 */
export class AnthropicProvider implements LLMProvider {
	private config: AnthropicProviderConfig;
	private client: AnthropicClient | null = null;

	constructor(config: Partial<AnthropicProviderConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Initialize the Anthropic client (lazy loading)
	 */
	private async getClient(): Promise<AnthropicClient> {
		if (this.client) {
			return this.client;
		}

		const apiKey = this.config.apiKey ?? process.env.ANTHROPIC_API_KEY;

		if (!apiKey) {
			throw new Error(
				"Anthropic API key required. Set ANTHROPIC_API_KEY environment variable or pass apiKey in config.",
			);
		}

		try {
			// Try to import the Anthropic SDK
			const { default: Anthropic } = await import("@anthropic-ai/sdk");
			this.client = new Anthropic({ apiKey }) as unknown as AnthropicClient;
		} catch {
			throw new Error("@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk");
		}

		return this.client;
	}

	/**
	 * Generate a completion
	 */
	async complete(prompt: string, options?: LLMOptions): Promise<LLMResponse> {
		const client = await this.getClient();

		const response = await client.messages.create({
			model: this.config.model,
			max_tokens: options?.maxTokens ?? this.config.maxTokens,
			messages: [{ role: "user", content: prompt }],
		});

		// Extract text from response
		const textContent = response.content.find((block: { type: string }) => block.type === "text") as
			| { text: string }
			| undefined;

		return {
			text: textContent?.text ?? "",
			usage: {
				inputTokens: response.usage.input_tokens,
				outputTokens: response.usage.output_tokens,
			},
		};
	}
}

/**
 * Interface for Anthropic client (to avoid importing types)
 */
interface AnthropicClient {
	messages: {
		create(params: {
			model: string;
			max_tokens: number;
			messages: Array<{ role: string; content: string }>;
		}): Promise<{
			content: Array<{ type: string; text?: string }>;
			usage: { input_tokens: number; output_tokens: number };
		}>;
	};
}

/**
 * OpenAI-compatible provider for LLM operations
 *
 * Works with OpenAI API or compatible endpoints (e.g., Ollama, vLLM)
 */
export class OpenAICompatibleProvider implements LLMProvider {
	private baseUrl: string;
	private apiKey: string;
	private model: string;

	constructor(
		config: {
			baseUrl?: string;
			apiKey?: string;
			model?: string;
		} = {},
	) {
		this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
		this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";
		this.model = config.model ?? "gpt-5-mini";
	}

	async complete(prompt: string, options?: LLMOptions): Promise<LLMResponse> {
		// GPT-5+ models use max_completion_tokens instead of max_tokens, and don't support temperature
		const isGpt5Plus = this.model.startsWith("gpt-5") || this.model.startsWith("gpt-5.");
		const maxTokensParam = isGpt5Plus ? "max_completion_tokens" : "max_tokens";

		const requestBody: Record<string, unknown> = {
			model: this.model,
			messages: [{ role: "user", content: prompt }],
			[maxTokensParam]: options?.maxTokens ?? 4096,
		};

		// GPT-5 mini doesn't support temperature parameter
		if (!isGpt5Plus) {
			requestBody.temperature = options?.temperature ?? 0.1;
		}

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorBody}`);
		}

		const data = (await response.json()) as OpenAIResponse;

		return {
			text: data.choices[0]?.message?.content ?? "",
			usage: data.usage
				? {
						inputTokens: data.usage.prompt_tokens,
						outputTokens: data.usage.completion_tokens,
					}
				: undefined,
		};
	}
}

interface OpenAIResponse {
	choices: Array<{ message?: { content?: string } }>;
	usage?: { prompt_tokens: number; completion_tokens: number };
}

/**
 * Ollama provider for local LLM operations
 */
export class OllamaProvider implements LLMProvider {
	private baseUrl: string;
	private model: string;

	constructor(config: { baseUrl?: string; model: string }) {
		this.baseUrl = config.baseUrl ?? "http://localhost:11434";
		this.model = config.model;
	}

	async complete(prompt: string, options?: LLMOptions): Promise<LLMResponse> {
		const response = await fetch(`${this.baseUrl}/api/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.model,
				prompt,
				stream: false,
				options: {
					temperature: options?.temperature ?? 0.1,
					num_predict: options?.maxTokens ?? 1024,
				},
			}),
		});

		if (!response.ok) {
			throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as OllamaResponse;

		return {
			text: data.response ?? "",
			usage: {
				inputTokens: data.prompt_eval_count ?? 0,
				outputTokens: data.eval_count ?? 0,
			},
		};
	}
}

interface OllamaResponse {
	response?: string;
	prompt_eval_count?: number;
	eval_count?: number;
}

/**
 * Google Gemini provider for LLM operations
 *
 * Uses the @google/genai SDK (recommended as of 2025)
 * Supports Gemini 2.5 Flash and other Gemini models
 */
export class GeminiProvider implements LLMProvider {
	private model: string;
	private apiKey: string;
	private client: GoogleGenAIClient | null = null;

	constructor(
		config: {
			apiKey?: string;
			model?: string;
		} = {},
	) {
		this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
		this.model = config.model ?? "gemini-3-flash";
	}

	/**
	 * Initialize the Gemini client (lazy loading)
	 */
	private async getClient(): Promise<GoogleGenAIClient> {
		if (this.client) {
			return this.client;
		}

		if (!this.apiKey) {
			throw new Error(
				"Gemini API key required. Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.",
			);
		}

		try {
			// Dynamic import to handle optional dependency
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const genaiModule = await import("@google/genai" as string);
			const GoogleGenAI = genaiModule.GoogleGenAI;
			this.client = new GoogleGenAI({ apiKey: this.apiKey }) as unknown as GoogleGenAIClient;
		} catch {
			throw new Error("@google/genai not installed. Run: npm install @google/genai");
		}

		return this.client;
	}

	async complete(prompt: string, options?: LLMOptions): Promise<LLMResponse> {
		const client = await this.getClient();

		const response = await client.models.generateContent({
			model: this.model,
			contents: prompt,
			config: {
				maxOutputTokens: options?.maxTokens ?? 4096,
				temperature: options?.temperature ?? 0.1,
			},
		});

		return {
			text: response.text ?? "",
			usage: response.usageMetadata
				? {
						inputTokens: response.usageMetadata.promptTokenCount ?? 0,
						outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
					}
				: undefined,
		};
	}
}

/**
 * Interface for GoogleGenAI client (to avoid importing types)
 */
interface GoogleGenAIClient {
	models: {
		generateContent(params: {
			model: string;
			contents: string;
			config?: {
				maxOutputTokens?: number;
				temperature?: number;
				topP?: number;
				topK?: number;
			};
		}): Promise<{
			text?: string;
			usageMetadata?: {
				promptTokenCount?: number;
				candidatesTokenCount?: number;
				totalTokenCount?: number;
			};
		}>;
	};
}
