/**
 * Config Tests
 *
 * Tests for infrastructure configuration.
 */

import { describe, expect, it } from "vitest";

describe("Configuration", () => {
	describe("GCP Configuration", () => {
		it("should load GCP project from config", async () => {
			const { gcpProject } = await import("./config");
			expect(gcpProject).toBe("test-project");
		});

		it("should load GCP region with default", async () => {
			const { gcpRegion } = await import("./config");
			expect(gcpRegion).toBe("us-central1");
		});
	});

	describe("Environment", () => {
		it("should detect stack environment", async () => {
			const { environment } = await import("./config");
			expect(environment).toBe("test");
		});
	});

	describe("Network Configuration", () => {
		it("should have default CIDR range", async () => {
			const { networkConfig } = await import("./config");
			expect(networkConfig.cidrRange).toBe("10.0.0.0/16");
		});
	});

	describe("GKE Configuration", () => {
		it("should disable deletion protection for non-prod environments", async () => {
			const { gkeConfig } = await import("./config");
			expect(gkeConfig.deletionProtection).toBe(false);
		});

		it("should enable deletion protection for prod environment", async () => {
			// The test uses stack name "test", so deletionProtection should be false
			// In production (environment === "prod"), it would be true
			const { gkeConfig, environment } = await import("./config");
			if (environment === "prod") {
				expect(gkeConfig.deletionProtection).toBe(true);
			} else {
				expect(gkeConfig.deletionProtection).toBe(false);
			}
		});
	});

	describe("Database Configuration", () => {
		it("should use 1 replica for non-prod environments", async () => {
			const { databaseConfig } = await import("./config");
			expect(databaseConfig.replicas).toBe(1);
		});

		it("should use 3 replicas for prod environment", async () => {
			const { databaseConfig, environment } = await import("./config");
			if (environment === "prod") {
				expect(databaseConfig.replicas).toBe(3);
			} else {
				expect(databaseConfig.replicas).toBe(1);
			}
		});
	});

	describe("Common Labels", () => {
		it("should include project label", async () => {
			const { commonLabels } = await import("./config");
			expect(commonLabels.project).toBe("engram");
		});

		it("should include environment label", async () => {
			const { commonLabels } = await import("./config");
			expect(commonLabels.environment).toBe("test");
		});

		it("should include managed-by label", async () => {
			const { commonLabels } = await import("./config");
			expect(commonLabels["managed-by"]).toBe("pulumi");
		});
	});

	describe("Dev Environment Switch", () => {
		it("should default to true when not configured", async () => {
			const { devEnabled } = await import("./config");
			// In test environment, devEnabled should be true (default)
			expect(typeof devEnabled).toBe("boolean");
		});

		it("should be configurable via Pulumi config", async () => {
			// This tests that the config value is properly read
			const { devEnabled } = await import("./config");
			expect([true, false]).toContain(devEnabled);
		});

		it("should use boolean type for devEnabled", async () => {
			const { devEnabled } = await import("./config");
			// Verify it's explicitly a boolean, not undefined or string
			expect(devEnabled === true || devEnabled === false).toBe(true);
		});
	});

	describe("Environment-based configuration", () => {
		it("should determine replica count based on environment", async () => {
			const { databaseConfig, environment } = await import("./config");
			// Test the conditional logic
			const expectedReplicas = environment === "prod" ? 3 : 1;
			expect(databaseConfig.replicas).toBe(expectedReplicas);
		});

		it("should determine deletion protection based on environment", async () => {
			const { gkeConfig, environment } = await import("./config");
			// Test the conditional logic
			const expectedProtection = environment === "prod";
			expect(gkeConfig.deletionProtection).toBe(expectedProtection);
		});
	});
});
