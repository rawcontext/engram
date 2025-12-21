/**
 * Conditional Resource Creation Tests
 *
 * Tests for verifying that resources are conditionally created based on
 * k8sProvider existence and devEnabled configuration.
 */

import { describe, expect, it } from "vitest";
import * as infra from "./k8s";

describe("Conditional Resource Creation", () => {
	describe("Resources created when k8sProvider exists", () => {
		it("should have namespace when k8sProvider exists", () => {
			expect(infra.namespace).toBeDefined();
		});

		it("should have namespaceName output", () => {
			expect(infra.namespaceName).toBeDefined();
		});
	});

	describe("Endpoints always exported", () => {
		it("should export FalkorDB endpoint", () => {
			expect(infra.falkordbEndpoint).toBe("redis://falkordb.engram.svc.cluster.local:6379");
		});

		it("should export Qdrant endpoints", () => {
			expect(infra.qdrantEndpoint).toBe("http://qdrant.engram.svc.cluster.local:6333");
			expect(infra.qdrantGrpcEndpoint).toBe("qdrant.engram.svc.cluster.local:6334");
		});

		it("should export Redpanda endpoints", () => {
			expect(infra.redpandaEndpoint).toBe("redpanda.engram.svc.cluster.local:9092");
			expect(infra.redpandaSchemaRegistryEndpoint).toBe("redpanda.engram.svc.cluster.local:8081");
		});

		it("should export Tuner endpoints", () => {
			expect(infra.tunerEndpoint).toBe("http://tuner.engram.svc.cluster.local:8000");
			expect(infra.dashboardEndpoint).toBe("http://tuner-dashboard.engram.svc.cluster.local:8080");
		});
	});

	describe("Service Accounts exported", () => {
		it("should export memory service account", () => {
			expect(infra.memoryServiceAccount).toBeDefined();
		});

		it("should export ingestion service account", () => {
			expect(infra.ingestionServiceAccount).toBeDefined();
		});

		it("should export search service account", () => {
			expect(infra.searchServiceAccount).toBeDefined();
		});

		it("should export mcp service account", () => {
			expect(infra.mcpServiceAccount).toBeDefined();
		});
	});

	describe("Backup resources exported", () => {
		it("should export backup bucket", () => {
			expect(infra.backupBucket).toBeDefined();
		});

		it("should export backup schedules", () => {
			expect(infra.backupSchedules).toEqual({
				falkordb: "Daily at 2 AM UTC",
				qdrant: "Daily at 3 AM UTC",
				redpanda: "Daily at 4 AM UTC",
			});
		});
	});
});
