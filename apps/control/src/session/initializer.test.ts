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
});
