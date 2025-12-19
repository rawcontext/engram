import type { StreamDelta } from "../parser/interface";

/**
 * Configuration for a tag extractor.
 */
export interface TagExtractorConfig<TField extends keyof StreamDelta> {
	/** The opening tag/marker to detect (e.g., "<thinking>" or "<<<<<<< SEARCH") */
	openTag: string;
	/** The closing tag/marker to detect (e.g., "</thinking>" or ">>>>>>> REPLACE") */
	closeTag: string;
	/** The field name in StreamDelta where extracted content is placed */
	fieldName: TField;
	/** Whether to include the markers in the extracted content (default: false) */
	includeMarkers?: boolean;
}

/**
 * Base class for extracting tagged/marked content from streaming text.
 *
 * This class implements a streaming state machine that:
 * 1. Buffers incoming chunks
 * 2. Detects start/end markers (handling partial matches at buffer boundaries)
 * 3. Separates content inside markers from content outside
 * 4. Returns a StreamDelta with the appropriate fields populated
 *
 * Subclasses provide configuration for their specific tag format.
 */
export abstract class BaseTagExtractor<TField extends keyof StreamDelta> {
	protected buffer = "";
	protected inBlock = false;

	protected abstract readonly config: TagExtractorConfig<TField>;

	/**
	 * Process a chunk of streaming text and extract tagged content.
	 *
	 * @param chunk - The next chunk of text from the stream
	 * @returns A StreamDelta with `content` (outside tags) and the configured field (inside tags)
	 */
	process(chunk: string): StreamDelta {
		this.buffer += chunk;

		let content = "";
		let extracted = "";

		while (this.buffer.length > 0) {
			if (!this.inBlock) {
				const result = this.processOutsideBlock();
				content += result.content;
				if (result.done) break;
			} else {
				const result = this.processInsideBlock();
				extracted += result.extracted;
				if (result.done) break;
			}
		}

		return this.buildDelta(content, extracted);
	}

	/**
	 * Process buffer when outside a tagged block.
	 * Looks for the opening tag and handles partial matches at buffer end.
	 */
	private processOutsideBlock(): { content: string; done: boolean } {
		const { openTag } = this.config;
		const openIndex = this.buffer.indexOf(openTag);

		if (openIndex !== -1) {
			// Found open tag - everything before is content
			const content = this.buffer.slice(0, openIndex);
			this.inBlock = true;
			this.buffer = this.buffer.slice(openIndex + openTag.length);
			return { content, done: false };
		}

		// No complete open tag found - check for partial match at end
		const partialResult = this.extractPartialMatch(openTag);
		return { content: partialResult.processed, done: true };
	}

	/**
	 * Process buffer when inside a tagged block.
	 * Looks for the closing tag and handles partial matches at buffer end.
	 */
	private processInsideBlock(): { extracted: string; done: boolean } {
		const { closeTag, includeMarkers, openTag } = this.config;
		const closeIndex = this.buffer.indexOf(closeTag);

		if (closeIndex !== -1) {
			// Found close tag
			let extracted = this.buffer.slice(0, closeIndex);
			if (includeMarkers) {
				extracted = openTag + extracted + closeTag;
			}
			this.inBlock = false;
			this.buffer = this.buffer.slice(closeIndex + closeTag.length);
			return { extracted, done: false };
		}

		// No complete close tag found - check for partial match at end
		const partialResult = this.extractPartialMatch(closeTag);
		return { extracted: partialResult.processed, done: true };
	}

	/**
	 * Check if the buffer ends with a partial match of the given tag.
	 * If so, keep the partial in buffer and return the rest as processed.
	 *
	 * Searches from longest to shortest partial match to find the maximum
	 * overlap between buffer suffix and tag prefix.
	 */
	private extractPartialMatch(tag: string): { processed: string } {
		// Search from longest to shortest to find the maximum partial match
		for (let i = tag.length - 1; i > 0; i--) {
			if (this.buffer.endsWith(tag.slice(0, i))) {
				const processed = this.buffer.slice(0, this.buffer.length - i);
				this.buffer = this.buffer.slice(this.buffer.length - i);
				return { processed };
			}
		}

		// No partial match - return entire buffer
		const processed = this.buffer;
		this.buffer = "";
		return { processed };
	}

	/**
	 * Build the StreamDelta result from processed content and extracted text.
	 */
	private buildDelta(content: string, extracted: string): StreamDelta {
		const delta: StreamDelta = {};

		if (content) {
			delta.content = content;
		}

		if (extracted) {
			// TypeScript needs help with the dynamic field assignment
			(delta as Record<string, unknown>)[this.config.fieldName] = extracted;
		}

		return delta;
	}

	/**
	 * Reset the extractor state. Useful for reusing an extractor instance.
	 */
	reset(): void {
		this.buffer = "";
		this.inBlock = false;
	}

	/**
	 * Flush remaining buffered content when stream ends.
	 * Call this when the stream closes to retrieve any content that was
	 * being buffered (e.g., unclosed tags or partial matches).
	 *
	 * @returns A StreamDelta with any remaining content
	 */
	flush(): StreamDelta {
		if (this.buffer.length === 0) {
			return {};
		}

		const delta: StreamDelta = {};

		if (this.inBlock) {
			// Inside an unclosed block - treat remaining buffer as extracted content
			(delta as Record<string, unknown>)[this.config.fieldName] = this.buffer;
		} else {
			// Outside a block - treat remaining buffer as regular content
			delta.content = this.buffer;
		}

		// Clear state
		this.buffer = "";
		this.inBlock = false;

		return delta;
	}
}
