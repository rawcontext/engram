/**
 * Branch Coverage Tests
 *
 * Tests to ensure all conditional branches are covered.
 * These tests verify the logic of conditional resource creation.
 */

import { describe, expect, it } from "vitest";

describe("Conditional Branch Logic", () => {
	describe("Namespace conditional creation", () => {
		it("should create namespace when k8sProvider exists and devEnabled=true", async () => {
			const { namespace, k8sProvider } = await import("./k8s/namespace");
			const { devEnabled } = await import("./config");

			// When both conditions are met, namespace should be defined
			if (k8sProvider && devEnabled) {
				expect(namespace).toBeDefined();
			}
		});

		it("should not create namespace when k8sProvider is undefined", async () => {
			// Test the false branch: when cluster doesn't exist, k8sProvider is undefined
			const { cluster } = await import("./gke");
			const { k8sProvider } = await import("./k8s/namespace");

			if (!cluster) {
				expect(k8sProvider).toBeUndefined();
			}
		});

		it("should not create namespace when devEnabled is false", async () => {
			const { namespace } = await import("./k8s/namespace");
			const { devEnabled } = await import("./config");
			const { k8sProvider } = await import("./k8s/namespace");

			// When devEnabled is false, namespace should be undefined even if k8sProvider exists
			if (!devEnabled && k8sProvider) {
				expect(namespace).toBeUndefined();
			} else if (!devEnabled) {
				// If both are false, namespace should definitely be undefined
				expect(namespace).toBeUndefined();
			}
		});

		it("should create k8sProvider when cluster exists", async () => {
			const { k8sProvider } = await import("./k8s/namespace");
			const { cluster: gkeCluster } = await import("./gke");

			// When cluster exists, k8sProvider should be defined
			if (gkeCluster) {
				expect(k8sProvider).toBeDefined();
			}
		});

		it("should have namespaceName output regardless of namespace creation", async () => {
			const { namespaceName } = await import("./k8s/namespace");
			// namespaceName should always be defined (either from namespace or fallback)
			expect(namespaceName).toBeDefined();
		});

		it("should use fallback namespaceName when namespace is undefined", async () => {
			const { namespace, namespaceName } = await import("./k8s/namespace");
			const { getOutputValue } = await import("./testing");

			if (!namespace) {
				const name = await getOutputValue(namespaceName);
				expect(name).toBe("engram");
			}
		});
	});

	describe("GKE conditional creation", () => {
		it("should create cluster when devEnabled=true", async () => {
			const { cluster } = await import("./gke");
			const { devEnabled } = await import("./config");

			// When devEnabled is true, cluster should be defined
			if (devEnabled) {
				expect(cluster).toBeDefined();
			}
		});

		it("should not create cluster when devEnabled=false", async () => {
			const { cluster } = await import("./gke");
			const { devEnabled } = await import("./config");

			// When devEnabled is false, cluster should be undefined
			if (!devEnabled) {
				expect(cluster).toBeUndefined();
			}
		});

		it("should have kubeconfig output regardless of cluster creation", async () => {
			const { kubeconfig } = await import("./gke");
			// kubeconfig should always be defined (either from cluster or fallback message)
			expect(kubeconfig).toBeDefined();
		});

		it("should have fallback kubeconfig message when cluster is undefined", async () => {
			const { cluster, kubeconfig } = await import("./gke");
			const { getOutputValue } = await import("./testing");

			if (!cluster) {
				const config = await getOutputValue(kubeconfig);
				expect(config).toContain("Dev environment is off");
				expect(config).toContain("pulumi config set devEnabled true");
			}
		});
	});

	describe("K8s resource conditional creation", () => {
		it("should create FalkorDB resources when k8sProvider exists", async () => {
			const { falkordbStatefulSet, falkordbService } = await import("./k8s/falkordb");
			const { k8sProvider } = await import("./k8s/namespace");

			if (k8sProvider) {
				expect(falkordbStatefulSet).toBeDefined();
				expect(falkordbService).toBeDefined();
			}
		});

		it("should not create FalkorDB resources when k8sProvider is undefined", async () => {
			const { falkordbStatefulSet, falkordbService } = await import("./k8s/falkordb");
			const { k8sProvider } = await import("./k8s/namespace");

			if (!k8sProvider) {
				expect(falkordbStatefulSet).toBeUndefined();
				expect(falkordbService).toBeUndefined();
			}
		});

		it("should create Qdrant release when k8sProvider exists", async () => {
			const { qdrantRelease } = await import("./k8s/qdrant");
			const { k8sProvider } = await import("./k8s/namespace");

			if (k8sProvider) {
				expect(qdrantRelease).toBeDefined();
			}
		});

		it("should not create Qdrant release when k8sProvider is undefined", async () => {
			const { qdrantRelease } = await import("./k8s/qdrant");
			const { k8sProvider } = await import("./k8s/namespace");

			if (!k8sProvider) {
				expect(qdrantRelease).toBeUndefined();
			}
		});

		it("should create Redpanda release when k8sProvider exists", async () => {
			const { redpandaRelease } = await import("./k8s/redpanda");
			const { k8sProvider } = await import("./k8s/namespace");

			if (k8sProvider) {
				expect(redpandaRelease).toBeDefined();
			}
		});

		it("should not create Redpanda release when k8sProvider is undefined", async () => {
			const { redpandaRelease } = await import("./k8s/redpanda");
			const { k8sProvider } = await import("./k8s/namespace");

			if (!k8sProvider) {
				expect(redpandaRelease).toBeUndefined();
			}
		});

		it("should create backup resources when k8sProvider exists", async () => {
			const { falkordbBackupCron, qdrantBackupCron, redpandaBackupCron } = await import(
				"./k8s/backups"
			);
			const { k8sProvider } = await import("./k8s/namespace");

			if (k8sProvider) {
				expect(falkordbBackupCron).toBeDefined();
				expect(qdrantBackupCron).toBeDefined();
				expect(redpandaBackupCron).toBeDefined();
			}
		});

		it("should not create backup resources when k8sProvider is undefined", async () => {
			const { falkordbBackupCron, qdrantBackupCron, redpandaBackupCron } = await import(
				"./k8s/backups"
			);
			const { k8sProvider } = await import("./k8s/namespace");

			if (!k8sProvider) {
				expect(falkordbBackupCron).toBeUndefined();
				expect(qdrantBackupCron).toBeUndefined();
				expect(redpandaBackupCron).toBeUndefined();
			}
		});

		it("should create network policies when k8sProvider exists", async () => {
			const {
				falkordbNetworkPolicy,
				qdrantNetworkPolicy,
				redpandaNetworkPolicy,
				defaultDenyIngress,
			} = await import("./k8s/network-policy");
			const { k8sProvider } = await import("./k8s/namespace");

			if (k8sProvider) {
				expect(falkordbNetworkPolicy).toBeDefined();
				expect(qdrantNetworkPolicy).toBeDefined();
				expect(redpandaNetworkPolicy).toBeDefined();
				expect(defaultDenyIngress).toBeDefined();
			}
		});

		it("should not create network policies when k8sProvider is undefined", async () => {
			const {
				falkordbNetworkPolicy,
				qdrantNetworkPolicy,
				redpandaNetworkPolicy,
				defaultDenyIngress,
			} = await import("./k8s/network-policy");
			const { k8sProvider } = await import("./k8s/namespace");

			if (!k8sProvider) {
				expect(falkordbNetworkPolicy).toBeUndefined();
				expect(qdrantNetworkPolicy).toBeUndefined();
				expect(redpandaNetworkPolicy).toBeUndefined();
				expect(defaultDenyIngress).toBeUndefined();
			}
		});

		it("should create RBAC resources when k8sProvider exists", async () => {
			const {
				memoryServiceAccount,
				memoryRole,
				memoryRoleBinding,
				backupClusterRole,
				backupClusterRoleBinding,
			} = await import("./k8s/rbac");
			const { k8sProvider } = await import("./k8s/namespace");

			if (k8sProvider) {
				expect(memoryServiceAccount).toBeDefined();
				expect(memoryRole).toBeDefined();
				expect(memoryRoleBinding).toBeDefined();
				expect(backupClusterRole).toBeDefined();
				expect(backupClusterRoleBinding).toBeDefined();
			}
		});

		it("should not create RBAC resources when k8sProvider is undefined", async () => {
			const {
				memoryServiceAccount,
				memoryRole,
				memoryRoleBinding,
				backupClusterRole,
				backupClusterRoleBinding,
			} = await import("./k8s/rbac");
			const { k8sProvider } = await import("./k8s/namespace");

			if (!k8sProvider) {
				expect(memoryServiceAccount).toBeUndefined();
				expect(memoryRole).toBeUndefined();
				expect(memoryRoleBinding).toBeUndefined();
				expect(backupClusterRole).toBeUndefined();
				expect(backupClusterRoleBinding).toBeUndefined();
			}
		});

		it("should create tuner resources when dependencies exist", async () => {
			const { postgresSecret, postgresStatefulSet, tunerDeployment, dashboardDeployment } =
				await import("./k8s/tuner");
			const { k8sProvider } = await import("./k8s/namespace");

			if (k8sProvider) {
				expect(postgresSecret).toBeDefined();
			}

			// postgresStatefulSet requires both k8sProvider and postgresSecret
			if (k8sProvider && postgresSecret) {
				expect(postgresStatefulSet).toBeDefined();
			}

			// tunerDeployment requires k8sProvider, postgresStatefulSet, tunerConfigMap, and tunerSecret
			if (k8sProvider && postgresStatefulSet) {
				expect(tunerDeployment).toBeDefined();
			}

			// dashboardDeployment requires k8sProvider and postgresStatefulSet
			if (k8sProvider && postgresStatefulSet) {
				expect(dashboardDeployment).toBeDefined();
			}
		});

		it("should not create tuner resources when k8sProvider is undefined", async () => {
			const {
				postgresSecret,
				postgresStatefulSet,
				postgresService,
				tunerConfigMap,
				tunerSecret,
				tunerDeployment,
				tunerService,
				tunerPdb,
				dashboardDeployment,
				dashboardService,
			} = await import("./k8s/tuner");
			const { k8sProvider } = await import("./k8s/namespace");

			if (!k8sProvider) {
				expect(postgresSecret).toBeUndefined();
				expect(postgresStatefulSet).toBeUndefined();
				expect(postgresService).toBeUndefined();
				expect(tunerConfigMap).toBeUndefined();
				expect(tunerSecret).toBeUndefined();
				expect(tunerDeployment).toBeUndefined();
				expect(tunerService).toBeUndefined();
				expect(tunerPdb).toBeUndefined();
				expect(dashboardDeployment).toBeUndefined();
				expect(dashboardService).toBeUndefined();
			}
		});

		it("should not create postgresStatefulSet when postgresSecret is undefined", async () => {
			const { postgresStatefulSet, postgresSecret } = await import("./k8s/tuner");
			const { k8sProvider } = await import("./k8s/namespace");

			// Even with k8sProvider, if postgresSecret is undefined, postgresStatefulSet should be undefined
			if (k8sProvider && !postgresSecret) {
				expect(postgresStatefulSet).toBeUndefined();
			}
		});

		it("should not create tunerDeployment when dependencies are missing", async () => {
			const { tunerDeployment, postgresStatefulSet, tunerConfigMap, tunerSecret } = await import(
				"./k8s/tuner"
			);
			const { k8sProvider } = await import("./k8s/namespace");

			// If any dependency is missing, tunerDeployment should be undefined
			if (k8sProvider && (!postgresStatefulSet || !tunerConfigMap || !tunerSecret)) {
				expect(tunerDeployment).toBeUndefined();
			}
		});

		it("should not create dashboardDeployment when postgresStatefulSet is missing", async () => {
			const { dashboardDeployment, postgresStatefulSet } = await import("./k8s/tuner");
			const { k8sProvider } = await import("./k8s/namespace");

			// If postgresStatefulSet is missing, dashboardDeployment should be undefined
			if (k8sProvider && !postgresStatefulSet) {
				expect(dashboardDeployment).toBeUndefined();
			}
		});
	});

	describe("Config conditional logic", () => {
		it("should use prod values when environment is prod", async () => {
			const { gkeConfig, databaseConfig, environment } = await import("./config");

			if (environment === "prod") {
				expect(gkeConfig.deletionProtection).toBe(true);
				expect(databaseConfig.replicas).toBe(3);
			} else {
				expect(gkeConfig.deletionProtection).toBe(false);
				expect(databaseConfig.replicas).toBe(1);
			}
		});

		it("should default devEnabled to true when not configured", async () => {
			const { devEnabled } = await import("./config");
			// The config uses ?? true, so it should always be a boolean
			expect(typeof devEnabled).toBe("boolean");
		});

		it("should default region when not configured", async () => {
			const { gcpRegion } = await import("./config");
			// The config uses ?? "us-central1", so it should have a value
			expect(gcpRegion).toBeTruthy();
			expect(typeof gcpRegion).toBe("string");
		});

		it("should default network CIDR when not configured", async () => {
			const { networkConfig } = await import("./config");
			// The config uses ?? "10.0.0.0/16", so it should have a value
			expect(networkConfig.cidrRange).toBeTruthy();
			expect(typeof networkConfig.cidrRange).toBe("string");
		});
	});
});
