import { createTestLogger } from "@engram/common/testing";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { ElicitationService } from "./elicitation";

/**
 * Mock MCP server structure for elicitation capability testing.
 */
interface MockMcpServer {
	server: {
		elicitInput: ReturnType<typeof mock>;
	};
}

// Mock the MCP server
const mockServer: MockMcpServer = {
	server: {
		elicitInput: mock(),
	},
};

// Mock the logger
const mockLogger = createTestLogger();

describe("ElicitationService", () => {
	let service: ElicitationService;

	beforeEach(() => {
		// vi.clearAllMocks(); // TODO: Clear individual mocks
		service = new ElicitationService(
			mockServer as unknown as Parameters<typeof ElicitationService.prototype.constructor>[0],
			mockLogger,
		);
	});

	afterEach(() => {
		// vi.clearAllMocks(); // TODO: Clear individual mocks
	});

	describe("enable", () => {
		it("should enable elicitation capability", () => {
			expect(service.enabled).toBe(false);

			service.enable();

			expect(service.enabled).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith("Elicitation capability enabled");
		});
	});

	describe("confirm", () => {
		it("should return rejected when not enabled", async () => {
			const result = await service.confirm("Are you sure?");

			expect(result.accepted).toBe(false);
			expect(result.content).toBeUndefined();
			expect(mockServer.server.elicitInput).not.toHaveBeenCalled();
		});

		it("should return accepted with confirmed=true when user accepts", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { confirmed: true },
			});

			const result = await service.confirm("Delete this file?");

			expect(result.accepted).toBe(true);
			expect(result.content?.confirmed).toBe(true);
		});

		it("should return accepted with confirmed=false when user declines in dialog", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { confirmed: false },
			});

			const result = await service.confirm("Delete this file?");

			expect(result.accepted).toBe(true);
			expect(result.content?.confirmed).toBe(false);
		});

		it("should return rejected when user cancels dialog", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "decline",
			});

			const result = await service.confirm("Delete this file?");

			expect(result.accepted).toBe(false);
		});

		it("should handle errors gracefully", async () => {
			service.enable();
			mockServer.server.elicitInput.mockRejectedValueOnce(new Error("Network error"));

			const result = await service.confirm("Test?");

			expect(result.accepted).toBe(false);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ error: expect.any(Error) }),
				"Elicitation request failed",
			);
		});

		it("should pass through custom title option", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { confirmed: true },
			});

			await service.confirm("Proceed?", { title: "Custom Title" });

			expect(mockServer.server.elicitInput).toHaveBeenCalledWith({
				message: "Proceed?",
				requestedSchema: expect.objectContaining({
					properties: {
						confirmed: expect.objectContaining({
							title: "Custom Title",
						}),
					},
				}),
			});
		});

		it("should convert non-boolean confirmed value to boolean", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { confirmed: "yes" },
			});

			const result = await service.confirm("Confirm?");

			expect(result.accepted).toBe(true);
			expect(result.content?.confirmed).toBe(true);
		});
	});

	describe("select", () => {
		const options = [
			{ value: "a", label: "Option A", description: "First option" },
			{ value: "b", label: "Option B", description: "Second option" },
			{ value: "c", label: "Option C", description: "Third option" },
		];

		it("should return rejected when not enabled", async () => {
			const result = await service.select("Choose one:", options);

			expect(result.accepted).toBe(false);
		});

		it("should return selected value when user accepts", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { selected: "b" },
			});

			const result = await service.select<"a" | "b" | "c">("Choose one:", options);

			expect(result.accepted).toBe(true);
			expect(result.content?.selected).toBe("b");
		});

		it("should send correct schema with enum values", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { selected: "a" },
			});

			await service.select("Choose:", options);

			expect(mockServer.server.elicitInput).toHaveBeenCalledWith({
				message: "Choose:",
				requestedSchema: {
					type: "object",
					properties: {
						selected: {
							type: "string",
							title: "Selection",
							enum: ["a", "b", "c"],
							enumNames: ["Option A", "Option B", "Option C"],
						},
					},
					required: ["selected"],
				},
			});
		});

		it("should return rejected when user declines", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "decline",
			});

			const result = await service.select("Choose one:", options);

			expect(result.accepted).toBe(false);
		});

		it("should return rejected when no selected value", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: {},
			});

			const result = await service.select("Choose one:", options);

			expect(result.accepted).toBe(false);
		});

		it("should handle errors gracefully", async () => {
			service.enable();
			mockServer.server.elicitInput.mockRejectedValueOnce(new Error("Test error"));

			const result = await service.select("Choose:", options);

			expect(result.accepted).toBe(false);
			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	describe("promptText", () => {
		it("should return rejected when not enabled", async () => {
			const result = await service.promptText("Enter name:");

			expect(result.accepted).toBe(false);
		});

		it("should return entered text when user accepts", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { text: "John Doe" },
			});

			const result = await service.promptText("Enter your name:");

			expect(result.accepted).toBe(true);
			expect(result.content?.text).toBe("John Doe");
		});

		it("should handle empty text input", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { text: "" },
			});

			const result = await service.promptText("Enter name:", { required: false });

			expect(result.accepted).toBe(true);
			expect(result.content?.text).toBe("");
		});

		it("should handle missing text content gracefully", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: {},
			});

			const result = await service.promptText("Enter name:");

			expect(result.accepted).toBe(true);
			expect(result.content?.text).toBe("");
		});

		it("should handle decline action", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "decline",
			});

			const result = await service.promptText("Enter name:");

			expect(result.accepted).toBe(false);
		});

		it("should handle errors gracefully via rejection", async () => {
			service.enable();
			mockServer.server.elicitInput.mockRejectedValueOnce(new Error("Test error"));

			const result = await service.promptText("Test?");

			expect(result.accepted).toBe(false);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ error: expect.any(Error) }),
				"Elicitation request failed",
			);
		});

		it("should pass through title and placeholder options", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { text: "test" },
			});

			await service.promptText("Enter:", {
				title: "Custom Title",
				placeholder: "Placeholder text",
			});

			expect(mockServer.server.elicitInput).toHaveBeenCalledWith({
				message: "Enter:",
				requestedSchema: expect.objectContaining({
					properties: {
						text: {
							type: "string",
							title: "Custom Title",
							description: "Placeholder text",
						},
					},
				}),
			});
		});
	});

	describe("selectMemory", () => {
		const memories = [
			{ id: "mem-1", preview: "First memory content", type: "decision" },
			{ id: "mem-2", preview: "Second memory content", type: "context" },
			{ id: "mem-3", preview: "Third memory content", type: "insight" },
		];

		it("should return rejected when not enabled", async () => {
			const result = await service.selectMemory("Which memory?", memories);

			expect(result.accepted).toBe(false);
		});

		it("should return selected memory ID when user accepts", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { selected: "mem-2" },
			});

			const result = await service.selectMemory("Choose a memory:", memories);

			expect(result.accepted).toBe(true);
			expect(result.content?.selectedId).toBe("mem-2");
		});

		it("should return rejected when select not accepted", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "decline",
			});

			const result = await service.selectMemory("Choose a memory:", memories);

			expect(result.accepted).toBe(false);
		});

		it("should truncate long preview in labels", async () => {
			service.enable();
			const longMemory = {
				id: "mem-long",
				preview: "A".repeat(100),
				type: "context",
			};
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { selected: "mem-long" },
			});

			await service.selectMemory("Choose:", [longMemory]);

			expect(mockServer.server.elicitInput).toHaveBeenCalledWith(
				expect.objectContaining({
					requestedSchema: expect.objectContaining({
						properties: {
							selected: expect.objectContaining({
								enumNames: expect.arrayContaining([
									expect.stringMatching(/^context: .{50}\.\.\.$/),
								]),
							}),
						},
					}),
				}),
			);
		});
	});

	describe("confirmDestructive", () => {
		it("should return rejected when not enabled", async () => {
			const result = await service.confirmDestructive("Delete all data", "This cannot be undone");

			expect(result.accepted).toBe(false);
		});

		it("should return both confirmed and understood flags", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { confirmed: true, understood: true },
			});

			const result = await service.confirmDestructive("Delete all data", "This cannot be undone");

			expect(result.accepted).toBe(true);
			expect(result.content?.confirmed).toBe(true);
			expect(result.content?.understood).toBe(true);
		});

		it("should format message with warning emoji", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { confirmed: true, understood: true },
			});

			await service.confirmDestructive("Delete files", "All files will be removed");

			expect(mockServer.server.elicitInput).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "⚠️ Delete files\n\nAll files will be removed",
				}),
			);
		});

		it("should return rejected when user declines", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "decline",
			});

			const result = await service.confirmDestructive("Delete data", "Cannot undo");

			expect(result.accepted).toBe(false);
		});

		it("should convert non-boolean flags to boolean", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { confirmed: 1, understood: "yes" },
			});

			const result = await service.confirmDestructive("Delete", "Details");

			expect(result.accepted).toBe(true);
			expect(result.content?.confirmed).toBe(true);
			expect(result.content?.understood).toBe(true);
		});

		it("should handle errors gracefully", async () => {
			service.enable();
			mockServer.server.elicitInput.mockRejectedValueOnce(new Error("Test error"));

			const result = await service.confirmDestructive("Delete", "Cannot undo");

			expect(result.accepted).toBe(false);
			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	describe("promptText edge cases", () => {
		it("should handle required field when required=false", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { text: "test" },
			});

			await service.promptText("Enter:", { required: false });

			expect(mockServer.server.elicitInput).toHaveBeenCalledWith(
				expect.objectContaining({
					requestedSchema: expect.objectContaining({
						required: [],
					}),
				}),
			);
		});

		it("should convert non-string text to string", async () => {
			service.enable();
			mockServer.server.elicitInput.mockResolvedValueOnce({
				action: "accept",
				content: { text: 123 },
			});

			const result = await service.promptText("Enter:");

			expect(result.accepted).toBe(true);
			expect(result.content?.text).toBe("123");
		});
	});
});
