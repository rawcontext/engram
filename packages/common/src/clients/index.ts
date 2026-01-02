/**
 * @fileoverview Client exports
 *
 * External API clients for third-party services
 *
 * @module clients
 */

export {
	createGeminiClient,
	GeminiClient,
	type GeminiClientConfig,
	GeminiError,
	type GenerateBatchOptions,
	type GenerateStructuredOutputOptions,
	type GenerateTextOptions,
} from "./gemini";
