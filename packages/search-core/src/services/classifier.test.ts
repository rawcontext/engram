import { describe, expect, it } from "bun:test";
import { QueryClassifier, SearchStrategy } from "./classifier";

describe("QueryClassifier", () => {
	const classifier = new QueryClassifier();

	it("should classify quoted strings as sparse", () => {
		const result = classifier.classify('Find "exact phrase"');
		expect(result.strategy).toBe(SearchStrategy.Sparse);
		expect(result.alpha).toBeLessThan(0.5);
	});

	it("should classify code-like syntax as hybrid leaning sparse", () => {
		const result = classifier.classify("console.log('hello')");
		expect(result.strategy).toBe(SearchStrategy.Hybrid);
		expect(result.alpha).toBe(0.3);
	});

	it("should classify natural language as hybrid leaning dense", () => {
		const result = classifier.classify("how to implement login");
		expect(result.strategy).toBe(SearchStrategy.Hybrid);
		expect(result.alpha).toBe(0.7);
	});
});
