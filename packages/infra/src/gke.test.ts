/**
 * GKE Infrastructure Tests
 *
 * Tests for GKE Autopilot cluster configuration and kubeconfig generation.
 */

import { describe, expect, it } from "vitest";
// Import the infrastructure modules - mocks are already set up in vitest.setup.ts
import * as infra from "./gke";
import { getOutputValue, getResource, getResourcesByType } from "./testing";

describe("GKE Infrastructure", () => {
	describe("GKE Autopilot Cluster", () => {
		it("should create a GKE cluster when devEnabled=true", async () => {
			expect(infra.cluster).toBeDefined();
			if (!infra.cluster) return; // Type guard
			const name = await getOutputValue(infra.cluster.name);
			expect(name).toBe("engram-cluster");
		});

		it("should enable Autopilot mode", () => {
			const clusterResource = getResource("gcp:container/cluster:Cluster", "engram-cluster");
			expect(clusterResource).toBeDefined();
			expect(clusterResource?.inputs.enableAutopilot).toBe(true);
		});

		it("should be in the correct region", () => {
			const clusterResource = getResource("gcp:container/cluster:Cluster", "engram-cluster");
			expect(clusterResource?.inputs.location).toBe("us-central1");
		});

		it("should enable Vertical Pod Autoscaling", () => {
			const clusterResource = getResource("gcp:container/cluster:Cluster", "engram-cluster");
			expect(clusterResource?.inputs.verticalPodAutoscaling).toEqual({
				enabled: true,
			});
		});

		it("should use REGULAR release channel for stable updates", () => {
			const clusterResource = getResource("gcp:container/cluster:Cluster", "engram-cluster");
			expect(clusterResource?.inputs.releaseChannel).toEqual({
				channel: "REGULAR",
			});
		});

		it("should reference the VPC network", () => {
			const clusterResource = getResource("gcp:container/cluster:Cluster", "engram-cluster");
			expect(clusterResource?.inputs.network).toBeDefined();
		});

		it("should reference the subnet", () => {
			const clusterResource = getResource("gcp:container/cluster:Cluster", "engram-cluster");
			expect(clusterResource?.inputs.subnetwork).toBeDefined();
		});

		it("should have a description", () => {
			const clusterResource = getResource("gcp:container/cluster:Cluster", "engram-cluster");
			expect(clusterResource?.inputs.description).toBe("Engram services GKE Autopilot cluster");
		});

		it("should disable deletion protection for test stack", () => {
			const clusterResource = getResource("gcp:container/cluster:Cluster", "engram-cluster");
			// Test stack is not 'prod', so deletion protection should be false
			expect(clusterResource?.inputs.deletionProtection).toBe(false);
		});
	});

	describe("Kubeconfig Generation", () => {
		it("should generate a valid kubeconfig", async () => {
			const kubeconfig = await getOutputValue(infra.kubeconfig);
			expect(kubeconfig).toBeDefined();
			expect(typeof kubeconfig).toBe("string");
		});

		it("should contain the cluster endpoint", async () => {
			const kubeconfig = await getOutputValue(infra.kubeconfig);
			expect(kubeconfig).toContain("server: https://");
		});

		it("should contain certificate authority data", async () => {
			const kubeconfig = await getOutputValue(infra.kubeconfig);
			expect(kubeconfig).toContain("certificate-authority-data:");
		});

		it("should use gke-gcloud-auth-plugin for authentication", async () => {
			const kubeconfig = await getOutputValue(infra.kubeconfig);
			expect(kubeconfig).toContain("command: gke-gcloud-auth-plugin");
		});

		it("should include an install hint for the auth plugin", async () => {
			const kubeconfig = await getOutputValue(infra.kubeconfig);
			expect(kubeconfig).toContain("gcloud components install gke-gcloud-auth-plugin");
		});

		it("should have the correct API version", async () => {
			const kubeconfig = await getOutputValue(infra.kubeconfig);
			expect(kubeconfig).toContain("apiVersion: v1");
		});

		it("should have exactly one context", async () => {
			const kubeconfig = await getOutputValue(infra.kubeconfig);
			// Count occurrences of "- context:" (list item)
			const contextMatches = kubeconfig?.match(/- context:/g);
			expect(contextMatches).toHaveLength(1);
		});

		it("should set current-context to the cluster context", async () => {
			const kubeconfig = await getOutputValue(infra.kubeconfig);
			expect(kubeconfig).toContain("current-context: gke_test-project_us-central1_engram-cluster");
		});
	});

	describe("Resource Count", () => {
		it("should create exactly 1 GKE cluster", () => {
			const clusters = getResourcesByType("gcp:container/cluster:Cluster");
			expect(clusters).toHaveLength(1);
		});
	});
});
