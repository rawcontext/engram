import { describe, expect, it } from "vitest";
import { ABTestingService } from "./ab-testing";

describe("ABTestingService", () => {
	describe("Variant Assignment", () => {
		it("should assign consistent variants for same session", () => {
			const service = new ABTestingService({ rerankEnabledPct: 50 });

			const sessionId = "test-session-123";

			// Get assignment multiple times
			const assignment1 = service.assign(sessionId);
			const assignment2 = service.assign(sessionId);
			const assignment3 = service.assign(sessionId);

			// Should always return same variant
			expect(assignment1.variant).toBe(assignment2.variant);
			expect(assignment2.variant).toBe(assignment3.variant);
			expect(assignment1.bucket).toBe(assignment2.bucket);
		});

		it("should assign different variants to different sessions", () => {
			const service = new ABTestingService({ rerankEnabledPct: 50 });

			// Generate many session IDs and check distribution
			const sessionIds = Array.from({ length: 100 }, (_, i) => `session-${i}`);
			const assignments = sessionIds.map((id) => service.assign(id));

			// Should have mix of control and treatment
			const treatmentCount = assignments.filter((a) => a.variant === "treatment").length;
			const controlCount = assignments.filter((a) => a.variant === "control").length;

			// With 50% rollout, expect roughly 50/50 split (allow some variance)
			expect(treatmentCount).toBeGreaterThan(30);
			expect(treatmentCount).toBeLessThan(70);
			expect(controlCount).toBeGreaterThan(30);
			expect(controlCount).toBeLessThan(70);
			expect(treatmentCount + controlCount).toBe(100);
		});

		it("should respect rollout percentage", () => {
			const service = new ABTestingService({ rerankEnabledPct: 20 }); // 20% rollout

			// Generate many sessions
			const sessionIds = Array.from({ length: 1000 }, (_, i) => `session-${i}`);
			const assignments = sessionIds.map((id) => service.assign(id));

			const treatmentCount = assignments.filter((a) => a.rerankEnabled).length;
			const treatmentPct = (treatmentCount / 1000) * 100;

			// Should be close to 20% (allow 5% variance)
			expect(treatmentPct).toBeGreaterThan(15);
			expect(treatmentPct).toBeLessThan(25);
		});

		it("should assign treatment variant when rerankEnabled is true", () => {
			const service = new ABTestingService({ rerankEnabledPct: 100 }); // 100% rollout

			const assignment = service.assign("any-session");

			expect(assignment.variant).toBe("treatment");
			expect(assignment.rerankEnabled).toBe(true);
		});

		it("should assign control variant when rerankEnabled is false", () => {
			const service = new ABTestingService({ rerankEnabledPct: 0 }); // 0% rollout

			const assignment = service.assign("any-session");

			expect(assignment.variant).toBe("control");
			expect(assignment.rerankEnabled).toBe(false);
		});

		it("should map sessions to buckets 0-99", () => {
			const service = new ABTestingService({ rerankEnabledPct: 50 });

			const sessionIds = Array.from({ length: 100 }, (_, i) => `session-${i}`);
			const assignments = sessionIds.map((id) => service.assign(id));

			// Check all buckets are in valid range
			for (const assignment of assignments) {
				expect(assignment.bucket).toBeGreaterThanOrEqual(0);
				expect(assignment.bucket).toBeLessThan(100);
			}

			// Check we have good distribution across buckets
			const buckets = new Set(assignments.map((a) => a.bucket));
			expect(buckets.size).toBeGreaterThan(50); // Should use many different buckets
		});
	});

	describe("Tier Override", () => {
		it("should apply tier override when configured", () => {
			const service = new ABTestingService({
				rerankEnabledPct: 50,
				rerankTierOverride: "accurate",
			});

			const assignment = service.assign("test-session");

			if (assignment.rerankEnabled) {
				expect(assignment.rerankTier).toBe("accurate");
			}
		});

		it("should not set tier when no override", () => {
			const service = new ABTestingService({
				rerankEnabledPct: 100,
			});

			const assignment = service.assign("test-session");

			expect(assignment.rerankTier).toBeUndefined();
		});

		it("should update tier override dynamically", () => {
			const service = new ABTestingService({
				rerankEnabledPct: 100,
			});

			// Initially no override
			let assignment = service.assign("test-session");
			expect(assignment.rerankTier).toBeUndefined();

			// Set override
			service.setTierOverride("code");
			assignment = service.assign("test-session");
			expect(assignment.rerankTier).toBe("code");

			// Clear override
			service.setTierOverride(undefined);
			assignment = service.assign("test-session");
			expect(assignment.rerankTier).toBeUndefined();
		});
	});

	describe("Rollout Percentage Updates", () => {
		it("should update rollout percentage dynamically", () => {
			const service = new ABTestingService({ rerankEnabledPct: 0 });

			// Initially 0% - should be control
			let assignment = service.assign("test-session");
			expect(assignment.rerankEnabled).toBe(false);

			// Update to 100%
			service.setRolloutPercentage(100);

			// Now should be treatment
			assignment = service.assign("test-session");
			expect(assignment.rerankEnabled).toBe(true);
		});

		it("should clamp rollout percentage to 0-100", () => {
			const service = new ABTestingService({ rerankEnabledPct: 50 });

			// Try to set negative
			service.setRolloutPercentage(-10);
			const config1 = service.getConfig();
			expect(config1.rerankEnabledPct).toBe(0);

			// Try to set above 100
			service.setRolloutPercentage(150);
			const config2 = service.getConfig();
			expect(config2.rerankEnabledPct).toBe(100);
		});
	});

	describe("Helper Methods", () => {
		it("should check if session is in treatment", () => {
			const service = new ABTestingService({ rerankEnabledPct: 100 });

			expect(service.isInTreatment("test-session")).toBe(true);
			expect(service.isInControl("test-session")).toBe(false);
		});

		it("should check if session is in control", () => {
			const service = new ABTestingService({ rerankEnabledPct: 0 });

			expect(service.isInTreatment("test-session")).toBe(false);
			expect(service.isInControl("test-session")).toBe(true);
		});
	});

	describe("Bucket Distribution Analysis", () => {
		it("should analyze bucket distribution correctly", () => {
			const service = new ABTestingService({ rerankEnabledPct: 30 });

			const sessionIds = Array.from({ length: 100 }, (_, i) => `session-${i}`);
			const analysis = service.analyzeBucketDistribution(sessionIds);

			expect(analysis.treatment + analysis.control).toBe(100);
			expect(Object.keys(analysis.bucketCounts).length).toBeGreaterThan(0);

			// With 30% rollout, expect roughly 30 in treatment
			expect(analysis.treatment).toBeGreaterThan(20);
			expect(analysis.treatment).toBeLessThan(40);
		});

		it("should count buckets correctly", () => {
			const service = new ABTestingService({ rerankEnabledPct: 50 });

			// Use same session multiple times
			const sessionIds = ["session-1", "session-1", "session-1"];
			const analysis = service.analyzeBucketDistribution(sessionIds);

			// Same session should map to same bucket
			const buckets = Object.keys(analysis.bucketCounts);
			expect(buckets.length).toBe(1); // Only one unique bucket
			expect(analysis.bucketCounts[Number(buckets[0])]).toBe(3); // Count of 3
		});
	});

	describe("Custom Seed", () => {
		it("should produce different distributions with different seeds", () => {
			const service1 = new ABTestingService({
				rerankEnabledPct: 50,
				seed: "seed-a",
			});

			const service2 = new ABTestingService({
				rerankEnabledPct: 50,
				seed: "seed-b",
			});

			const sessionId = "test-session";

			const assignment1 = service1.assign(sessionId);
			const assignment2 = service2.assign(sessionId);

			// Different seeds should produce different buckets
			// (not guaranteed but highly likely with good hash)
			// We test with multiple sessions to be sure
			const sessionIds = Array.from({ length: 10 }, (_, i) => `session-${i}`);

			let differentCount = 0;
			for (const id of sessionIds) {
				const a1 = service1.assign(id);
				const a2 = service2.assign(id);
				if (a1.bucket !== a2.bucket) {
					differentCount++;
				}
			}

			// At least some should be different
			expect(differentCount).toBeGreaterThan(0);
		});

		it("should produce same distribution with same seed", () => {
			const service1 = new ABTestingService({
				rerankEnabledPct: 50,
				seed: "same-seed",
			});

			const service2 = new ABTestingService({
				rerankEnabledPct: 50,
				seed: "same-seed",
			});

			const sessionIds = Array.from({ length: 10 }, (_, i) => `session-${i}`);

			for (const id of sessionIds) {
				const a1 = service1.assign(id);
				const a2 = service2.assign(id);

				// Same seed should produce identical assignments
				expect(a1.bucket).toBe(a2.bucket);
				expect(a1.variant).toBe(a2.variant);
			}
		});
	});

	describe("Default Configuration", () => {
		it("should use 100% rollout by default", () => {
			const service = new ABTestingService();
			const config = service.getConfig();

			expect(config.rerankEnabledPct).toBe(100);
		});

		it("should have default seed", () => {
			const service = new ABTestingService();
			const config = service.getConfig();

			expect(config.seed).toBe("engram-rerank-rollout-v1");
		});
	});

	describe("Request Recording", () => {
		it("should record search requests", () => {
			const service = new ABTestingService({ rerankEnabledPct: 50 });

			// Should not throw
			expect(() => service.recordRequest("session-1", "fast")).not.toThrow();
			expect(() => service.recordRequest("session-2", undefined)).not.toThrow();
		});
	});
});
