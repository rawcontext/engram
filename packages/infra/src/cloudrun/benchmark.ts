/**
 * Benchmark Cloud Run Job Infrastructure
 *
 * GPU-enabled Cloud Run Job for running LongMemEval benchmarks
 * with SOTA models (Gemini 2.5 Flash) in GCP.
 *
 * GPU Specs:
 * - NVIDIA L4 (24GB VRAM)
 * - Driver: 535.216.03 (CUDA 12.2)
 * - Cold start: ~5 seconds
 *
 * Usage:
 *   gcloud run jobs execute engram-benchmark --region us-central1
 *
 * @see https://cloud.google.com/run/docs/configuring/jobs/gpu
 * @see https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/job/
 */

import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels, gcpProject, gcpRegion } from "../config";

// =============================================================================
// Configuration
// =============================================================================

const config = new pulumi.Config();

/**
 * Benchmark job configuration
 */
export const benchmarkConfig = {
	/** Container image for benchmark runner */
	image: config.get("benchmarkImage") ?? `gcr.io/${gcpProject}/engram-benchmark:latest`,
	/** CPU allocation (minimum 4 for GPU) */
	cpu: config.get("benchmarkCpu") ?? "8",
	/** Memory allocation (minimum 16Gi for GPU) */
	memory: config.get("benchmarkMemory") ?? "32Gi",
	/** Task timeout in seconds (max 24 hours for jobs) */
	timeout: config.get("benchmarkTimeout") ?? "3600s",
	/** Maximum retries on failure */
	maxRetries: config.getNumber("benchmarkMaxRetries") ?? 1,
	/** Parallelism (tasks running concurrently) */
	parallelism: config.getNumber("benchmarkParallelism") ?? 1,
	/** Task count (total tasks per execution) */
	taskCount: config.getNumber("benchmarkTaskCount") ?? 1,
};

// =============================================================================
// Secrets for API Keys
// =============================================================================

/**
 * Reference to existing Gemini API key secret
 * Should be created in Secret Manager before deployment
 */
export const geminiApiKeySecret = new gcp.secretmanager.Secret("gemini-api-key", {
	secretId: "gemini-api-key",
	labels: commonLabels,
	replication: {
		auto: {},
	},
});

// =============================================================================
// Cloud Run Job with GPU
// =============================================================================

const jobLabels = {
	"app.kubernetes.io/name": "engram-benchmark",
	"app.kubernetes.io/component": "job",
	"app.kubernetes.io/part-of": "engram",
};

/**
 * Engram Benchmark Cloud Run Job
 *
 * GPU-enabled job for running LongMemEval benchmarks with Gemini 2.5 Flash.
 * Configured with NVIDIA L4 GPU (24GB VRAM) for embedding model inference.
 *
 * Execution:
 *   gcloud run jobs execute engram-benchmark \
 *     --region us-central1 \
 *     --update-env-vars BENCHMARK_DATASET=/data/longmemeval-s.jsonl
 */
