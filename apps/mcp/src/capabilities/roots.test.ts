import { createTestLogger } from "@engram/common/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootsService } from "./roots";

/**
 * Mock MCP server structure for roots capability testing.
 */
interface MockMcpServer {
	server: {
		listRoots: ReturnType<typeof vi.fn>;
		setNotificationHandler: ReturnType<typeof vi.fn>;
	};
}

// Mock the MCP server
const mockServer: MockMcpServer = {
	server: {
		listRoots: vi.fn(),
		setNotificationHandler: vi.fn(),
	},
};

// Mock the logger
const mockLogger = createTestLogger();

describe("RootsService", () => {
	let service: RootsService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new RootsService(
			mockServer as unknown as Parameters<typeof RootsService.prototype.constructor>[0],
			mockLogger,
		);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("enable", () => {
		it("should enable roots capability", () => {
			expect(service.enabled).toBe(false);

			service.enable();

			expect(service.enabled).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith("Roots capability enabled");
		});

		it("should set up notification handler", () => {
			service.enable();

			expect(mockServer.server.setNotificationHandler).toHaveBeenCalled();
		});
	});

	describe("refreshRoots", () => {
		it("should return empty array when not enabled", async () => {
			const roots = await service.refreshRoots();

			expect(roots).toEqual([]);
			expect(mockServer.server.listRoots).not.toHaveBeenCalled();
		});

		it("should fetch and parse roots from server", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [
					{ uri: "file:///Users/test/project1", name: "Project 1" },
					{ uri: "file:///Users/test/project2" },
				],
			});

			const roots = await service.refreshRoots();

			expect(roots).toHaveLength(2);
			expect(roots[0]).toEqual({
				uri: "file:///Users/test/project1",
				name: "Project 1",
				path: "/Users/test/project1",
			});
			expect(roots[1]).toEqual({
				uri: "file:///Users/test/project2",
				name: undefined,
				path: "/Users/test/project2",
			});
		});

		it("should update internal roots list", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///Users/test/project", name: "Test" }],
			});

			await service.refreshRoots();

			expect(service.roots).toHaveLength(1);
			expect(service.roots[0].path).toBe("/Users/test/project");
		});

		it("should call onRootsChanged callback", async () => {
			const callback = vi.fn();
			service.onRootsChanged(callback);
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///test", name: "Test" }],
			});

			await service.refreshRoots();

			expect(callback).toHaveBeenCalledWith([{ uri: "file:///test", name: "Test", path: "/test" }]);
		});

		it("should handle errors gracefully", async () => {
			service.enable();
			mockServer.server.listRoots.mockRejectedValueOnce(new Error("Network error"));

			const roots = await service.refreshRoots();

			expect(roots).toEqual([]);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ error: expect.any(Error) }),
				"Failed to refresh roots",
			);
		});
	});

	describe("projectNames", () => {
		it("should return names from roots", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [
					{ uri: "file:///Users/test/project1", name: "Project 1" },
					{ uri: "file:///Users/test/project2", name: "Project 2" },
				],
			});
			await service.refreshRoots();

			expect(service.projectNames).toEqual(["Project 1", "Project 2"]);
		});

		it("should derive name from path when name not provided", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///Users/test/my-project" }],
			});
			await service.refreshRoots();

			expect(service.projectNames).toEqual(["my-project"]);
		});
	});

	describe("primaryProject", () => {
		it("should return undefined when no roots", () => {
			expect(service.primaryProject).toBeUndefined();
		});

		it("should return first project name", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [
					{ uri: "file:///Users/test/first", name: "First" },
					{ uri: "file:///Users/test/second", name: "Second" },
				],
			});
			await service.refreshRoots();

			expect(service.primaryProject).toBe("First");
		});
	});

	describe("primaryWorkingDir", () => {
		it("should return undefined when no roots", () => {
			expect(service.primaryWorkingDir).toBeUndefined();
		});

		it("should return first root path", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///Users/test/project" }],
			});
			await service.refreshRoots();

			expect(service.primaryWorkingDir).toBe("/Users/test/project");
		});
	});

	describe("isWithinRoots", () => {
		it("should return true when no roots defined", () => {
			expect(service.isWithinRoots("/any/path")).toBe(true);
		});

		it("should return true for path within root", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///Users/test/project" }],
			});
			await service.refreshRoots();

			expect(service.isWithinRoots("/Users/test/project/src/file.ts")).toBe(true);
			expect(service.isWithinRoots("/Users/test/project")).toBe(true);
		});

		it("should return false for path outside roots", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///Users/test/project" }],
			});
			await service.refreshRoots();

			expect(service.isWithinRoots("/Users/test/other")).toBe(false);
			expect(service.isWithinRoots("/Users/other/project")).toBe(false);
		});

		it("should check against multiple roots", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///Users/test/project1" }, { uri: "file:///Users/test/project2" }],
			});
			await service.refreshRoots();

			expect(service.isWithinRoots("/Users/test/project1/src")).toBe(true);
			expect(service.isWithinRoots("/Users/test/project2/src")).toBe(true);
			expect(service.isWithinRoots("/Users/test/project3/src")).toBe(false);
		});
	});

	describe("findRootForPath", () => {
		it("should return undefined when no roots", () => {
			expect(service.findRootForPath("/any/path")).toBeUndefined();
		});

		it("should find matching root", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [
					{ uri: "file:///Users/test/project1", name: "P1" },
					{ uri: "file:///Users/test/project2", name: "P2" },
				],
			});
			await service.refreshRoots();

			const root = service.findRootForPath("/Users/test/project2/src/file.ts");
			expect(root?.name).toBe("P2");
		});
	});

	describe("getProjectForPath", () => {
		it("should return undefined for path outside roots", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///Users/test/project", name: "Project" }],
			});
			await service.refreshRoots();

			expect(service.getProjectForPath("/Users/other/path")).toBeUndefined();
		});

		it("should return project name for path within root", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///Users/test/my-project", name: "My Project" }],
			});
			await service.refreshRoots();

			expect(service.getProjectForPath("/Users/test/my-project/src")).toBe("My Project");
		});
	});

	describe("filterPathsToRoots", () => {
		it("should return all paths when no roots defined", () => {
			const paths = ["/a", "/b", "/c"];
			expect(service.filterPathsToRoots(paths)).toEqual(paths);
		});

		it("should filter paths to only those within roots", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///Users/test/project" }],
			});
			await service.refreshRoots();

			const paths = [
				"/Users/test/project/src/a.ts",
				"/Users/other/file.ts",
				"/Users/test/project/lib/b.ts",
			];

			expect(service.filterPathsToRoots(paths)).toEqual([
				"/Users/test/project/src/a.ts",
				"/Users/test/project/lib/b.ts",
			]);
		});
	});

	describe("buildProjectFilter", () => {
		it("should return undefined when no roots", () => {
			expect(service.buildProjectFilter()).toBeUndefined();
		});

		it("should return project names array", async () => {
			service.enable();
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [
					{ uri: "file:///project1", name: "P1" },
					{ uri: "file:///project2", name: "P2" },
				],
			});
			await service.refreshRoots();

			expect(service.buildProjectFilter()).toEqual(["P1", "P2"]);
		});
	});

	describe("notification handling", () => {
		it("should trigger refresh when roots list changed notification received", async () => {
			service.enable();

			// Get the notification handler that was registered
			const notificationHandler = mockServer.server.setNotificationHandler.mock.calls[0][1];

			// Mock the listRoots for the refresh triggered by notification
			mockServer.server.listRoots.mockResolvedValueOnce({
				roots: [{ uri: "file:///new-root", name: "New" }],
			});

			// Trigger the notification handler
			await notificationHandler();

			// Should have called listRoots
			expect(mockServer.server.listRoots).toHaveBeenCalled();
			expect(service.roots).toHaveLength(1);
			expect(service.roots[0].name).toBe("New");
		});
	});
});
