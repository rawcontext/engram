import { BaseTagExtractor, type TagExtractorConfig } from "./base";

/**
 * Extractor for search/replace diff blocks in LLM output.
 *
 * Separates diff blocks (marked with `<<<<<<< SEARCH` and `>>>>>>> REPLACE`)
 * from regular response content in streaming text, handling partial marker
 * matches at chunk boundaries.
 *
 * The extracted diff content includes the markers for downstream processing.
 *
 * @example
 * ```typescript
 * const extractor = new DiffExtractor();
 *
 * const result = extractor.process(
 *   "Some text <<<<<<< SEARCH\\nold\\n=======\\nnew\\n>>>>>>> REPLACE more"
 * );
 * // result = {
 * //   content: "Some text  more",
 * //   diff: "<<<<<<< SEARCH\\nold\\n=======\\nnew\\n>>>>>>> REPLACE"
 * // }
 * ```
 */
export class DiffExtractor extends BaseTagExtractor<"diff"> {
	protected readonly config: TagExtractorConfig<"diff"> = {
		openTag: "<<<<<<< SEARCH",
		closeTag: ">>>>>>> REPLACE",
		fieldName: "diff",
		includeMarkers: true, // Include markers in diff output for downstream tools
	};
}
