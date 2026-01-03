import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SamplingService } from "../capabilities";
import { registerEnrichMemoryTool } from "./enrich-memory";

describe("registerEnrichMemoryTool", () => {
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
			enrichMemory: mock(async () => ({
				summary: "Test summary",
				keywords: ["test", "keyword"],
				category: "decision",
			})),
		} as unknown as SamplingService;
	});

	describe("registration", () => {
		it("should register the enrich_memory tool with correct name", () => {
			registerEnrichMemoryTool(mockServer, mockSamplingService);

			expect(mockServer.registerTool).toHaveBeenCalledWith(
				"enrich_memory",
				expect.objectContaining({
					title: "Enrich Memory",
					description: expect.stringContaining("Auto-generate metadata"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("handler", () => {
		beforeEach(() => {
			registerEnrichMemoryTool(mockServer, mockSamplingService);
		});

		it("should return enrichment when sampling is enabled", async () => {
			const enrichment = {
				summary: "User prefers TypeScript",
				keywords: ["typescript", "preference", "language"],
				category: "preference",
			};
			spyOn(mockSamplingService, "enrichMemory").mockResolvedValue(enrichment);

			const result = (await registeredHandler({
				content: "I always prefer TypeScript over JavaScript",
			})) as any;

			expect(mockSamplingService.enrichMemory).toHaveBeenCalledWith(
				"I always prefer TypeScript over JavaScript",
			);
			expect(result.structuredContent.enrichment).toEqual(enrichment);
			expect(result.structuredContent.available).toBe(true);
			expect(result.content[0].text).toContain("User prefers TypeScript");
		});

		it("should return unavailable when sampling is disabled", async () => {
			mockSamplingService.enabled = false;

			const result = (await registeredHandler({
				content: "Some memory content",
			})) as any;

			expect(mockSamplingService.enrichMemory).not.toHaveBeenCalled();
			expect(result.structuredContent.enrichment).toBeNull();
			expect(result.structuredContent.available).toBe(false);
			expect(result.content[0].text).toContain("not available");
		});

		it("should handle null enrichment result", async () => {
			spyOn(mockSamplingService, "enrichMemory").mockResolvedValue(null);

			const result = (await registeredHandler({
				content: "Content to enrich",
			})) as any;

			expect(result.structuredContent.enrichment).toBeNull();
			expect(result.structuredContent.available).toBe(true);
			expect(result.content[0].text).toContain("Failed to enrich memory");
		});

		it("should handle parse failure with _raw response", async () => {
			spyOn(mockSamplingService, "enrichMemory").mockResolvedValue({
				_raw: "Invalid JSON response from LLM",
			} as any);

			const result = (await registeredHandler({
				content: "Content that fails to parse",
			})) as any;

			expect(result.structuredContent.enrichment).toBeNull();
			expect(result.structuredContent.available).toBe(true);
			expect(result.content[0].text).toContain("Failed to parse JSON");
			expect(result.content[0].text).toContain("Invalid JSON response from LLM");
		});
	});
});
