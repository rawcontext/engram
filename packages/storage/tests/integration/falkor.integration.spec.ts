/**
 * Integration tests for FalkorDB client.
 *
 * Tests FalkorClient and TenantAwareFalkorClient against real FalkorDB.
 * Run with: RUN_INTEGRATION_TESTS=1 bun test packages/storage/tests/integration/falkor.integration.spec.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FalkorClient, TenantAwareFalkorClient } from "../../src/falkor";
import {
	createTestGraphName,
	getFalkorDBUrl,
	shouldRunIntegrationTests,
	startFalkorDBContainer,
	stopAllContainers,
} from "./fixtures";

// Skip all tests if integration tests are not enabled
const runTests = shouldRunIntegrationTests();

describe.skipIf(!runTests)("FalkorClient Integration", () => {
	let client: FalkorClient;

	beforeAll(async () => {
		await startFalkorDBContainer();
		const url = getFalkorDBUrl();
		client = new FalkorClient(url);
	});

	afterAll(async () => {
		if (client) {
			await client.disconnect();
		}
		await stopAllContainers();
	});

	describe("Connection Lifecycle", () => {
		it("should connect successfully", async () => {
			await client.connect();
			expect(client.isConnected()).toBe(true);
		});

		it("should handle multiple connect calls (idempotent)", async () => {
			await client.connect();
			await client.connect();
			expect(client.isConnected()).toBe(true);
		});

		it("should report connected status", () => {
			expect(client.isConnected()).toBe(true);
		});
	});

	describe("Query Operations", () => {
		const testGraphName = createTestGraphName();

		it("should execute a simple query", async () => {
			const result = await client.query<{ n: number }>("RETURN 1 as n");
			expect(result).toHaveLength(1);
			expect(result[0].n).toBe(1);
		});

		it("should execute query with parameters", async () => {
			const result = await client.query<{ sum: number }>("RETURN $a + $b as sum", { a: 10, b: 20 });
			expect(result).toHaveLength(1);
			expect(result[0].sum).toBe(30);
		});

		it("should create and query nodes", async () => {
			// Create a test node
			await client.query("CREATE (n:TestNode {id: $id, name: $name})", {
				id: "test-1",
				name: "Test Node",
			});

			// Query the node
			const result = await client.query<{ n: { properties: { id: string; name: string } } }>(
				"MATCH (n:TestNode {id: $id}) RETURN n",
				{ id: "test-1" },
			);

			expect(result).toHaveLength(1);
			expect(result[0].n.properties.id).toBe("test-1");
			expect(result[0].n.properties.name).toBe("Test Node");

			// Cleanup
			await client.query("MATCH (n:TestNode {id: $id}) DELETE n", { id: "test-1" });
		});

		it("should create and query relationships", async () => {
			// Create nodes and relationship
			await client.query(`
				CREATE (a:Person {id: 'person-1', name: 'Alice'})
				CREATE (b:Person {id: 'person-2', name: 'Bob'})
				CREATE (a)-[:KNOWS {since: 2020}]->(b)
			`);

			// Query the relationship
			const result = await client.query<{
				a: { properties: { name: string } };
				b: { properties: { name: string } };
				r: { properties: { since: number } };
			}>("MATCH (a:Person)-[r:KNOWS]->(b:Person) RETURN a, r, b");

			expect(result).toHaveLength(1);
			expect(result[0].a.properties.name).toBe("Alice");
			expect(result[0].b.properties.name).toBe("Bob");
			expect(result[0].r.properties.since).toBe(2020);

			// Cleanup
			await client.query("MATCH (n:Person) DETACH DELETE n");
		});

		it("should handle empty result sets", async () => {
			const result = await client.query<{ n: unknown }>("MATCH (n:NonExistentLabel) RETURN n");
			expect(result).toHaveLength(0);
		});

		it("should handle array parameters", async () => {
			await client.query("CREATE (n:ArrayTest {id: $id, tags: $tags})", {
				id: "array-test",
				tags: ["tag1", "tag2", "tag3"],
			});

			const result = await client.query<{ tags: string[] }>(
				"MATCH (n:ArrayTest {id: $id}) RETURN n.tags as tags",
				{ id: "array-test" },
			);

			expect(result).toHaveLength(1);
			expect(result[0].tags).toEqual(["tag1", "tag2", "tag3"]);

			// Cleanup
			await client.query("MATCH (n:ArrayTest) DELETE n");
		});
	});

	describe("Disconnect", () => {
		it("should disconnect successfully", async () => {
			// Create a new client for this test
			const tempClient = new FalkorClient(getFalkorDBUrl());
			await tempClient.connect();
			expect(tempClient.isConnected()).toBe(true);

			await tempClient.disconnect();
			expect(tempClient.isConnected()).toBe(false);
		});

		it("should handle multiple disconnect calls", async () => {
			const tempClient = new FalkorClient(getFalkorDBUrl());
			await tempClient.connect();
			await tempClient.disconnect();
			await tempClient.disconnect(); // Should not throw
			expect(tempClient.isConnected()).toBe(false);
		});
	});
});

describe.skipIf(!runTests)("TenantAwareFalkorClient Integration", () => {
	let baseClient: FalkorClient;
	let tenantClient: TenantAwareFalkorClient;

	const testTenant = {
		orgId: "test-org-123",
		orgSlug: "test-org",
		userId: "user-123",
		isAdmin: false,
	};

	beforeAll(async () => {
		await startFalkorDBContainer();
		const url = getFalkorDBUrl();
		baseClient = new FalkorClient(url);
		tenantClient = new TenantAwareFalkorClient(baseClient);
	});

	afterAll(async () => {
		if (baseClient) {
			await baseClient.disconnect();
		}
		await stopAllContainers();
	});

	describe("Tenant Graph Selection", () => {
		it("should select tenant-specific graph", async () => {
			const graph = await tenantClient.selectTenantGraph(testTenant);
			expect(graph).toBeDefined();

			// Verify we can query the graph
			const result = await graph.query("RETURN 1 as n");
			expect(result.data).toHaveLength(1);
		});

		it("should isolate data between tenants", async () => {
			const tenant1 = { ...testTenant, orgId: "org-1", orgSlug: "org1" };
			const tenant2 = { ...testTenant, orgId: "org-2", orgSlug: "org2" };

			const graph1 = await tenantClient.selectTenantGraph(tenant1);
			const graph2 = await tenantClient.selectTenantGraph(tenant2);

			// Create data in tenant 1's graph
			await graph1.query("CREATE (n:TenantData {id: 'data-1', tenant: 'org-1'})");

			// Verify data is not visible in tenant 2's graph
			const result1 = await graph1.query("MATCH (n:TenantData) RETURN n");
			const result2 = await graph2.query("MATCH (n:TenantData) RETURN n");

			expect(result1.data).toHaveLength(1);
			expect(result2.data).toHaveLength(0);

			// Cleanup
			await graph1.query("MATCH (n:TenantData) DELETE n");
		});
	});

	describe("Tenant Graph Initialization", () => {
		it("should ensure tenant graph with indexes", async () => {
			const graph = await tenantClient.ensureTenantGraph(testTenant);
			expect(graph).toBeDefined();

			// Verify indexes were created by creating and querying nodes
			await graph.query("CREATE (s:Session {id: 'session-test'})");
			await graph.query("CREATE (t:Turn {id: 'turn-test'})");
			await graph.query("CREATE (m:Memory {id: 'memory-test'})");

			// Query using indexed fields
			const sessions = await graph.query("MATCH (s:Session {id: 'session-test'}) RETURN s");
			const turns = await graph.query("MATCH (t:Turn {id: 'turn-test'}) RETURN t");
			const memories = await graph.query("MATCH (m:Memory {id: 'memory-test'}) RETURN m");

			expect(sessions.data).toHaveLength(1);
			expect(turns.data).toHaveLength(1);
			expect(memories.data).toHaveLength(1);

			// Cleanup
			await graph.query("MATCH (n) WHERE n:Session OR n:Turn OR n:Memory DELETE n");
		});

		it("should be idempotent (multiple calls don't fail)", async () => {
			const graph1 = await tenantClient.ensureTenantGraph(testTenant);
			const graph2 = await tenantClient.ensureTenantGraph(testTenant);

			expect(graph1).toBeDefined();
			expect(graph2).toBeDefined();
		});
	});
});
