import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createFalkorClient } from "./falkor";

const client = createFalkorClient();

describe("FalkorClient", () => {
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
});
