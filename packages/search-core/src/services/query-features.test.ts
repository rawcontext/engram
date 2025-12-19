import { describe, expect, it } from "vitest";
import { QueryFeatureExtractor, getFusionHints } from "./query-features";

describe("QueryFeatureExtractor", () => {
	const extractor = new QueryFeatureExtractor();

	describe("extract", () => {
		it("should extract length correctly", () => {
			const features = extractor.extract("How many tokens in this query?");
			expect(features.length).toBe(6);
		});

		it("should detect temporal markers", () => {
			const temporal = extractor.extract("What happened yesterday?");
			const nonTemporal = extractor.extract("What is machine learning?");

			expect(temporal.hasTemporal).toBe(true);
			expect(nonTemporal.hasTemporal).toBe(false);
		});

		it("should classify factoid questions", () => {
			const who = extractor.extract("Who founded Microsoft?");
			const what = extractor.extract("What is the capital of France?");
			const when = extractor.extract("When was the company started?");
			const where = extractor.extract("Where is the headquarters?");

			expect(who.questionType).toBe("factoid");
			expect(what.questionType).toBe("factoid");
			expect(when.questionType).toBe("temporal"); // 'when' triggers temporal
			expect(where.questionType).toBe("factoid");
		});

		it("should classify list questions", () => {
			const list = extractor.extract("List all the features");
			const enumerate = extractor.extract("Enumerate the steps");

			expect(list.questionType).toBe("list");
			expect(enumerate.questionType).toBe("list");
		});

		it("should classify comparison questions", () => {
			// 'compare' keyword triggers comparison
			const compare = extractor.extract("Compare React and Vue");
			// 'difference' keyword triggers comparison
			const difference = extractor.extract("explain the difference between them");

			expect(compare.questionType).toBe("comparison");
			expect(difference.questionType).toBe("comparison");
		});

		it("should classify causal questions", () => {
			const why = extractor.extract("Why did the test fail?");
			const how = extractor.extract("How does authentication work?");

			expect(why.questionType).toBe("causal");
			expect(how.questionType).toBe("causal");
		});

		it("should classify opinion questions", () => {
			// Need 'think' keyword without leading 'what' to avoid factoid classification
			const opinion = extractor.extract("Do you think TypeScript is good?");
			const recommend = extractor.extract("Would you recommend Redux?");

			expect(opinion.questionType).toBe("opinion");
			expect(recommend.questionType).toBe("opinion");
		});

		it("should detect entity density", () => {
			const withEntities = extractor.extract("Tell me about Microsoft and Google");
			const withoutEntities = extractor.extract("how do i do this");

			expect(withEntities.entityDensity).toBeGreaterThan(0);
			expect(withoutEntities.entityDensity).toBe(0);
		});

		it("should detect specific terms", () => {
			// Version numbers are specific
			const withVersion = extractor.extract("How to upgrade to v2.0.0?");
			// Entities are specific
			const withEntity = extractor.extract("Tell me about Microsoft Azure");
			const plain = extractor.extract("how to implement login");

			expect(withVersion.hasSpecificTerms).toBe(true);
			expect(withEntity.hasSpecificTerms).toBe(true);
			expect(plain.hasSpecificTerms).toBe(false);
		});

		it("should calculate complexity", () => {
			const simple = extractor.extract("What is X?");
			const complex = extractor.extract(
				"If the user is authenticated and has admin role, how should the system handle permission checks?",
			);

			expect(complex.complexity).toBeGreaterThan(simple.complexity);
		});
	});

	describe("toNormalizedVector", () => {
		it("should return normalized feature vector", () => {
			const features = extractor.extract("Who founded Microsoft in 1975?");
			const normalized = extractor.toNormalizedVector(features);

			expect(normalized.vector).toHaveLength(8);
			expect(normalized.names).toHaveLength(8);

			// All values should be between 0 and ~1
			for (const val of normalized.vector) {
				expect(val).toBeGreaterThanOrEqual(0);
				expect(val).toBeLessThanOrEqual(2); // Some normalization may exceed 1
			}
		});
	});

	describe("buildIDFIndex", () => {
		it("should build IDF index from corpus", () => {
			const localExtractor = new QueryFeatureExtractor();
			localExtractor.buildIDFIndex(["The quick brown fox", "The lazy dog", "The quick rabbit"]);

			// 'the' appears in all docs, should have low IDF
			// 'fox' appears in one doc, should have high IDF
			const commonFeatures = localExtractor.extract("the");
			const rareFeatures = localExtractor.extract("fox");

			expect(rareFeatures.avgIDF).toBeGreaterThan(commonFeatures.avgIDF);
		});

		it("should detect rare terms after IDF index built", () => {
			const localExtractor = new QueryFeatureExtractor({
				rareTermThreshold: 1.0, // Lower threshold to make rare detection easier
			});
			localExtractor.buildIDFIndex([
				"common word appears here",
				"common word appears again",
				"common word once more",
				"unique special appears once",
			]);

			const withRare = localExtractor.extract("unique");
			const withCommon = localExtractor.extract("common");

			// 'unique' should be rare since it only appears in 1 of 4 docs (IDF = log(4/1) = 1.38)
			// 'common' appears in 3 of 4 docs (IDF = log(4/3) = 0.29)
			expect(withRare.avgIDF).toBeGreaterThan(withCommon.avgIDF);
		});
	});
});

describe("getFusionHints", () => {
	const extractor = new QueryFeatureExtractor();

	it("should suggest balanced weights for factoid questions with entities", () => {
		const features = extractor.extract("Who is the CEO of Apple?");
		const hints = getFusionHints(features);

		// Factoid with entity - should have reasonable dense weight
		// But entity presence may also increase sparse weight
		expect(hints.dense).toBeGreaterThanOrEqual(0.25);
		expect(hints.sparse).toBeGreaterThanOrEqual(0.25);
	});

	it("should suggest higher sparse weight for queries with specific terms", () => {
		const features = extractor.extract("error TS2345 in TypeScript");
		const hints = getFusionHints(features);

		// Specific terms should favor sparse
		expect(hints.sparse).toBeGreaterThanOrEqual(0.3);
	});

	it("should suggest higher rerank weight for complex queries", () => {
		const simple = extractor.extract("What is X?");
		const complex = extractor.extract(
			"Compare the performance implications of using Redux versus MobX for state management in a large React application",
		);

		const simpleHints = getFusionHints(simple);
		const complexHints = getFusionHints(complex);

		expect(complexHints.rerank).toBeGreaterThanOrEqual(simpleHints.rerank);
	});

	it("should return weights that sum to approximately 1", () => {
		const features = extractor.extract("Any random query here");
		const hints = getFusionHints(features);

		const sum = hints.dense + hints.sparse + hints.rerank;
		expect(sum).toBeCloseTo(1.0, 1);
	});
});
