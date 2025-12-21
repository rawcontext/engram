// Detect if content is a thinking/reasoning block
export function isThinkingContent(content: string): boolean {
	const thinkingPatterns = [
		/^<thought>/i,
		/^<thinking>/i,
		/^<reasoning>/i,
		/analyzing/i,
		/checking/i,
		/scanning/i,
		/querying/i,
		/simulating/i,
		/correlating/i,
		/detecting/i,
		/resolving/i,
		/validating/i,
		/generating/i,
	];
	return thinkingPatterns.some((pattern) => pattern.test(content.trim()));
}

export function cleanThinkingMarkers(content: string): string {
	return content
		.replace(/<\/?thought>/gi, "")
		.replace(/<\/?thinking>/gi, "")
		.replace(/<\/?reasoning>/gi, "")
		.trim();
}
