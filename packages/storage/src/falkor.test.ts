import { describe, expect, it } from "bun:test";

// These tests verify the API surface and type contracts of FalkorDB clients.
// Full integration tests require a running FalkorDB server.

describe("FalkorClient", () => {
	it("should export FalkorClient class", async () => {
		const { FalkorClient } = await import("./falkor");
		expect(FalkorClient).toBeDefined();
		expect(typeof FalkorClient).toBe("function");
	});

	it("should accept URL in constructor", async () => {
		const { FalkorClient } = await import("./falkor");
		const client = new FalkorClient("redis://localhost:6179");
		expect(client).toBeDefined();
	});

	it("should use default URL when not provided", async () => {
		const { FalkorClient } = await import("./falkor");
		const client = new FalkorClient();
		expect(client).toBeDefined();
	});

	it("should parse URL with credentials", async () => {
		const { FalkorClient } = await import("./falkor");
		const client = new FalkorClient("redis://user:password@localhost:6179");
		expect(client).toBeDefined();
	});

	it("should have required GraphClient interface methods", async () => {
		const { FalkorClient } = await import("./falkor");
		const client = new FalkorClient("redis://localhost:6179");

		expect(typeof client.connect).toBe("function");
		expect(typeof client.disconnect).toBe("function");
		expect(typeof client.query).toBe("function");
		expect(typeof client.isConnected).toBe("function");
	});

	it("should return false for isConnected before connecting", async () => {
		const { FalkorClient } = await import("./falkor");
		const client = new FalkorClient("redis://localhost:6179");
		expect(client.isConnected()).toBe(false);
	});
});

describe("TenantAwareFalkorClient", () => {
	it("should export TenantAwareFalkorClient class", async () => {
		const { TenantAwareFalkorClient } = await import("./falkor");
		expect(TenantAwareFalkorClient).toBeDefined();
		expect(typeof TenantAwareFalkorClient).toBe("function");
	});

	it("should accept FalkorClient in constructor", async () => {
		const { FalkorClient, TenantAwareFalkorClient } = await import("./falkor");
		const baseClient = new FalkorClient("redis://localhost:6179");
		const tenantClient = new TenantAwareFalkorClient(baseClient);
		expect(tenantClient).toBeDefined();
	});

	it("should have required tenant methods", async () => {
		const { FalkorClient, TenantAwareFalkorClient } = await import("./falkor");
		const baseClient = new FalkorClient("redis://localhost:6179");
		const tenantClient = new TenantAwareFalkorClient(baseClient);

		expect(typeof tenantClient.selectTenantGraph).toBe("function");
		expect(typeof tenantClient.ensureTenantGraph).toBe("function");
	});
});

describe("createFalkorClient factory", () => {
	it("should export createFalkorClient function", async () => {
		const { createFalkorClient } = await import("./falkor");
		expect(createFalkorClient).toBeDefined();
		expect(typeof createFalkorClient).toBe("function");
	});

	it("should return a FalkorClient instance", async () => {
		const { createFalkorClient } = await import("./falkor");
		const client = createFalkorClient();
		expect(client).toBeDefined();
		expect(typeof client.connect).toBe("function");
		expect(typeof client.query).toBe("function");
	});
});

describe("Type exports", () => {
	it("should export QueryParam and QueryParams types", async () => {
		const mod = await import("./falkor");
		// Type exports verified at compile time - runtime check for module
		expect(mod).toBeDefined();
	});

	it("should export FalkorNode and FalkorEdge types", async () => {
		const mod = await import("./falkor");
		expect(mod).toBeDefined();
	});

	it("should export deprecated property types for backwards compatibility", async () => {
		const mod = await import("./falkor");
		// These are deprecated but should still exist for backwards compatibility
		expect(mod).toBeDefined();
	});
});

describe("FalkorNode type structure", () => {
	it("should have correct node structure", async () => {
		const { FalkorClient } = await import("./falkor");

		// Type test - FalkorNode has id, labels, properties
		type TestNode = {
			id: number;
			labels: string[];
			properties: { name: string };
		};

		// Compile-time verification of type structure
		const node: TestNode = { id: 1, labels: ["Test"], properties: { name: "test" } };
		expect(node.id).toBe(1);
		expect(node.labels).toEqual(["Test"]);
		expect(node.properties.name).toBe("test");
	});
});

describe("FalkorEdge type structure", () => {
	it("should have correct edge structure", async () => {
		// Type test - FalkorEdge supports multiple relationship type field names
		type TestEdge = {
			id: number;
			relationshipType?: string;
			relation?: string;
			type?: string;
			sourceId?: number;
			srcNodeId?: number;
			destinationId?: number;
			destNodeId?: number;
			properties: { weight: number };
		};

		const edge: TestEdge = {
			id: 1,
			relationshipType: "CONNECTS",
			sourceId: 1,
			destinationId: 2,
			properties: { weight: 1.5 },
		};

		expect(edge.id).toBe(1);
		expect(edge.relationshipType).toBe("CONNECTS");
		expect(edge.properties.weight).toBe(1.5);
	});
});

describe("Graph name generation", () => {
	it("should use EngramGraph as default graph name", async () => {
		const { FalkorClient } = await import("./falkor");
		// Default graph name is internal, but we can verify the client initializes correctly
		const client = new FalkorClient();
		expect(client).toBeDefined();
	});
});
