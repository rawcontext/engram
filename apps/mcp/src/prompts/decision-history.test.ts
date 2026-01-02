import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IMemoryRetriever } from "../services/interfaces";
import { registerWhyPrompt } from "./decision-history";

describe("registerWhyPrompt", () => {
	let mockServer: McpServer;
	let mockMemoryRetriever: IMemoryRetriever;
	let registeredHandler: (args: { topic: string }) => Promise<{ messages: unknown[] }>;

	beforeEach(() => {
		mockServer = {
			registerPrompt: mock((name, options, handler) => {
				registeredHandler = handler;
			}),
		} as unknown as McpServer;

		mockMemoryRetriever = {
			recall: mock(async () => []),
		} as unknown as IMemoryRetriever;
	});

	describe("registration", () => {
		it("should register the decision-history prompt with correct name", () => {
			registerWhyPrompt(mockServer, mockMemoryRetriever, () => ({}));

			expect(mockServer.registerPrompt).toHaveBeenCalledWith(
				"decision-history",
				expect.objectContaining({
					description: expect.stringContaining("Find past decisions"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("handler", () => {
		beforeEach(() => {
			registerWhyPrompt(mockServer, mockMemoryRetriever, () => ({
				project: "test-project",
			}));
		});

		it("should search for decisions on the given topic", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ topic: "authentication" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"decisions about authentication",
				6,
				expect.objectContaining({ type: "decision", project: "test-project" }),
			);
		});

		it("should search for insights on the topic", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ topic: "caching" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"insights about caching",
				3,
				expect.objectContaining({ type: "insight", project: "test-project" }),
			);
		});

		it("should return message with no decisions found", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = await registeredHandler({ topic: "nonexistent" });

			expect(result.messages).toHaveLength(1);
			expect((result.messages[0] as any).content.text).toContain("No decisions found");
		});

		it("should format decisions with date and confidence", async () => {
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce([
					{
						id: "dec-1",
						content: "We decided to use JWT for auth tokens",
						score: 0.95,
						created_at: "2024-01-15T10:00:00Z",
						project: "test-project",
					},
				])
				.mockResolvedValueOnce([]); // No insights

			const result = (await registeredHandler({ topic: "authentication" })) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Decision 1");
			expect(text).toContain("We decided to use JWT for auth tokens");
			expect(text).toContain("High"); // High confidence for score > 0.8
		});

		it("should show medium confidence for scores between 0.5 and 0.8", async () => {
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce([
					{
						id: "dec-1",
						content: "Maybe use REST over GraphQL",
						score: 0.65,
						created_at: "2024-01-10T10:00:00Z",
					},
				])
				.mockResolvedValueOnce([]);

			const result = (await registeredHandler({ topic: "api design" })) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Medium");
		});

		it("should show low confidence for scores below 0.5", async () => {
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce([
					{
						id: "dec-1",
						content: "Vaguely related decision",
						score: 0.35,
						created_at: "2024-01-05T10:00:00Z",
					},
				])
				.mockResolvedValueOnce([]);

			const result = (await registeredHandler({ topic: "something" })) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Low");
		});

		it("should include related insights when found", async () => {
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce([]) // No decisions
				.mockResolvedValueOnce([
					{
						id: "ins-1",
						content: "The rate limiter was causing timeouts",
						score: 0.8,
						created_at: "2024-01-12T14:00:00Z",
					},
				]);

			const result = (await registeredHandler({ topic: "rate limiting" })) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Related Insights");
			expect(text).toContain("The rate limiter was causing timeouts");
		});

		it("should include project info in header", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler({ topic: "deployment" })) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Searching in project: test-project");
		});

		it("should include analysis instructions in output", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler({ topic: "testing" })) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Please analyze these decisions");
			expect(text).toContain("Summarize the key decisions");
			expect(text).toContain("rationale");
		});

		it("should include project name from decision results", async () => {
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce([
					{
						id: "dec-1",
						content: "Use monorepo structure",
						score: 0.9,
						created_at: "2024-01-01T10:00:00Z",
						project: "engram",
					},
				])
				.mockResolvedValueOnce([]);

			const result = (await registeredHandler({ topic: "architecture" })) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("(engram)");
		});
	});

	describe("without project context", () => {
		it("should omit project info when not provided", async () => {
			registerWhyPrompt(mockServer, mockMemoryRetriever, () => ({}));
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler({ topic: "anything" })) as any;
			const text = result.messages[0].content.text;

			expect(text).not.toContain("Searching in project:");
		});
	});
});
