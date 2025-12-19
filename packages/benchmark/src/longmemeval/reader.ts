import type { EngramDocument } from "./mapper.js";

/**
 * Configuration for the reading/answer generation stage
 */
export interface ReaderConfig {
	/** Maximum tokens for context */
	maxContextTokens: number;
	/** Whether to use Chain-of-Note (improves QA by ~10 points) */
	chainOfNote: boolean;
	/** Whether to use enhanced Chain-of-Note with multi-step reasoning */
	enhancedChainOfNote: boolean;
	/** Whether to use structured JSON format for context */
	structuredFormat: boolean;
	/** Abstention confidence threshold (0-1, lower = more abstentions) */
	abstentionThreshold: number;
	/** Whether to use calibrated confidence scoring */
	calibratedConfidence: boolean;
	/** Whether to request JSON-structured output from LLM */
	jsonOutput: boolean;
	/** Enable three-layer abstention detection (Layer 2 + 3) */
	abstentionDetection: boolean;
	/** Enable NLI-based answer grounding check (Layer 2) - requires abstentionDetection */
	abstentionNLI: boolean;
	/** NLI entailment threshold for abstention (0-1) */
	abstentionNLIThreshold: number;
}

/**
 * Default reader configuration based on LongMemEval findings
 */
export const DEFAULT_READER_CONFIG: ReaderConfig = {
	maxContextTokens: 8000,
	chainOfNote: true,
	enhancedChainOfNote: true,
	structuredFormat: true,
	abstentionThreshold: 0.3,
	calibratedConfidence: true,
	jsonOutput: true,
	abstentionDetection: false,
	abstentionNLI: false,
	abstentionNLIThreshold: 0.7,
};

/**
 * Result of reading/answer generation
 */
export interface ReadResult {
	/** Generated answer */
	hypothesis: string;
	/** Chain-of-thought reasoning (if enabled) */
	reasoning?: string;
	/** Key information extracted from context (Chain-of-Note) */
	keyInformation?: string[];
	/** Confidence score for abstention (0-1, calibrated) */
	confidence?: number;
	/** Individual confidence signals for debugging */
	confidenceSignals?: ConfidenceSignals;
	/** Whether the model chose to abstain */
	abstained: boolean;
	/** Reason for abstention from AbstentionDetector */
	abstentionReason?: "low_retrieval_score" | "no_score_gap" | "not_grounded" | "hedging_detected";
	/** Original answer before abstention (if abstained) */
	originalAnswer?: string;
}

/**
 * Individual signals used to compute calibrated confidence
 */
export interface ConfidenceSignals {
	/** Whether relevant documents were found */
	hasRelevantDocs: boolean;
	/** Relevance score of top document (0-1) */
	topDocRelevance: number;
	/** Number of documents supporting the answer */
	supportingDocCount: number;
	/** Whether the question is answerable based on context */
	questionAnswerable: boolean;
	/** LLM's self-reported confidence (if available) */
	llmConfidence?: number;
	/** Whether abstention phrases were detected */
	abstentionDetected: boolean;
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
 * Interface for AbstentionDetector from @engram/search
 */
interface AbstentionDetectorInterface {
	checkHedgingPatterns(answer: string): {
		shouldAbstain: boolean;
		reason?: string;
		confidence: number;
		details?: string;
	};
	checkAnswerGrounding(
		answer: string,
		context: string,
	): Promise<{
		shouldAbstain: boolean;
		reason?: string;
		confidence: number;
		details?: string;
	}>;
}

/**
 * Reader class that generates answers from retrieved context
 *
 * Implements Milestone 3 optimizations:
 * - Enhanced Chain-of-Note with multi-step reasoning
 * - JSON-structured prompts for better parsing
 * - Calibrated abstention confidence scoring
 * - Three-layer abstention detection (Layer 2: NLI, Layer 3: Hedging)
 */
export class Reader {
	private config: ReaderConfig;
	private llm: LLMProvider;
	private abstentionDetector: AbstentionDetectorInterface | null = null;
	private abstentionDetectorInitPromise: Promise<void> | null = null;

