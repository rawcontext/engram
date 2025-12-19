import { describe, expect, it } from "vitest";
import { RerankerRouter } from "./reranker-router";

describe("RerankerRouter", () => {
	const router = new RerankerRouter();

	describe("route()", () => {
		describe("forceTier option", () => {
			it("should use forced tier when specified", () => {
				const result = router.route("any query", { forceTier: "accurate" });
				expect(result.tier).toBe("accurate");
				expect(result.reason).toContain("Forced tier");
			});

			it("should use llm tier when forced", () => {
				const result = router.route("any query", { forceTier: "llm" });
				expect(result.tier).toBe("llm");
			});
		});

		describe("code pattern detection", () => {
			it("should route method calls to code tier", () => {
				const result = router.route("console.log()");
				expect(result.tier).toBe("code");
				expect(result.reason).toContain("code patterns");
			});

			it("should route function declarations to code tier", () => {
				const result = router.route("function handleClick");
				expect(result.tier).toBe("code");
			});

			it("should route class declarations to code tier", () => {
				const result = router.route("class UserService");
				expect(result.tier).toBe("code");
			});

			it("should route arrow functions to code tier", () => {
				const result = router.route("const fn = () =>");
				expect(result.tier).toBe("code");
			});

			it("should route import statements to code tier", () => {
				const result = router.route("import { useState }");
				expect(result.tier).toBe("code");
			});

			it("should route code contentType to code tier", () => {
				const result = router.route("simple query", { contentType: "code" });
				expect(result.tier).toBe("code");
			});
		});

		describe("complex query detection", () => {
			it("should route long queries to accurate tier", () => {
				const longQuery =
					"How do I implement a distributed cache invalidation strategy across multiple services with eventual consistency guarantees?";
				const result = router.route(longQuery);
				expect(result.tier).toBe("accurate");
				expect(result.reason).toContain("Complex query");
			});

			it("should route queries with operators AND long text to accurate tier", () => {
				// Score: length > 50 (+2) + operators (+2) + word count > 8 (+1) = 5 (complex)
				const result = router.route(
					"authentication AND authorization NOT oauth implementation strategy patterns examples best practices",
				);
				expect(result.tier).toBe("accurate");
			});

			it("should route moderate queries with operators to fast tier", () => {
				// Score: length > 25 (+1) + operators (+2) = 3 (moderate) → fast tier
				const result = router.route("authentication AND authorization NOT oauth");
				expect(result.tier).toBe("fast");
			});
		});

		describe("agentic query detection", () => {
			it("should route tool-related queries to accurate tier", () => {
				const result = router.route("how to call the tool");
				expect(result.tier).toBe("accurate");
				expect(result.reason).toContain("Agentic");
			});

			it("should route execute-related queries to accurate tier", () => {
				const result = router.route("execute the function");
				expect(result.tier).toBe("accurate");
			});

			it("should route API-related queries to accurate tier", () => {
				const result = router.route("api endpoint for users");
				expect(result.tier).toBe("accurate");
			});
		});

		describe("latency budget", () => {
			it("should use fast tier for tight latency budgets", () => {
				const result = router.route("simple query", { latencyBudgetMs: 30 });
				expect(result.tier).toBe("fast");
				expect(result.reason).toContain("latency");
			});

			it("should use fast tier when budget is below accurate threshold", () => {
				const result = router.route("moderately complex query here", {
					latencyBudgetMs: 100,
				});
				expect(result.tier).toBe("fast");
			});
		});

		describe("default routing", () => {
			it("should default to fast tier for simple queries", () => {
				const result = router.route("hello");
				expect(result.tier).toBe("fast");
				expect(result.reason).toContain("simple query");
			});

			it("should use fast tier for moderate complexity", () => {
				const result = router.route("how to implement login");
				expect(result.tier).toBe("fast");
			});
		});
	});

	describe("shouldUseLLM()", () => {
		it("should return true when forceTier is llm", () => {
			expect(router.shouldUseLLM("any query", { forceTier: "llm" })).toBe(true);
		});

		it("should return false by default", () => {
			expect(router.shouldUseLLM("any query")).toBe(false);
		});

		it("should return false even for complex queries", () => {
			const complexQuery =
				"Explain the distributed consensus algorithm with Byzantine fault tolerance";
			expect(router.shouldUseLLM(complexQuery)).toBe(false);
		});
	});

	describe("getModelForTier()", () => {
		it("should return model for fast tier", () => {
			const model = router.getModelForTier("fast");
			expect(model).toContain("MiniLM");
		});

		it("should return model for accurate tier", () => {
			const model = router.getModelForTier("accurate");
			expect(model).toContain("bge-reranker");
		});

		it("should return model for code tier", () => {
			const model = router.getModelForTier("code");
			expect(model).toContain("jina");
		});

		it("should return model for llm tier", () => {
			const model = router.getModelForTier("llm");
			expect(model).toContain("grok");
		});
	});

	describe("routing result structure", () => {
		it("should include all required fields", () => {
			const result = router.route("test query");

			expect(result).toHaveProperty("tier");
			expect(result).toHaveProperty("model");
			expect(result).toHaveProperty("maxCandidates");
			expect(result).toHaveProperty("reason");

			expect(typeof result.tier).toBe("string");
			expect(typeof result.model).toBe("string");
			expect(typeof result.maxCandidates).toBe("number");
			expect(typeof result.reason).toBe("string");
		});

		it("should have reasonable maxCandidates values", () => {
			const result = router.route("test query");
			expect(result.maxCandidates).toBeGreaterThan(0);
			expect(result.maxCandidates).toBeLessThanOrEqual(100);
		});
	});
});
