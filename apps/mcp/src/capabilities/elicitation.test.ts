import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElicitationService } from "./elicitation";

// Mock the MCP server
const mockServer = {
	server: {
		elicitInput: vi.fn(),
	},
};

// Mock the logger
const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

describe("ElicitationService", () => {
	let service: ElicitationService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new ElicitationService(mockServer as any, mockLogger as any);
	});

	afterEach(() => {
		vi.clearAllMocks();
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
	});
});
