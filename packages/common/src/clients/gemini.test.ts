import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createGeminiClient, GeminiClient, GeminiError } from "./gemini";

describe("GeminiClient", () => {
	test("createGeminiClient throws error when no API key is provided", () => {
		const originalKey = process.env.GEMINI_API_KEY;
		delete process.env.GEMINI_API_KEY;

		expect(() => createGeminiClient()).toThrow(GeminiError);
		expect(() => createGeminiClient()).toThrow(/GEMINI_API_KEY is required/);

		// Restore
		if (originalKey) {
			process.env.GEMINI_API_KEY = originalKey;
		}
	});

	test("createGeminiClient uses provided API key", () => {
		const client = createGeminiClient({ apiKey: "test-key" });
		expect(client).toBeInstanceOf(GeminiClient);
	});

	test("GeminiError extends EngramError", () => {
		const error = new GeminiError("Test error");
		expect(error.message).toBe("Test error");
		expect(error.code).toBe("GEMINI_ERROR");
		expect(error.timestamp).toBeNumber();
	});

	test("GeminiError handles Error cause", () => {
		const cause = new Error("Original error");
		const error = new GeminiError("Wrapped error", cause);
		expect(error.cause).toBe(cause);
	});

	test("GeminiError converts non-Error cause to undefined", () => {
		const error = new GeminiError("Test error", "string cause");
		expect(error.cause).toBeUndefined();
	});

	// Integration test - only runs if GEMINI_API_KEY is set
	test.skipIf(!process.env.GEMINI_API_KEY)(
		"generateStructuredOutput returns valid structured data",
		async () => {
			const client = createGeminiClient({ model: "gemini-3-flash-preview" });

			const PersonSchema = z.object({
				name: z.string(),
				age: z.number(),
			});

			const result = await client.generateStructuredOutput({
				prompt:
					"Return a JSON object with person information. The person's name is John Doe and age is 30.",
				schema: PersonSchema,
				systemInstruction:
					"You must return a single JSON object matching the schema. Do not return an array.",
			});

			expect(result).toMatchObject({
				name: expect.any(String),
				age: expect.any(Number),
			});
		},
		{ timeout: 30000 },
	);

	// Integration test - only runs if GEMINI_API_KEY is set
	test.skipIf(!process.env.GEMINI_API_KEY)(
		"generateBatch processes multiple prompts",
		async () => {
			const client = createGeminiClient({ model: "gemini-3-flash-preview" });

			const SummarySchema = z.object({
				summary: z.string(),
			});

			const results = await client.generateBatch({
				prompts: [
					"Return a JSON object with a summary field. Summarize this: The sky is blue.",
					"Return a JSON object with a summary field. Summarize this: Water is wet.",
				],
				schema: SummarySchema,
				systemInstruction:
					"You must return a single JSON object matching the schema. Do not return an array.",
				concurrency: 2,
			});

			expect(results).toHaveLength(2);
			expect(results[0]).toHaveProperty("summary");
			expect(results[1]).toHaveProperty("summary");
		},
		{ timeout: 60000 },
	);
});