	constructor(llm: LLMProvider, config?: Partial<ReaderConfig>) {
		this.config = { ...DEFAULT_READER_CONFIG, ...config };
		this.llm = llm;

		// Initialize abstention detector if enabled
		if (this.config.abstentionDetection) {
			this.abstentionDetectorInitPromise = this.initAbstentionDetector();
		}
	}

	/**
	 * Initialize the AbstentionDetector from @engram/search
	 */
	private async initAbstentionDetector(): Promise<void> {
		try {
			const { AbstentionDetector } = await import("@engram/search");
			this.abstentionDetector = new AbstentionDetector({
				useNLI: this.config.abstentionNLI,
				nliThreshold: this.config.abstentionNLIThreshold,
			}) as unknown as AbstentionDetectorInterface;
		} catch (error) {
			console.warn(
				"[Reader] AbstentionDetector not available, disabling abstention detection:",
				error,
			);
			this.abstentionDetector = null;
		}
	}

	/**
	 * Generate an answer given retrieved documents and a question
	 */
	async read(
		question: string,
		documents: EngramDocument[],
		questionDate?: Date,
		retrievalScores?: number[],
	): Promise<ReadResult> {
		// Wait for abstention detector initialization if in progress
		if (this.abstentionDetectorInitPromise) {
			await this.abstentionDetectorInitPromise;
		}

		const prompt = this.buildPrompt(question, documents, questionDate);

		const response = await this.llm.complete(prompt, {
			temperature: 0.1,
			maxTokens: 1024,
		});

		const result = this.parseResponse(response.text, documents, retrievalScores);

		// Apply abstention detection (Layers 2 & 3) if enabled and detector available
		if (this.abstentionDetector && !result.abstained) {
			const abstentionResult = await this.applyAbstentionDetection(
				result.hypothesis,
				documents.map((d) => d.content).join("\n\n"),
			);

			if (abstentionResult.shouldAbstain) {
				return {
					...result,
					hypothesis: "I don't have enough information to answer this question.",
					abstained: true,
					abstentionReason: abstentionResult.reason as ReadResult["abstentionReason"],
					originalAnswer: result.hypothesis,
				};
			}
		}

		return result;
	}

	/**
	 * Apply Layer 2 (NLI) and Layer 3 (Hedging) abstention detection
	 */
	private async applyAbstentionDetection(
		answer: string,
		context: string,
	): Promise<{ shouldAbstain: boolean; reason?: string; details?: string }> {
		if (!this.abstentionDetector) {
			return { shouldAbstain: false };
		}

		// Layer 3: Hedging pattern detection (sync, fast)
		const hedgingResult = this.abstentionDetector.checkHedgingPatterns(answer);
		if (hedgingResult.shouldAbstain) {
			console.log(`  [Abstention:Hedging] ${hedgingResult.details}`);
			return hedgingResult;
		}

		// Layer 2: NLI answer grounding check (async, slower - only if NLI enabled)
		if (this.config.abstentionNLI) {
			const nliResult = await this.abstentionDetector.checkAnswerGrounding(answer, context);
			if (nliResult.shouldAbstain) {
				console.log(`  [Abstention:NLI] ${nliResult.details}`);
				return nliResult;
			}
		}

		return { shouldAbstain: false };
	}

	/**
	 * Builds the prompt for answer generation
	 */
	private buildPrompt(question: string, documents: EngramDocument[], questionDate?: Date): string {
		const context = this.config.structuredFormat
			? this.formatAsJSON(documents)
			: documents.map((d) => d.content).join("\n\n---\n\n");

		const dateContext = questionDate
			? `Today's date: ${questionDate.toISOString().split("T")[0]}\n\n`
			: "";

		if (this.config.enhancedChainOfNote) {
			return this.buildEnhancedChainOfNotePrompt(question, context, dateContext);
		}

		if (this.config.chainOfNote) {
			return this.buildChainOfNotePrompt(question, context, dateContext);
		}

		return this.buildDirectPrompt(question, context, dateContext);
	}

