/**
 * Shared Storage Infrastructure
 *
 * GCS buckets for benchmark data and results, shared between
 * Cloud Run jobs and GCE VMs.
 */

import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { gcpProject, gcpRegion } from "./config";

// GCS bucket labels must be lowercase, no dots/slashes
const gcsLabels = {
	project: "engram",
	component: "benchmark",
	"managed-by": "pulumi",
};

/**
 * Bucket for benchmark input data (datasets)
 */
export const benchmarkDataBucket = new gcp.storage.Bucket("benchmark-data", {
	name: pulumi.interpolate`${gcpProject}-benchmark-data`,
	location: gcpRegion,
	uniformBucketLevelAccess: true,
	labels: gcsLabels,
	lifecycleRules: [
		{
			action: { type: "Delete" },
			condition: { age: 90 }, // Clean up old data after 90 days
		},
	],
});

/**
 * Bucket for benchmark results
 */
export const benchmarkResultsBucket = new gcp.storage.Bucket("benchmark-results", {
	name: pulumi.interpolate`${gcpProject}-benchmark-results`,
	location: gcpRegion,
	uniformBucketLevelAccess: true,
	labels: gcsLabels,
	versioning: {
		enabled: true, // Keep history of results
	},
});

// Export bucket names for reference
export const benchmarkDataBucketName = benchmarkDataBucket.name;
export const benchmarkResultsBucketName = benchmarkResultsBucket.name;
