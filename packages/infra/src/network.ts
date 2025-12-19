import * as gcp from "@pulumi/gcp";
import { gcpRegion, networkConfig } from "./config";

/**
 * Engram Network Infrastructure
 *
 * Creates a VPC network with a single regional subnet for the GKE cluster.
 * Auto-create subnetworks is disabled for explicit control over IP ranges.
 */

export const network = new gcp.compute.Network("engram-network", {
	autoCreateSubnetworks: false,
	description: "Primary VPC network for Engram services",
});

export const subnet = new gcp.compute.Subnetwork("engram-subnet", {
	ipCidrRange: networkConfig.cidrRange,
	region: gcpRegion,
	network: network.id,
	description: "Primary subnet for GKE cluster",
	privateIpGoogleAccess: true,
});

// Router for NAT (allows private GKE nodes to reach internet)
export const router = new gcp.compute.Router("engram-router", {
	region: gcpRegion,
	network: network.id,
});

export const nat = new gcp.compute.RouterNat("engram-nat", {
	router: router.name,
	region: gcpRegion,
	natIpAllocateOption: "AUTO_ONLY",
	sourceSubnetworkIpRangesToNat: "ALL_SUBNETWORKS_ALL_IP_RANGES",
	logConfig: {
		enable: true,
		filter: "ERRORS_ONLY",
	},
});
