/**
 * Storage Infrastructure Tests
 *
 * Tests for GCS buckets used for benchmark data and results.
 */

import { describe, expect, it } from "vitest";
import * as storage from "./storage";
import { getOutputValue, getResource, getResourcesByType } from "./testing";

describe("Storage Infrastructure", () => {
	describe("GCS Buckets", () => {
		it("should create a benchmark data bucket", () => {
			const bucket = getResource("gcp:storage/bucket:Bucket", "benchmark-data");
			expect(bucket).toBeDefined();
		});

		it("should create a benchmark results bucket", () => {
			const bucket = getResource("gcp:storage/bucket:Bucket", "benchmark-results");
			expect(bucket).toBeDefined();
		});

		it("should enable uniform bucket-level access on both buckets", () => {
			const dataBucket = getResource("gcp:storage/bucket:Bucket", "benchmark-data");
			const resultsBucket = getResource("gcp:storage/bucket:Bucket", "benchmark-results");

			expect(dataBucket?.inputs.uniformBucketLevelAccess).toBe(true);
			expect(resultsBucket?.inputs.uniformBucketLevelAccess).toBe(true);
		});

		it("should enable versioning on results bucket", () => {
			const bucket = getResource("gcp:storage/bucket:Bucket", "benchmark-results");
			const versioning = bucket?.inputs.versioning as Record<string, boolean>;
			expect(versioning?.enabled).toBe(true);
		});

		it("should have lifecycle rule on data bucket", () => {
			const bucket = getResource("gcp:storage/bucket:Bucket", "benchmark-data");
			const rules = bucket?.inputs.lifecycleRules as Array<Record<string, unknown>>;
			expect(rules?.length).toBeGreaterThan(0);

			const deleteRule = rules?.find(
				(r) => (r.action as Record<string, string>)?.type === "Delete",
			);
			expect(deleteRule).toBeDefined();
		});

		it("should be in us-central1 region", () => {
			const dataBucket = getResource("gcp:storage/bucket:Bucket", "benchmark-data");
			const resultsBucket = getResource("gcp:storage/bucket:Bucket", "benchmark-results");

			expect(dataBucket?.inputs.location).toBe("us-central1");
			expect(resultsBucket?.inputs.location).toBe("us-central1");
		});
	});

	describe("Exports", () => {
		it("should export benchmark data bucket", () => {
			expect(storage.benchmarkDataBucket).toBeDefined();
		});

		it("should export benchmark results bucket", () => {
			expect(storage.benchmarkResultsBucket).toBeDefined();
		});

		it("should export bucket names", () => {
			expect(storage.benchmarkDataBucketName).toBeDefined();
			expect(storage.benchmarkResultsBucketName).toBeDefined();
		});
	});

	describe("Resource Count", () => {
		it("should create exactly 2 GCS Buckets", () => {
			const buckets = getResourcesByType("gcp:storage/bucket:Bucket");
			expect(buckets).toHaveLength(2);
		});
	});
});