export const benchmarkJob = new gcp.cloudrunv2.Job("engram-benchmark", {
	name: "engram-benchmark",
	location: gcpRegion,
	deletionProtection: false,

	// GPU requires BETA launch stage
	launchStage: "BETA",

	labels: { ...commonLabels, ...jobLabels },

	template: {
		labels: jobLabels,
		parallelism: benchmarkConfig.parallelism,
		taskCount: benchmarkConfig.taskCount,

		template: {
			// GPU configuration
			nodeSelector: {
				accelerator: "nvidia-l4",
			},
			gpuZonalRedundancyDisabled: true,

			timeout: benchmarkConfig.timeout,
			maxRetries: benchmarkConfig.maxRetries,

			containers: [
				{
					name: "benchmark",
					image: benchmarkConfig.image,

					// Resource limits with GPU
					resources: {
						limits: {
							cpu: benchmarkConfig.cpu,
							memory: benchmarkConfig.memory,
							"nvidia.com/gpu": "1",
						},
					},

					// Environment variables
					envs: [
						{
							name: "NODE_ENV",
							value: "production",
						},
						{
							name: "BENCHMARK_VERBOSE",
							value: "true",
						},
						{
							// Gemini API key from Secret Manager
							name: "GEMINI_API_KEY",
							valueSource: {
								secretKeyRef: {
									secret: geminiApiKeySecret.secretId,
									version: "latest",
								},
							},
						},
					],

					// Volume mounts for data
					volumeMounts: [
						{
							name: "benchmark-data",
							mountPath: "/data",
						},
						{
							name: "benchmark-results",
							mountPath: "/results",
						},
					],
				},
			],

			// Volumes
			volumes: [
				{
					name: "benchmark-data",
					gcs: {
						bucket: pulumi.interpolate`${gcpProject}-benchmark-data`,
						readOnly: true,
					},
				},
				{
					name: "benchmark-results",
					gcs: {
						bucket: pulumi.interpolate`${gcpProject}-benchmark-results`,
						readOnly: false,
					},
				},
			],

			// Service account for GCS access
			serviceAccount: pulumi.interpolate`benchmark-runner@${gcpProject}.iam.gserviceaccount.com`,
		},
	},
});

// =============================================================================
// GCS Buckets for Data and Results
// =============================================================================

/**
 * Bucket for benchmark input data (datasets)
 */
export const benchmarkDataBucket = new gcp.storage.Bucket("benchmark-data", {
	name: pulumi.interpolate`${gcpProject}-benchmark-data`,
	location: gcpRegion,
	uniformBucketLevelAccess: true,
	labels: { ...commonLabels, ...jobLabels },
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
	labels: { ...commonLabels, ...jobLabels },
	versioning: {
		enabled: true, // Keep history of results
	},
});

// =============================================================================
// Service Account for Benchmark Runner
// =============================================================================

/**
 * Service account for benchmark job execution
 */
export const benchmarkServiceAccount = new gcp.serviceaccount.Account("benchmark-runner", {
	accountId: "benchmark-runner",
	displayName: "Engram Benchmark Runner",
	description: "Service account for running GPU-enabled benchmark jobs",
});

/**
 * Grant GCS read access to data bucket
 */
export const benchmarkDataAccess = new gcp.storage.BucketIAMMember("benchmark-data-access", {
	bucket: benchmarkDataBucket.name,
	role: "roles/storage.objectViewer",
	member: pulumi.interpolate`serviceAccount:${benchmarkServiceAccount.email}`,
});

/**
 * Grant GCS write access to results bucket
 */
export const benchmarkResultsAccess = new gcp.storage.BucketIAMMember("benchmark-results-access", {
	bucket: benchmarkResultsBucket.name,
	role: "roles/storage.objectAdmin",
	member: pulumi.interpolate`serviceAccount:${benchmarkServiceAccount.email}`,
});

/**
 * Grant Secret Manager access for API keys
 */
export const benchmarkSecretAccess = new gcp.secretmanager.SecretIamMember(
	"benchmark-secret-access",
	{
		secretId: geminiApiKeySecret.secretId,
		role: "roles/secretmanager.secretAccessor",
		member: pulumi.interpolate`serviceAccount:${benchmarkServiceAccount.email}`,
	},
);

// =============================================================================
// Exports
// =============================================================================

export const benchmarkJobName = benchmarkJob.name;
export const benchmarkJobLocation = benchmarkJob.location;
export const benchmarkDataBucketName = benchmarkDataBucket.name;
export const benchmarkResultsBucketName = benchmarkResultsBucket.name;

/**
 * Command to execute the benchmark job
 */
export const executeCommand = pulumi.interpolate`gcloud run jobs execute ${benchmarkJob.name} --region ${gcpRegion}`;

/**
 * Command to view benchmark job logs
 */
export const logsCommand = pulumi.interpolate`gcloud run jobs executions logs ${benchmarkJob.name} --region ${gcpRegion}`;
