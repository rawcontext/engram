/**
 * Network Infrastructure Tests
 *
 * Tests for VPC network, subnet, router, and Cloud NAT configuration.
 */

import { describe, expect, it } from "vitest";
// Import the infrastructure modules - mocks are already set up in vitest.setup.ts
import * as infra from "./network";
import { getOutputValue, getResource, getResourcesByType } from "./testing";

describe("Network Infrastructure", () => {
	describe("VPC Network", () => {
		it("should create a VPC network", async () => {
			const name = await getOutputValue(infra.network.name);
			expect(name).toBe("engram-network");
		});

		it("should disable auto-create subnetworks for explicit control", () => {
			const networkResource = getResource("gcp:compute/network:Network", "engram-network");
			expect(networkResource).toBeDefined();
			expect(networkResource?.inputs.autoCreateSubnetworks).toBe(false);
		});

		it("should have a description", () => {
			const networkResource = getResource("gcp:compute/network:Network", "engram-network");
			expect(networkResource?.inputs.description).toBe("Primary VPC network for Engram services");
		});
	});

	describe("Subnet", () => {
		it("should create a subnet", async () => {
			const name = await getOutputValue(infra.subnet.name);
			expect(name).toBe("engram-subnet");
		});

		it("should configure the correct CIDR range", () => {
			const subnetResource = getResource("gcp:compute/subnetwork:Subnetwork", "engram-subnet");
			expect(subnetResource).toBeDefined();
			// Default CIDR from config
			expect(subnetResource?.inputs.ipCidrRange).toBe("10.0.0.0/16");
		});

		it("should enable private Google access", () => {
			const subnetResource = getResource("gcp:compute/subnetwork:Subnetwork", "engram-subnet");
			expect(subnetResource?.inputs.privateIpGoogleAccess).toBe(true);
		});

		it("should be in the correct region", () => {
			const subnetResource = getResource("gcp:compute/subnetwork:Subnetwork", "engram-subnet");
			expect(subnetResource?.inputs.region).toBe("us-central1");
		});

		it("should reference the parent network", () => {
			const subnetResource = getResource("gcp:compute/subnetwork:Subnetwork", "engram-subnet");
			// The network reference is passed as an Output, check it exists
			expect(subnetResource?.inputs.network).toBeDefined();
		});
	});

	describe("Cloud Router", () => {
		it("should create a router", async () => {
			const name = await getOutputValue(infra.router.name);
			expect(name).toBe("engram-router");
		});

		it("should be in the correct region", () => {
			const routerResource = getResource("gcp:compute/router:Router", "engram-router");
			expect(routerResource?.inputs.region).toBe("us-central1");
		});

		it("should reference the VPC network", () => {
			const routerResource = getResource("gcp:compute/router:Router", "engram-router");
			expect(routerResource?.inputs.network).toBeDefined();
		});
	});

	describe("Cloud NAT", () => {
		it("should create a NAT gateway", async () => {
			const name = await getOutputValue(infra.nat.name);
			expect(name).toBe("engram-nat");
		});

		it("should use AUTO_ONLY for IP allocation", () => {
			const natResource = getResource("gcp:compute/routerNat:RouterNat", "engram-nat");
			expect(natResource?.inputs.natIpAllocateOption).toBe("AUTO_ONLY");
		});

		it("should NAT all subnetworks", () => {
			const natResource = getResource("gcp:compute/routerNat:RouterNat", "engram-nat");
			expect(natResource?.inputs.sourceSubnetworkIpRangesToNat).toBe(
				"ALL_SUBNETWORKS_ALL_IP_RANGES",
			);
		});

		it("should enable error-only logging", () => {
			const natResource = getResource("gcp:compute/routerNat:RouterNat", "engram-nat");
			expect(natResource?.inputs.logConfig).toEqual({
				enable: true,
				filter: "ERRORS_ONLY",
			});
		});

		it("should reference the router", () => {
			const natResource = getResource("gcp:compute/routerNat:RouterNat", "engram-nat");
			expect(natResource?.inputs.router).toBeDefined();
		});
	});

	describe("Resource Count", () => {
		it("should create exactly 4 network resources", () => {
			const networks = getResourcesByType("gcp:compute/network:Network");
			const subnets = getResourcesByType("gcp:compute/subnetwork:Subnetwork");
			const routers = getResourcesByType("gcp:compute/router:Router");
			const nats = getResourcesByType("gcp:compute/routerNat:RouterNat");

			expect(networks).toHaveLength(1);
			expect(subnets).toHaveLength(1);
			expect(routers).toHaveLength(1);
			expect(nats).toHaveLength(1);
		});
	});
});
