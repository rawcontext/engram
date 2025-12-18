import type { EngramDocument } from "./mapper.js";
import { formatDocumentsForContext } from "./mapper.js";

/**
 * Configuration for the reading/answer generation stage
 */
export interface ReaderConfig {
	/** Maximum tokens for context */
	maxContextTokens: number;
	/** Whether to use Chain-of-Note (improves QA by ~10 points) */
	chainOfNote: boolean;
	/** Whether to use structured JSON format for context */
	structuredFormat: boolean;
	/** Abstention confidence threshold */
	abstentionThreshold: number;
}

/**
 * Default reader configuration based on LongMemEval findings
 */
export const DEFAULT_READER_CONFIG: ReaderConfig = {
	maxContextTokens: 8000,
	chainOfNote: true,
	structuredFormat: true,
	abstentionThreshold: 0.3,
};

/**
 * Result of reading/answer generation
 */
export interface ReadResult {
	/** Generated answer */
	hypothesis: string;
	/** Chain-of-thought reasoning (if enabled) */
	reasoning?: string;
	/** Confidence score for abstention */
	confidence?: number;
	/** Whether the model chose to abstain */
	abstained: boolean;
}

/**
 * Interface for LLM providers
 */
export interface LLMProvider {
	/** Generate a completion */
	complete(prompt: string, options?: LLMOptions): Promise<LLMResponse>;
}

export interface LLMOptions {
	temperature?: number;
	maxTokens?: number;
	stopSequences?: string[];
}

export interface LLMResponse {
	text: string;
	usage?: {
		inputTokens: number;
		outputTokens: number;
	};
}

/**
 * Reader class that generates answers from retrieved context
 */
export class Reader {
	private config: ReaderConfig;
	private llm: LLMProvider;

	constructor(llm: LLMProvider, config?: Partial<ReaderConfig>) {
		this.config = { ...DEFAULT_READER_CONFIG, ...config };
		this.llm = llm;
	}

	/**
	 * Generate an answer given retrieved documents and a question
	 */
	async read(
		question: string,
		documents: EngramDocument[],
		questionDate?: Date,
	): Promise<ReadResult> {
		const prompt = this.buildPrompt(question, documents, questionDate);

		const response = await this.llm.complete(prompt, {
			temperature: 0.1,
			maxTokens: 1024,
		});

		return this.parseResponse(response.text);
	}

	/**
	 * Builds the prompt for answer generation
	 */
	private buildPrompt(question: string, documents: EngramDocument[], questionDate?: Date): string {
		const context = this.config.structuredFormat
			? formatDocumentsForContext(documents, { includeTimestamp: true })
			: documents.map((d) => d.content).join("\n\n---\n\n");

		const dateContext = questionDate
			? `Today's date: ${questionDate.toISOString().split("T")[0]}\n\n`
			: "";

		if (this.config.chainOfNote) {
			return this.buildChainOfNotePrompt(question, context, dateContext);
		}

		return this.buildDirectPrompt(question, context, dateContext);
	}

	/**
	 * Builds a Chain-of-Note prompt (recommended by LongMemEval)
	 */
	private buildChainOfNotePrompt(question: string, context: string, dateContext: string): string {
		return `You are a helpful assistant with access to conversation history.

${dateContext}## Retrieved Conversation History

${context}

## Task

Based on the conversation history above, answer the following question.

**Important Instructions:**
1. First, extract the key information from the conversation history that is relevant to the question.
2. Then, reason step by step to arrive at your answer.
3. If the information needed to answer the question is not present in the history, respond with "I don't have that information."
4. Be concise and direct in your final answer.

## Question

${question}

## Response

### Key Information Extracted:
(List the relevant facts from the conversation history)

### Reasoning:
(Your step-by-step reasoning)

### Answer:
(Your final answer - be direct and concise)`;
	}

	/**
	 * Builds a direct prompt without Chain-of-Note
	 */
	private buildDirectPrompt(question: string, context: string, dateContext: string): string {
		return `You are a helpful assistant with access to conversation history.

${dateContext}## Retrieved Conversation History

${context}

## Question

${question}

## Instructions

Answer the question based on the conversation history above.
If the information is not available in the history, respond with "I don't have that information."
Be concise and direct.

## Answer:`;
	}

	/**
	 * Parses the LLM response to extract the answer
	 */
	private parseResponse(text: string): ReadResult {
		// Check for abstention
		const abstentionPhrases = [
			"i don't have that information",
			"i do not have that information",
			"not mentioned in the conversation",
			"no information about",
			"cannot find",
			"not available in the history",
			"not present in the conversation",
		];

		const lowerText = text.toLowerCase();
		const abstained = abstentionPhrases.some((phrase) => lowerText.includes(phrase));

		// Extract answer from Chain-of-Note format
		let hypothesis = text;
		let reasoning: string | undefined;

		const answerMatch = text.match(/### Answer:\s*([\s\S]*?)(?:\n###|$)/i);
		if (answerMatch) {
			hypothesis = answerMatch[1].trim();
		}

		const reasoningMatch = text.match(/### Reasoning:\s*([\s\S]*?)(?:\n### Answer:|$)/i);
		if (reasoningMatch) {
			reasoning = reasoningMatch[1].trim();
		}

		// Clean up the hypothesis
		hypothesis = hypothesis.trim();

		// If still has markdown headers, take first paragraph
		if (hypothesis.includes("###")) {
			hypothesis = hypothesis.split("###")[0].trim();
		}

		return {
			hypothesis,
			reasoning,
			abstained,
			confidence: abstained ? 0 : 1, // Simple binary confidence
		};
	}
}

/**
 * Stub LLM provider for testing
 */
export class StubLLMProvider implements LLMProvider {
	async complete(prompt: string): Promise<LLMResponse> {
		// For testing, just echo the question from the prompt
		const questionMatch = prompt.match(/## Question\s+([\s\S]*?)(?:\n##|$)/);
		const question = questionMatch?.[1]?.trim() ?? "Unknown question";

		return {
			text: `### Answer:\nI cannot answer "${question}" without a real LLM provider configured.`,
			usage: { inputTokens: 0, outputTokens: 0 },
		};
	}
}

/**
 * Simple embedding provider for testing (random embeddings)
 */
export class StubEmbeddingProvider {
	readonly dimension = 384;

	async embed(texts: string[]): Promise<number[][]> {
		// Generate deterministic pseudo-random embeddings based on text hash
		return texts.map((text) => {
			const seed = hashString(text);
			return Array.from({ length: this.dimension }, (_, i) => seededRandom(seed + i));
		});
	}
}

/**
 * Simple string hash function
 */
function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return Math.abs(hash);
}

/**
 * Seeded random number generator
 */
function seededRandom(seed: number): number {
	const x = Math.sin(seed) * 10000;
	return x - Math.floor(x);
}
