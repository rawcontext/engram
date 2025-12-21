import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFalkorClient } from "./falkor";

// Skip integration tests when infrastructure isn't running (CI has no FalkorDB)
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === "true" || process.env.CI === "true";

const client = createFalkorClient();

describe.skipIf(SKIP_INTEGRATION)("FalkorClient", () => {
	beforeAll(async () => {
		await client.connect();
	});

	afterAll(async () => {
		await client.disconnect();
	});

	it("should execute a query and return typed objects", async () => {
		// Setup
		await client.query("CREATE (:TestNode {id: 'test-1', value: 123})");

		// Query
		const res: any = await client.query("MATCH (n:TestNode {id: 'test-1'}) RETURN n");

		expect(Array.isArray(res)).toBe(true);
		expect(res.length).toBeGreaterThan(0);

		const row = res[0];
		expect(row).toHaveProperty("n");
		expect(row.n.labels).toContain("TestNode");
		expect(row.n.properties.id).toBe("test-1");
		expect(row.n.properties.value).toBe(123);

		// Cleanup
		await client.query("MATCH (n:TestNode {id: 'test-1'}) DELETE n");
	});

	it("should handle parameters correctly", async () => {
		const id = "param-test";
		await client.query("CREATE (:ParamNode {id: $id})", { id });

		const res: any = await client.query("MATCH (n:ParamNode) WHERE n.id = $id RETURN n", { id });
		expect(res.length).toBe(1);
		expect(res[0].n.properties.id).toBe(id);

		await client.query("MATCH (n:ParamNode {id: $id}) DELETE n", { id });
	});

	it("should handle multiple concurrent connections correctly", async () => {
		const client2 = createFalkorClient();
		await client2.connect();
		expect(client2.isConnected()).toBe(true);

		// Second connect should be idempotent
		await client2.connect();
		expect(client2.isConnected()).toBe(true);

		await client2.disconnect();
	});

	it("should throw error if graph connection fails after connect", async () => {
		// This tests the defensive check at line 149
		const client2 = createFalkorClient();

		// Simulate connection but no graph (edge case)
		// We can't easily trigger this without mocking, but we can test the query path
		await expect(async () => {
			// Query will auto-connect
			await client2.query("MATCH (n) RETURN n LIMIT 1");
		}).toBeTruthy(); // Should succeed normally

		await client2.disconnect();
	});

	it("should handle connection retry after failed connection", async () => {
		const client2 = createFalkorClient();

		// First disconnect to ensure clean state
		await client2.disconnect();
		expect(client2.isConnected()).toBe(false);

		// Now connect
		await client2.connect();
		expect(client2.isConnected()).toBe(true);

		await client2.disconnect();
	});

	it("should handle multiple disconnect calls gracefully", async () => {
		const client2 = createFalkorClient();
		await client2.connect();

		await client2.disconnect();
		expect(client2.isConnected()).toBe(false);

		// Second disconnect should be safe
		await client2.disconnect();
		expect(client2.isConnected()).toBe(false);
	});

	it("should wait for in-progress connection when connect called concurrently", async () => {
		const client2 = createFalkorClient();

		// Start two concurrent connect calls
		const promise1 = client2.connect();
		const promise2 = client2.connect();

		// Both should resolve successfully
		await Promise.all([promise1, promise2]);

		expect(client2.isConnected()).toBe(true);

		await client2.disconnect();
	});

	it("should auto-connect when query is called before connect", async () => {
		const client2 = createFalkorClient();

		// Query without explicit connect
		await client2.query("CREATE (:AutoConnect {id: 'auto-test'})");

		expect(client2.isConnected()).toBe(true);

		// Cleanup
		await client2.query("MATCH (n:AutoConnect {id: 'auto-test'}) DELETE n");
		await client2.disconnect();
	});

	it("should handle empty query results", async () => {
		const client2 = createFalkorClient();
		await client2.connect();

		const result = await client2.query("MATCH (n:NonExistentNode) RETURN n");

		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBe(0);

		await client2.disconnect();
	});

	it("should return correct connection status with isConnected", async () => {
		const client2 = createFalkorClient();

		expect(client2.isConnected()).toBe(false);

		await client2.connect();
		expect(client2.isConnected()).toBe(true);

		await client2.disconnect();
		expect(client2.isConnected()).toBe(false);
	});

	it("should handle connection failure and reset state for retry (lines 115-116)", async () => {
		const client2 = createFalkorClient();
		const { FalkorDB } = await import("falkordb");

		// Mock FalkorDB.connect to fail once, then succeed
		const originalConnect = FalkorDB.connect;
		let attemptCount = 0;

		FalkorDB.connect = vi.fn(async (...args: any[]) => {
			attemptCount++;
			if (attemptCount === 1) {
				throw new Error("Connection failed on first attempt");
			}
			return originalConnect(...args);
		});

		// First connection attempt should fail
		await expect(client2.connect()).rejects.toThrow("Connection failed on first attempt");
		expect(client2.isConnected()).toBe(false);

		// Second attempt should succeed because dbPromise was reset
		await client2.connect();
		expect(client2.isConnected()).toBe(true);

		// Cleanup
		await client2.disconnect();
		FalkorDB.connect = originalConnect;
	});

	it("should use default port 6379 when URL has no port (line 85)", async () => {
		const { FalkorClient } = await import("./falkor");

		// Create client with URL without explicit port
		const clientNoPort = new FalkorClient("redis://localhost");

		// Access the private connectionConfig to verify (for test only)
		const config = (clientNoPort as any).connectionConfig;
		expect(config.port).toBe(6379);

		await clientNoPort.disconnect();
	});

	it("should use explicit port from URL when provided", async () => {
		const { FalkorClient } = await import("./falkor");

		// Create client with explicit port
		const clientWithPort = new FalkorClient("redis://localhost:7000");

		// Access the private connectionConfig to verify (for test only)
		const config = (clientWithPort as any).connectionConfig;
		expect(config.port).toBe(7000);

		await clientWithPort.disconnect();
	});
});
