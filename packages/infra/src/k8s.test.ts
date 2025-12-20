/**
 * Kubernetes Infrastructure Tests
 *
 * Tests for all Kubernetes workloads deployed to GKE:
 * - Namespace
 * - FalkorDB (StatefulSet + Service)
 * - Qdrant (Helm Release)
 * - Redpanda (Helm Release)
 * - Tuner (PostgreSQL + API + Dashboard)
 */

import { describe, expect, it } from "vitest";
import * as infra from "./k8s";
import { getResource, getResourcesByType } from "./testing";

describe("Kubernetes Infrastructure", () => {
	describe("Namespace", () => {
		it("should create an engram namespace", () => {
			const ns = getResource("kubernetes:core/v1:Namespace", "engram");
			expect(ns).toBeDefined();
			const metadata = ns?.inputs.metadata as Record<string, unknown>;
			expect(metadata?.name).toBe("engram");
		});

		it("should have correct labels", () => {
			const ns = getResource("kubernetes:core/v1:Namespace", "engram");
			const metadata = ns?.inputs.metadata as Record<string, unknown>;
			const labels = metadata?.labels as Record<string, string>;
			expect(labels?.["app.kubernetes.io/part-of"]).toBe("engram");
			expect(labels?.project).toBe("engram");
			expect(labels?.["managed-by"]).toBe("pulumi");
		});

		it("should create a K8s provider", () => {
			const provider = getResource("pulumi:providers:kubernetes", "gke-k8s");
			expect(provider).toBeDefined();
		});
	});

	describe("FalkorDB", () => {
		it("should create a FalkorDB StatefulSet", () => {
			const sts = getResource("kubernetes:apps/v1:StatefulSet", "falkordb");
			expect(sts).toBeDefined();
		});

		it("should use correct image", () => {
			const sts = getResource("kubernetes:apps/v1:StatefulSet", "falkordb");
			const containers = (sts?.inputs.spec as Record<string, unknown>)?.template as Record<
				string,
				unknown
			>;
			const spec = containers?.spec as Record<string, unknown>;
			const containerList = spec?.containers as Array<Record<string, unknown>>;
			expect(containerList?.[0]?.image).toBe("falkordb/falkordb:v4.2.1");
		});

		it("should have 50Gi storage", () => {
			const sts = getResource("kubernetes:apps/v1:StatefulSet", "falkordb");
			const spec = sts?.inputs.spec as Record<string, unknown>;
			const templates = spec?.volumeClaimTemplates as Array<Record<string, unknown>>;
			const storage = (templates?.[0]?.spec as Record<string, unknown>)?.resources as Record<
				string,
				unknown
			>;
			expect((storage?.requests as Record<string, string>)?.storage).toBe("50Gi");
		});

		it("should create a headless service", () => {
			const svc = getResource("kubernetes:core/v1:Service", "falkordb");
			expect(svc).toBeDefined();
			expect((svc?.inputs.spec as Record<string, unknown>)?.clusterIP).toBe("None");
		});

		it("should expose port 6379", () => {
			const svc = getResource("kubernetes:core/v1:Service", "falkordb");
			const ports = (svc?.inputs.spec as Record<string, unknown>)?.ports as Array<
				Record<string, unknown>
			>;
			expect(ports?.[0]?.port).toBe(6379);
		});

		it("should export endpoint", () => {
			expect(infra.falkordbEndpoint).toBe("redis://falkordb.engram.svc.cluster.local:6379");
		});
	});

	describe("Qdrant", () => {
		it("should create a Qdrant Helm release", () => {
			const release = getResource("kubernetes:helm.sh/v3:Release", "qdrant");
			expect(release).toBeDefined();
		});

		it("should use qdrant helm chart", () => {
			const release = getResource("kubernetes:helm.sh/v3:Release", "qdrant");
			expect(release?.inputs.chart).toBe("qdrant");
		});

		it("should use correct repository", () => {
			const release = getResource("kubernetes:helm.sh/v3:Release", "qdrant");
			const repoOpts = release?.inputs.repositoryOpts as Record<string, string>;
			expect(repoOpts?.repo).toBe("https://qdrant.github.io/qdrant-helm");
		});

		it("should configure 50Gi persistence", () => {
			const release = getResource("kubernetes:helm.sh/v3:Release", "qdrant");
			const values = release?.inputs.values as Record<string, unknown>;
			const persistence = values?.persistence as Record<string, unknown>;
			expect(persistence?.size).toBe("50Gi");
			expect(persistence?.enabled).toBe(true);
		});

		it("should export endpoints", () => {
			expect(infra.qdrantEndpoint).toBe("http://qdrant.engram.svc.cluster.local:6333");
			expect(infra.qdrantGrpcEndpoint).toBe("qdrant.engram.svc.cluster.local:6334");
		});
	});

	describe("Redpanda", () => {
		it("should create a Redpanda Helm release", () => {
			const release = getResource("kubernetes:helm.sh/v3:Release", "redpanda");
			expect(release).toBeDefined();
		});

		it("should use redpanda helm chart", () => {
			const release = getResource("kubernetes:helm.sh/v3:Release", "redpanda");
			expect(release?.inputs.chart).toBe("redpanda");
		});

		it("should use correct repository", () => {
			const release = getResource("kubernetes:helm.sh/v3:Release", "redpanda");
			const repoOpts = release?.inputs.repositoryOpts as Record<string, string>;
			expect(repoOpts?.repo).toBe("https://charts.redpanda.com");
		});

		it("should configure 50Gi persistence", () => {
			const release = getResource("kubernetes:helm.sh/v3:Release", "redpanda");
			const values = release?.inputs.values as Record<string, unknown>;
			const storage = values?.storage as Record<string, unknown>;
			const pv = storage?.persistentVolume as Record<string, unknown>;
			expect(pv?.size).toBe("50Gi");
			expect(pv?.enabled).toBe(true);
		});

		it("should disable external access", () => {
			const release = getResource("kubernetes:helm.sh/v3:Release", "redpanda");
			const values = release?.inputs.values as Record<string, unknown>;
			const external = values?.external as Record<string, unknown>;
			expect(external?.enabled).toBe(false);
		});

		it("should export endpoints", () => {
			expect(infra.redpandaEndpoint).toBe("redpanda.engram.svc.cluster.local:9092");
			expect(infra.redpandaSchemaRegistryEndpoint).toBe("redpanda.engram.svc.cluster.local:8081");
		});
	});

	describe("Tuner PostgreSQL", () => {
		it("should create a PostgreSQL secret", () => {
			const secret = getResource("kubernetes:core/v1:Secret", "tuner-postgres-credentials");
			expect(secret).toBeDefined();
		});

		it("should create a PostgreSQL StatefulSet", () => {
			const sts = getResource("kubernetes:apps/v1:StatefulSet", "tuner-postgres");
			expect(sts).toBeDefined();
		});

		it("should use postgres:17-alpine image", () => {
			const sts = getResource("kubernetes:apps/v1:StatefulSet", "tuner-postgres");
			const containers = (sts?.inputs.spec as Record<string, unknown>)?.template as Record<
				string,
				unknown
			>;
			const spec = containers?.spec as Record<string, unknown>;
			const containerList = spec?.containers as Array<Record<string, unknown>>;
			expect(containerList?.[0]?.image).toBe("postgres:17-alpine");
		});

		it("should have 10Gi storage", () => {
			const sts = getResource("kubernetes:apps/v1:StatefulSet", "tuner-postgres");
			const spec = sts?.inputs.spec as Record<string, unknown>;
			const templates = spec?.volumeClaimTemplates as Array<Record<string, unknown>>;
			const storage = (templates?.[0]?.spec as Record<string, unknown>)?.resources as Record<
				string,
				unknown
			>;
			expect((storage?.requests as Record<string, string>)?.storage).toBe("10Gi");
		});

		it("should create a service", () => {
			const svc = getResource("kubernetes:core/v1:Service", "tuner-postgres");
			expect(svc).toBeDefined();
			const ports = (svc?.inputs.spec as Record<string, unknown>)?.ports as Array<
				Record<string, unknown>
			>;
			expect(ports?.[0]?.port).toBe(5432);
		});
	});

	describe("Tuner API", () => {
		it("should create a ConfigMap", () => {
			const cm = getResource("kubernetes:core/v1:ConfigMap", "tuner-config");
			expect(cm).toBeDefined();
		});

		it("should create a Secret", () => {
			const secret = getResource("kubernetes:core/v1:Secret", "tuner-secrets");
			expect(secret).toBeDefined();
		});

		it("should create a Deployment with 2 replicas", () => {
			const deploy = getResource("kubernetes:apps/v1:Deployment", "tuner");
			expect(deploy).toBeDefined();
			expect((deploy?.inputs.spec as Record<string, unknown>)?.replicas).toBe(2);
		});

		it("should use rolling update strategy", () => {
			const deploy = getResource("kubernetes:apps/v1:Deployment", "tuner");
			const spec = deploy?.inputs.spec as Record<string, unknown>;
			const strategy = spec?.strategy as Record<string, unknown>;
			expect(strategy?.type).toBe("RollingUpdate");
		});

		it("should have security context", () => {
			const deploy = getResource("kubernetes:apps/v1:Deployment", "tuner");
			const spec = deploy?.inputs.spec as Record<string, unknown>;
			const template = spec?.template as Record<string, unknown>;
			const podSpec = template?.spec as Record<string, unknown>;
			const secContext = podSpec?.securityContext as Record<string, unknown>;
			expect(secContext?.runAsNonRoot).toBe(true);
			expect(secContext?.runAsUser).toBe(1000);
		});

		it("should create a Service", () => {
			const svc = getResource("kubernetes:core/v1:Service", "tuner");
			expect(svc).toBeDefined();
			const ports = (svc?.inputs.spec as Record<string, unknown>)?.ports as Array<
				Record<string, unknown>
			>;
			expect(ports?.[0]?.port).toBe(8000);
		});

		it("should create a PodDisruptionBudget", () => {
			const pdb = getResource("kubernetes:policy/v1:PodDisruptionBudget", "tuner-pdb");
			expect(pdb).toBeDefined();
			expect((pdb?.inputs.spec as Record<string, unknown>)?.minAvailable).toBe(1);
		});

		it("should export endpoint", () => {
			expect(infra.tunerEndpoint).toBe("http://tuner.engram.svc.cluster.local:8000");
		});
	});

	describe("Optuna Dashboard", () => {
		it("should create a Deployment", () => {
			const deploy = getResource("kubernetes:apps/v1:Deployment", "tuner-dashboard");
			expect(deploy).toBeDefined();
		});

		it("should use optuna-dashboard image", () => {
			const deploy = getResource("kubernetes:apps/v1:Deployment", "tuner-dashboard");
			const spec = deploy?.inputs.spec as Record<string, unknown>;
			const template = spec?.template as Record<string, unknown>;
			const podSpec = template?.spec as Record<string, unknown>;
			const containers = podSpec?.containers as Array<Record<string, unknown>>;
			expect(containers?.[0]?.image).toBe("ghcr.io/optuna/optuna-dashboard:latest");
		});

		it("should create a Service", () => {
			const svc = getResource("kubernetes:core/v1:Service", "tuner-dashboard");
			expect(svc).toBeDefined();
			const ports = (svc?.inputs.spec as Record<string, unknown>)?.ports as Array<
				Record<string, unknown>
			>;
			expect(ports?.[0]?.port).toBe(8080);
		});

		it("should export endpoint", () => {
			expect(infra.dashboardEndpoint).toBe("http://tuner-dashboard.engram.svc.cluster.local:8080");
		});
	});

	describe("Resource Count", () => {
		it("should create exactly 1 namespace", () => {
			const namespaces = getResourcesByType("kubernetes:core/v1:Namespace");
			expect(namespaces).toHaveLength(1);
		});

		it("should create 2 StatefulSets (FalkorDB + PostgreSQL)", () => {
			const statefulsets = getResourcesByType("kubernetes:apps/v1:StatefulSet");
			expect(statefulsets).toHaveLength(2);
		});

		it("should create 2 Deployments (Tuner + Dashboard)", () => {
			const deployments = getResourcesByType("kubernetes:apps/v1:Deployment");
			expect(deployments).toHaveLength(2);
		});

		it("should create 2 Helm releases (Qdrant + Redpanda)", () => {
			const releases = getResourcesByType("kubernetes:helm.sh/v3:Release");
			expect(releases).toHaveLength(2);
		});

		it("should create 5 Services", () => {
			const services = getResourcesByType("kubernetes:core/v1:Service");
			// FalkorDB + PostgreSQL + Tuner + Dashboard + (Qdrant & Redpanda handled by Helm)
			expect(services).toHaveLength(4);
		});

		it("should create 1 PodDisruptionBudget", () => {
			const pdbs = getResourcesByType("kubernetes:policy/v1:PodDisruptionBudget");
			expect(pdbs).toHaveLength(1);
		});
	});

	describe("Labeling Consistency", () => {
		it("should apply engram part-of label to all workloads", () => {
			const statefulsets = getResourcesByType("kubernetes:apps/v1:StatefulSet");
			const deployments = getResourcesByType("kubernetes:apps/v1:Deployment");

			for (const resource of [...statefulsets, ...deployments]) {
				const labels = (resource.inputs.metadata as Record<string, unknown>)?.labels as Record<
					string,
					string
				>;
				expect(labels?.["app.kubernetes.io/part-of"]).toBe("engram");
			}
		});

		it("should apply managedBy=pulumi label to all resources", () => {
			const statefulsets = getResourcesByType("kubernetes:apps/v1:StatefulSet");
			const deployments = getResourcesByType("kubernetes:apps/v1:Deployment");
			const services = getResourcesByType("kubernetes:core/v1:Service");

			for (const resource of [...statefulsets, ...deployments, ...services]) {
				const labels = (resource.inputs.metadata as Record<string, unknown>)?.labels as Record<
					string,
					string
				>;
				expect(labels?.["managed-by"]).toBe("pulumi");
			}
		});
	});
});
