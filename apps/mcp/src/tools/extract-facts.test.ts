import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SamplingService } from "../capabilities";
import { registerExtractFactsTool } from "./extract-facts";

describe("registerExtractFactsTool", () => {
	let mockServer: McpServer;
	let mockSamplingService: SamplingService;
	let registeredHandler: (args: Record<string, unknown>) => Promise<unknown>;

	beforeEach(() => {
		// Capture the handler when registerTool is called
		mockServer = {
			registerTool: mock((_name, _options, handler) => {
				registeredHandler = handler;
			}),
		} as unknown as McpServer;

		mockSamplingService = {
			enabled: true,
			extractFacts: mock(async () => ["Fact 1", "Fact 2"]),
		} as unknown as SamplingService;
	});

	describe("registration", () => {
		it("should register the extract_facts tool with correct name", () => {
			registerExtractFactsTool(mockServer, mockSamplingService);

			expect(mockServer.registerTool).toHaveBeenCalledWith(
				"extract_facts",
				expect.objectContaining({
					title: "Extract Facts",
					description: expect.stringContaining("Parse unstructured text"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("handler", () => {
		beforeEach(() => {
			registerExtractFactsTool(mockServer, mockSamplingService);
		});

		it("should return extracted facts when sampling is enabled", async () => {
			const facts = [
				"User prefers tabs over spaces",
				"Project uses TypeScript 5.0",
				"API rate limit is 100 req/min",
			];
			spyOn(mockSamplingService, "extractFacts").mockResolvedValue(facts);

			const result = (await registeredHandler({
				text: "Documentation about the project...",
			})) as any;

			expect(mockSamplingService.extractFacts).toHaveBeenCalledWith(
				"Documentation about the project...",
			);
			expect(result.structuredContent.facts).toEqual(facts);
			expect(result.structuredContent.available).toBe(true);
			expect(result.structuredContent.count).toBe(3);
			expect(result.content[0].text).toContain("User prefers tabs over spaces");
		});

		it("should return unavailable when sampling is disabled", async () => {
			mockSamplingService.enabled = false;

			const result = (await registeredHandler({
				text: "Some text with facts",
			})) as any;

			expect(mockSamplingService.extractFacts).not.toHaveBeenCalled();
			expect(result.structuredContent.facts).toBeNull();
			expect(result.structuredContent.available).toBe(false);
			expect(result.structuredContent.count).toBe(0);
			expect(result.content[0].text).toContain("not available");
		});

		it("should handle null facts result", async () => {
			spyOn(mockSamplingService, "extractFacts").mockResolvedValue(null);

			const result = (await registeredHandler({
				text: "Text to extract from",
			})) as any;

			expect(result.structuredContent.facts).toBeNull();
			expect(result.structuredContent.available).toBe(true);
			expect(result.structuredContent.count).toBe(0);
			expect(result.content[0].text).toBe("Failed to extract facts");
		});

		it("should handle empty facts array", async () => {
			spyOn(mockSamplingService, "extractFacts").mockResolvedValue([]);

			const result = (await registeredHandler({
				text: "Text with no extractable facts",
			})) as any;

			expect(result.structuredContent.facts).toEqual([]);
			expect(result.structuredContent.available).toBe(true);
			expect(result.structuredContent.count).toBe(0);
		});
	});
});
