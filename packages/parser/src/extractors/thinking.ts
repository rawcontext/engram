import { BaseTagExtractor, type TagExtractorConfig } from "./base";

/**
 * Extractor for `<thinking>...</thinking>` blocks in LLM output.
 *
 * Separates thinking/reasoning content from regular response content
 * in streaming text, handling partial tag matches at chunk boundaries.
 *
 * @example
 * ```typescript
 * const extractor = new ThinkingExtractor();
 *
 * // Process streaming chunks
 * const r1 = extractor.process("Hello <think");
 * // r1 = { content: "Hello " }
 *
 * const r2 = extractor.process("ing>I am thinking</thinking> world");
 * // r2 = { content: " world", thought: "I am thinking" }
 * ```
 */
export class ThinkingExtractor extends BaseTagExtractor<"thought"> {
	protected readonly config: TagExtractorConfig<"thought"> = {
		openTag: "<thinking>",
		closeTag: "</thinking>",
		fieldName: "thought",
		includeMarkers: false,
	};
}
