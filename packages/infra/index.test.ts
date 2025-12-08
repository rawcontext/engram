import { describe, expect, it, mock } from "bun:test";

// Mock Pulumi
const mockResource = class {
	constructor(name: string, args: any) {
		this.name = name;
		this.args = args;
		this.id = "mock-id";
	}
	name: string;
	args: any;
	id: string;
};

mock.module("@pulumi/pulumi", () => ({
	all: (args: any[]) => ({
		apply: (fn: Function) => fn(args.map((a) => "mock-value")),
	}),
	Output: {
		create: (val: any) => val,
	},
}));

mock.module("@pulumi/gcp", () => ({
	config: {
		project: "test-project",
		zone: "test-zone",
	},
	compute: {
		Network: mockResource,
		Subnetwork: mockResource,
	},
	container: {
		Cluster: mockResource,
	},
	secretmanager: {
		Secret: mockResource,
	},
}));

describe("Infra Package", () => {
	it("should define resources without error", async () => {
		// Import the module to run the top-level code
		const infra = await import("./index");

		expect(infra.networkName).toBeDefined();
		expect(infra.clusterName).toBeDefined();
		expect(infra.kubeconfig).toBeDefined();
	});
});
