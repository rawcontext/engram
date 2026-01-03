import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SamplingService } from "../capabilities";
import { registerSummarizeTool } from "./summarize";

describe("registerSummarizeTool", () => {
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
			summarize: mock(async () => "Test summary"),
		} as unknown as SamplingService;
	});

	describe("registration", () => {
		it("should register the summarize tool with correct name", () => {
			registerSummarizeTool(mockServer, mockSamplingService);

			expect(mockServer.registerTool).toHaveBeenCalledWith(
				"summarize",
				expect.objectContaining({
					title: "Summarize Text",
					description: expect.stringContaining("Condense long text"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("handler", () => {
		beforeEach(() => {
			registerSummarizeTool(mockServer, mockSamplingService);
		});

		it("should return summary when sampling is enabled", async () => {
			spyOn(mockSamplingService, "summarize").mockResolvedValue("This is a test summary");

			const result = (await registeredHandler({
				text: "Long text to summarize",
				maxWords: 50,
			})) as any;

			expect(mockSamplingService.summarize).toHaveBeenCalledWith("Long text to summarize", 50);
			expect(result.structuredContent.summary).toBe("This is a test summary");
			expect(result.structuredContent.available).toBe(true);
			expect(result.content[0].text).toBe("This is a test summary");
		});

		it("should use default maxWords when not provided", async () => {
			spyOn(mockSamplingService, "summarize").mockResolvedValue("Summary");

			await registeredHandler({ text: "Some text" });

			expect(mockSamplingService.summarize).toHaveBeenCalledWith("Some text", 100);
		});

		it("should return unavailable when sampling is disabled", async () => {
			mockSamplingService.enabled = false;

			const result = (await registeredHandler({
				text: "Long text to summarize",
			})) as any;

			expect(mockSamplingService.summarize).not.toHaveBeenCalled();
			expect(result.structuredContent.summary).toBeNull();
			expect(result.structuredContent.available).toBe(false);
			expect(result.content[0].text).toContain("not available");
		});

		it("should handle null summary result", async () => {
			spyOn(mockSamplingService, "summarize").mockResolvedValue(null);

			const result = (await registeredHandler({
				text: "Text to summarize",
			})) as any;

			expect(result.structuredContent.summary).toBeNull();
			expect(result.structuredContent.available).toBe(true);
			expect(result.content[0].text).toBe("Failed to generate summary");
		});
	});
});
