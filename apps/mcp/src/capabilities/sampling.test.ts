import { createTestLogger } from "@engram/common/testing";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { SamplingService } from "./sampling";

/**
 * Mock MCP server structure for sampling capability testing.
 */
interface MockMcpServer {
	server: {
		createMessage: ReturnType<typeof mock>;
	};
}

// Mock the MCP server
const mockServer: MockMcpServer = {
	server: {
		createMessage: mock(),
	},
};

// Mock the logger
const mockLogger = createTestLogger();

describe("SamplingService", () => {
	let service: SamplingService;

	beforeEach(() => {
		service = new SamplingService(
			mockServer as unknown as Parameters<typeof SamplingService.prototype.constructor>[0],
			mockLogger,
		);
	});

	afterEach(() => {});

	describe("enable", () => {
		it("should enable sampling capability", () => {
			expect(service.enabled).toBe(false);

			service.enable();

			expect(service.enabled).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith("Sampling capability enabled");
		});
	});

	describe("createMessage", () => {
		it("should return null when not enabled", async () => {
			const result = await service.createMessage("test prompt");

			expect(result).toBeNull();
			expect(mockServer.server.createMessage).not.toHaveBeenCalled();
			expect(mockLogger.debug).toHaveBeenCalledWith(
				"Sampling not available, skipping createMessage",
			);
		});

		it("should call server.createMessage when enabled", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "text", text: "Response text" },
				model: "claude-3-haiku",
			});

			const result = await service.createMessage("test prompt");

			expect(result).toEqual({
				text: "Response text",
				model: "claude-3-haiku",
			});
			expect(mockServer.server.createMessage).toHaveBeenCalledWith({
				messages: [
					{
						role: "user",
						content: { type: "text", text: "test prompt" },
					},
				],
				maxTokens: 500,
			});
		});

		it("should apply maxTokens option", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "text", text: "Response" },
			});

			await service.createMessage("test", { maxTokens: 100 });

			expect(mockServer.server.createMessage).toHaveBeenCalledWith(
				expect.objectContaining({ maxTokens: 100 }),
			);
		});

		it("should apply preferFast option with model preferences", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "text", text: "Response" },
			});

			await service.createMessage("test", { preferFast: true });

			expect(mockServer.server.createMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					modelPreferences: {
						costPriority: 0.8,
						speedPriority: 0.8,
						intelligencePriority: 0.3,
					},
				}),
			);
		});

		it("should handle errors gracefully", async () => {
			service.enable();
			mockServer.server.createMessage.mockRejectedValueOnce(new Error("Network error"));

			const result = await service.createMessage("test");

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ error: expect.any(Error) }),
				"Sampling request failed",
			);
		});
	});

	describe("summarize", () => {
		it("should return null when not enabled", async () => {
			const result = await service.summarize("Long text to summarize");

			expect(result).toBeNull();
		});

		it("should request summary from LLM", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "text", text: "Summary of the text" },
			});

			const result = await service.summarize("Long text to summarize", 50);

			expect(result).toBe("Summary of the text");
			expect(mockServer.server.createMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: [
						{
							role: "user",
							content: {
								type: "text",
								text: expect.stringContaining("Summarize the following text"),
							},
						},
					],
					maxTokens: 75, // 50 * 1.5
				}),
			);
		});
	});

	describe("extractFacts", () => {
		it("should return null when not enabled", async () => {
			const result = await service.extractFacts("Text with facts");

			expect(result).toBeNull();
		});

		it("should parse JSON array response", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "text", text: '["Fact 1", "Fact 2", "Fact 3"]' },
			});

			const result = await service.extractFacts("Text with facts");

			expect(result).toEqual(["Fact 1", "Fact 2", "Fact 3"]);
		});

		it("should handle non-JSON response by splitting lines", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "text", text: "- Fact 1\n- Fact 2\n• Fact 3" },
			});

			const result = await service.extractFacts("Text with facts");

			expect(result).toEqual(["Fact 1", "Fact 2", "Fact 3"]);
		});
	});

	describe("enrichMemory", () => {
		it("should return null when not enabled", async () => {
			const result = await service.enrichMemory("Memory content");

			expect(result).toBeNull();
		});

		it("should parse enrichment response", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: {
					type: "text",
					text: JSON.stringify({
						summary: "Brief summary",
						keywords: ["key1", "key2", "key3"],
						category: "decision",
					}),
				},
			});

			const result = await service.enrichMemory("Memory content");

			expect(result).toEqual({
				summary: "Brief summary",
				keywords: ["key1", "key2", "key3"],
				category: "decision",
			});
		});

		it("should return null on invalid JSON response", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "text", text: "Invalid JSON response" },
			});

			const result = await service.enrichMemory("Memory content");

			expect(result).toBeNull();
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({ text: "Invalid JSON response" }),
				"Failed to parse enrichment response",
			);
		});

		it("should return null when no response", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce(null as any);

			const result = await service.enrichMemory("Memory content");

			expect(result).toBeNull();
		});
	});

	describe("extractFacts edge cases", () => {
		it("should return null when no response", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce(null as any);

			const result = await service.extractFacts("Text");

			expect(result).toBeNull();
		});

		it("should filter out empty lines when parsing non-JSON", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "text", text: "- Fact 1\n\n- Fact 2\n   \n* Fact 3" },
			});

			const result = await service.extractFacts("Text with facts");

			expect(result).toEqual(["Fact 1", "Fact 2", "Fact 3"]);
		});

		it("should return null when JSON array contains non-strings", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "text", text: '{"not": "an array"}' },
			});

			const result = await service.extractFacts("Text");

			expect(result).toBeNull();
		});
	});

	describe("createMessage edge cases", () => {
		it("should handle non-text response content", async () => {
			service.enable();
			mockServer.server.createMessage.mockResolvedValueOnce({
				content: { type: "image" },
				model: "test-model",
			});

			const result = await service.createMessage("test");

			expect(result?.text).toBe("");
			expect(result?.model).toBe("test-model");
		});
	});
});
