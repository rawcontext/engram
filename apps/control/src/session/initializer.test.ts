import type { FalkorClient, GraphClient } from "@engram/storage";
import { describe, expect, it, vi } from "vitest";
import { createSessionInitializer, SessionInitializer } from "./initializer";

describe("SessionInitializer", () => {
	it("should create a session if it does not exist", async () => {
		const mockQuery = vi.fn((query: string, _params: Record<string, unknown>) => {
			if (query.includes("MATCH")) return Promise.resolve([]); // Not found
			return Promise.resolve([["s"]]); // Created
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const initializer = new SessionInitializer(mockFalkor);
		await initializer.ensureSession("session-123");

		expect(mockQuery).toHaveBeenCalledTimes(2);
		expect(mockQuery.mock.calls[1][0]).toContain("CREATE (s:Session");
	});

	it("should not create a session if it exists", async () => {
		const mockQuery = vi.fn((_query: string, _params: Record<string, unknown>) => {
			return Promise.resolve([["existing"]]); // Found
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const initializer = new SessionInitializer(mockFalkor);
		await initializer.ensureSession("session-123");

		expect(mockQuery).toHaveBeenCalledTimes(1);
		expect(mockQuery.mock.calls[0][0]).toContain("MATCH");
	});

	it("should create with default dependencies when no args provided", () => {
		const initializer = new SessionInitializer();

		expect(initializer).toBeInstanceOf(SessionInitializer);
	});

	it("should create with new deps object constructor", async () => {
		const mockGraphClient: GraphClient = {
			connect: vi.fn(),
			disconnect: vi.fn(),
			query: vi.fn().mockResolvedValue([["existing"]]),
			isConnected: vi.fn().mockReturnValue(true),
		};

		const mockLogger = {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		};

		const initializer = new SessionInitializer({
			graphClient: mockGraphClient,
			logger: mockLogger,
		});

		await initializer.ensureSession("test-session");

		expect(mockGraphClient.query).toHaveBeenCalled();
	});

	it("should create via factory function", () => {
		const initializer = createSessionInitializer();

		expect(initializer).toBeInstanceOf(SessionInitializer);
	});

	it("should create via factory function with deps", () => {
		const mockGraphClient: GraphClient = {
			connect: vi.fn(),
			disconnect: vi.fn(),
			query: vi.fn(),
			isConnected: vi.fn(),
		};

		const initializer = createSessionInitializer({
			graphClient: mockGraphClient,
		});

		expect(initializer).toBeInstanceOf(SessionInitializer);
	});

	it("should handle legacy FalkorClient constructor", async () => {
		const mockQuery = vi.fn((query: string, _params: Record<string, unknown>) => {
			if (query.includes("MATCH")) return Promise.resolve([]); // Not found
			return Promise.resolve([["s"]]); // Created
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		// Use legacy constructor directly (passing FalkorClient, not deps object)
		const initializer = new SessionInitializer(mockFalkor);
		await initializer.ensureSession("legacy-session");

		expect(mockQuery).toHaveBeenCalledTimes(2);
	});

	it("should handle non-array query results", async () => {
		const mockQuery = vi.fn((_query: string, _params: Record<string, unknown>) => {
			// Return non-array that is truthy (edge case)
			return Promise.resolve("not-an-array");
		});

		const mockGraphClient = {
			query: mockQuery,
		} as unknown as GraphClient;

		const initializer = new SessionInitializer({ graphClient: mockGraphClient });
		await initializer.ensureSession("test-session");

		// Should attempt to create session since check will fail
		expect(mockQuery).toHaveBeenCalledTimes(2);
	});

	it("should include bitemporal fields when creating session", async () => {
		let createdFields: any = null;
		const mockQuery = vi.fn((query: string, params: Record<string, unknown>) => {
			if (query.includes("MATCH")) return Promise.resolve([]); // Not found
			if (query.includes("CREATE")) {
				createdFields = params;
				return Promise.resolve([["s"]]); // Created
			}
			return Promise.resolve([]);
		});

		const mockGraphClient = {
			query: mockQuery,
		} as unknown as GraphClient;

		const initializer = new SessionInitializer({ graphClient: mockGraphClient });
		await initializer.ensureSession("bitemporal-session");

		expect(createdFields).toBeDefined();
		expect(createdFields.nowMs).toBeDefined();
		expect(createdFields.maxDate).toBe(253402300799000);
		expect(createdFields.id).toBe("bitemporal-session");
	});
});