	/**
	 * Format documents as JSON for structured context
	 */
	private formatAsJSON(documents: EngramDocument[]): string {
		const items = documents.map((doc, idx) => ({
			index: idx + 1,
			timestamp: doc.validTime.toISOString().split("T")[0],
			role: doc.metadata.role,
			content: doc.content,
			sessionId: doc.sessionId,
		}));

		return JSON.stringify(items, null, 2);
	}

	/**
	 * Builds an enhanced Chain-of-Note prompt with multi-step reasoning
	 * Based on LongMemEval findings: +10 points QA accuracy
	 */
	private buildEnhancedChainOfNotePrompt(
		question: string,
		context: string,
		dateContext: string,
	): string {
		const outputFormat = this.config.jsonOutput
			? `Respond in JSON format:
\`\`\`json
{
  "key_information": ["fact1", "fact2", ...],
  "reasoning_steps": ["step1", "step2", ...],
  "answer": "your answer",
  "confidence": 0.0-1.0,
  "answerable": true/false
}
\`\`\``
			: `### Key Information:
(List facts from conversation relevant to the question)

### Reasoning Steps:
(Your step-by-step reasoning process)

### Confidence:
(0.0 to 1.0 - how confident are you?)

### Answerable:
(yes/no - is this answerable from the context?)

### Answer:
(Your final answer - be direct and concise)`;

		return `You are a memory assistant analyzing conversation history to answer questions.

${dateContext}## Conversation History (JSON format)

${context}

## Task

Analyze the conversation history and answer the question below.

**Step-by-step approach:**
1. EXTRACT: Identify all facts in the conversation that could be relevant to the question
2. VERIFY: Check if the extracted facts directly answer the question or if information is missing
3. REASON: If answerable, reason through the facts to derive the answer
4. CONFIDENCE: Assess your confidence (1.0 = certain from direct evidence, 0.5 = inferred, 0.0 = cannot answer)
5. ANSWER: Provide a direct, concise answer OR state you cannot answer

**Important:**
- Only use information explicitly stated in the conversation history
- If the question cannot be answered from the history, set confidence to 0 and answerable to false
- For temporal questions, pay attention to dates and time references
- For knowledge updates, use the most recent information

## Question

${question}

## Response

${outputFormat}`;
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
	 * Parses the LLM response to extract the answer with calibrated confidence
	 */
	private parseResponse(
		text: string,
		documents: EngramDocument[],
		retrievalScores?: number[],
	): ReadResult {
		// Try JSON parsing first
		const jsonResult = this.parseJsonResponse(text);
		if (jsonResult) {
			const signals = this.computeConfidenceSignals(jsonResult, documents, retrievalScores, text);
			const calibratedConfidence = this.config.calibratedConfidence
				? this.calibrateConfidence(signals)
				: (jsonResult.confidence ?? (jsonResult.answerable ? 1 : 0));

			return {
				hypothesis: jsonResult.answer,
				reasoning: jsonResult.reasoning_steps?.join(" → "),
				keyInformation: jsonResult.key_information,
				confidence: calibratedConfidence,
				confidenceSignals: signals,
				abstained: calibratedConfidence < this.config.abstentionThreshold,
			};
		}

		// Fall back to markdown parsing
		return this.parseMarkdownResponse(text, documents, retrievalScores);
	}

	/**
	 * Parse JSON-formatted response
	 */
	private parseJsonResponse(text: string): JsonResponse | null {
		try {
			// Extract JSON from markdown code blocks
			const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
			if (jsonMatch) {
				return JSON.parse(jsonMatch[1]);
			}

			// Try parsing entire response as JSON
			const directMatch = text.match(/\{[\s\S]*\}/);
			if (directMatch) {
				return JSON.parse(directMatch[0]);
			}
		} catch {
			// JSON parsing failed, fall back to markdown
		}
		return null;
	}

	/**
	 * Parse markdown-formatted response (fallback)
	 */
	private parseMarkdownResponse(
		text: string,
		documents: EngramDocument[],
		retrievalScores?: number[],
	): ReadResult {
		// Check for abstention phrases
		const abstentionPhrases = [
			"i don't have that information",
			"i do not have that information",
			"not mentioned in the conversation",
			"no information about",
			"cannot find",
			"not available in the history",
			"not present in the conversation",
			"cannot answer",
			"unable to answer",
		];

		const lowerText = text.toLowerCase();
		const abstentionDetected = abstentionPhrases.some((phrase) => lowerText.includes(phrase));

		// Extract key information
		let keyInformation: string[] | undefined;
		const keyInfoMatch = text.match(/### Key Information[:\s]*([\s\S]*?)(?:\n###|$)/i);
		if (keyInfoMatch) {
			keyInformation = keyInfoMatch[1]
				.split(/\n[-•*]\s*/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
		}

		// Extract reasoning
		let reasoning: string | undefined;
		const reasoningMatch = text.match(
			/### Reasoning(?:\s+Steps)?[:\s]*([\s\S]*?)(?:\n### (?:Answer|Confidence)|$)/i,
		);
		if (reasoningMatch) {
			reasoning = reasoningMatch[1].trim();
		}

		// Extract confidence
		let llmConfidence: number | undefined;
		const confidenceMatch = text.match(/### Confidence[:\s]*(\d*\.?\d+)/i);
		if (confidenceMatch) {
			llmConfidence = Number.parseFloat(confidenceMatch[1]);
		}

		// Extract answerable
		let questionAnswerable = true;
		const answerableMatch = text.match(/### Answerable[:\s]*(yes|no|true|false)/i);
		if (answerableMatch) {
			questionAnswerable = ["yes", "true"].includes(answerableMatch[1].toLowerCase());
		}

		// Extract answer
		let hypothesis = text;
		const answerMatch = text.match(/### Answer[:\s]*([\s\S]*?)(?:\n###|$)/i);
		if (answerMatch) {
			hypothesis = answerMatch[1].trim();
		}

		// Clean up the hypothesis
		hypothesis = hypothesis.trim();
		if (hypothesis.includes("###")) {
			hypothesis = hypothesis.split("###")[0].trim();
		}

		// Compute confidence signals
		const signals: ConfidenceSignals = {
			hasRelevantDocs: documents.length > 0,
			topDocRelevance: retrievalScores?.[0] ?? 0,
			supportingDocCount: documents.length,
			questionAnswerable,
			llmConfidence,
			abstentionDetected,
		};

		const calibratedConfidence = this.config.calibratedConfidence
			? this.calibrateConfidence(signals)
			: abstentionDetected
				? 0
				: 1;

		return {
			hypothesis,
			reasoning,
			keyInformation,
			confidence: calibratedConfidence,
			confidenceSignals: signals,
			abstained: calibratedConfidence < this.config.abstentionThreshold,
		};
	}

	/**
	 * Compute confidence signals from various sources
	 */
	private computeConfidenceSignals(
		jsonResponse: JsonResponse,
		documents: EngramDocument[],
		retrievalScores?: number[],
		rawText?: string,
	): ConfidenceSignals {
		const lowerText = (rawText ?? "").toLowerCase();
		const abstentionPhrases = [
			"cannot answer",
			"don't have",
			"do not have",
			"not available",
			"not found",
		];

		return {
			hasRelevantDocs: documents.length > 0,
			topDocRelevance: retrievalScores?.[0] ?? 0,
			supportingDocCount: documents.length,
			questionAnswerable: jsonResponse.answerable ?? true,
			llmConfidence: jsonResponse.confidence,
			abstentionDetected: abstentionPhrases.some((p) => lowerText.includes(p)),
		};
	}

	/**
	 * Calibrate confidence using multiple signals
	 *
	 * Weighted combination based on LongMemEval findings:
	 * - LLM self-reported confidence is somewhat reliable
	 * - Retrieval score indicates evidence quality
	 * - Abstention detection catches explicit uncertainty
	 */
	private calibrateConfidence(signals: ConfidenceSignals): number {
		// If abstention explicitly detected, low confidence
		if (signals.abstentionDetected) {
			return 0.1;
		}

		// If question marked as unanswerable
		if (!signals.questionAnswerable) {
			return 0.15;
		}

		// If no relevant documents retrieved
		if (!signals.hasRelevantDocs) {
			return 0.2;
		}

		// Weighted combination of signals
		const weights = {
			llmConfidence: 0.4,
			topDocRelevance: 0.3,
			docCountScore: 0.2,
			baseConfidence: 0.1,
		};

		// LLM confidence (default to 0.7 if not provided)
		const llmScore = signals.llmConfidence ?? 0.7;

		// Document relevance score (already 0-1)
		const relevanceScore = signals.topDocRelevance;

		// Document count score (more docs = higher confidence, capped)
		const docCountScore = Math.min(signals.supportingDocCount / 5, 1);

		// Base confidence (always some uncertainty)
		const baseScore = 0.5;

		const calibrated =
			weights.llmConfidence * llmScore +
			weights.topDocRelevance * relevanceScore +
			weights.docCountScore * docCountScore +
			weights.baseConfidence * baseScore;

		// Clamp to 0-1 range
		return Math.max(0, Math.min(1, calibrated));
	}
}

/**
 * JSON response structure from LLM
 */
interface JsonResponse {
	key_information?: string[];
	reasoning_steps?: string[];
	answer: string;
	confidence?: number;
	answerable?: boolean;
}

/**
 * Stub LLM provider for testing - returns JSON-formatted responses
 */
export class StubLLMProvider implements LLMProvider {
	private responses: Map<string, string> = new Map();

	/**
	 * Set a canned response for a question pattern
	 */
	setResponse(questionPattern: string, response: string): void {
		this.responses.set(questionPattern.toLowerCase(), response);
	}

	async complete(prompt: string): Promise<LLMResponse> {
		// Extract the question from the prompt
		const questionMatch = prompt.match(/## Question\s+([\s\S]*?)(?:\n##|$)/);
		const question = questionMatch?.[1]?.trim() ?? "Unknown question";
		const lowerQuestion = question.toLowerCase();

		// Check for canned responses
		for (const [pattern, response] of this.responses) {
			if (lowerQuestion.includes(pattern)) {
				return { text: response, usage: { inputTokens: 0, outputTokens: 0 } };
			}
		}

		// Default JSON response indicating unable to answer
		const jsonResponse = {
			key_information: [],
			reasoning_steps: ["No context provided", "Cannot determine answer"],
			answer: `Unable to answer: "${question}"`,
			confidence: 0.1,
			answerable: false,
		};

		return {
			text: `\`\`\`json\n${JSON.stringify(jsonResponse, null, 2)}\n\`\`\``,
			usage: { inputTokens: 0, outputTokens: 0 },
		};
	}
}

/**
 * Mock LLM provider for testing with configurable behavior
 */
export class MockLLMProvider implements LLMProvider {
	private fixedResponse: JsonResponse | null = null;
	private confidenceOverride: number | null = null;

	/**
	 * Set a fixed JSON response
	 */
	setFixedResponse(response: JsonResponse): void {
		this.fixedResponse = response;
	}

	/**
	 * Override confidence in responses
	 */
	setConfidenceOverride(confidence: number): void {
		this.confidenceOverride = confidence;
	}

	async complete(prompt: string): Promise<LLMResponse> {
		if (this.fixedResponse) {
			const response = { ...this.fixedResponse };
			if (this.confidenceOverride !== null) {
				response.confidence = this.confidenceOverride;
			}
			return {
				text: `\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``,
				usage: { inputTokens: 0, outputTokens: 0 },
			};
		}

		// Default behavior - extract question and return generic response
		const questionMatch = prompt.match(/## Question\s+([\s\S]*?)(?:\n##|$)/);
		const question = questionMatch?.[1]?.trim() ?? "Unknown question";

		const response: JsonResponse = {
			key_information: ["Extracted from context"],
			reasoning_steps: ["Analyzed the question", "Found relevant information"],
			answer: `Answer to: ${question}`,
			confidence: this.confidenceOverride ?? 0.8,
			answerable: true,
		};

		return {
			text: `\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``,
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
