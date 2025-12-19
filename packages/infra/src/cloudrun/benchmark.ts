/**
 * Benchmark Cloud Run Job Infrastructure
 *
 * GPU-enabled Cloud Run Job for running LongMemEval benchmarks
 * with SOTA models (Gemini 2.5 Flash) in GCP.
 *
 * Architecture:
 * - Main container: Benchmark runner with GPU for embedding inference
 * - Sidecar container: Qdrant vector database for hybrid search
 * - Containers share localhost network (benchmark connects to localhost:6333)
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
 * @see https://cloud.google.com/run/docs/deploying#sidecars
 * @see https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/job/
 */

import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels, gcpProject, gcpRegion } from "../config";
import { googleGenerativeAiApiKeySecret } from "../secrets";

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
	/** CPU allocation (minimum 4 for GPU, max 8 total across all containers) */
	cpu: config.get("benchmarkCpu") ?? "6",
	/** Memory allocation (minimum 16Gi for GPU, max 24Gi for 6 CPUs) */
	memory: config.get("benchmarkMemory") ?? "24Gi",
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
// Cloud Run Job with GPU
// =============================================================================

// GCP labels must be lowercase, no dots/slashes
const jobLabels = {
	app: "engram-benchmark",
	component: "job",
	"part-of": "engram",
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
				// Main benchmark container
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
							// Google Generative AI API key from Secret Manager
							name: "GOOGLE_GENERATIVE_AI_API_KEY",
							valueSource: {
								secretKeyRef: {
									secret: googleGenerativeAiApiKeySecret.secretId,
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

				// Qdrant vector database sidecar
				// Containers share localhost network, so benchmark connects to localhost:6333
				{
					name: "qdrant",
					image: "qdrant/qdrant:v1.12.4",

					// Qdrant resource limits (runs alongside benchmark)
					resources: {
						limits: {
							cpu: "2",
							memory: "4Gi",
						},
					},

					// Qdrant environment variables
					envs: [
						{
							name: "QDRANT__SERVICE__GRPC_PORT",
							value: "6334",
						},
						{
							name: "QDRANT__SERVICE__HTTP_PORT",
							value: "6333",
						},
						{
							// Disable telemetry in cloud environment
							name: "QDRANT__TELEMETRY_DISABLED",
							value: "true",
						},
					],

					// Qdrant data volume
					volumeMounts: [
						{
							name: "qdrant-storage",
							mountPath: "/qdrant/storage",
						},
					],

					// Startup probe to ensure Qdrant is ready before benchmark starts
					startupProbe: {
						httpGet: {
							path: "/readyz",
							port: 6333,
						},
						initialDelaySeconds: 2,
						periodSeconds: 2,
						failureThreshold: 30,
					},
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
				{
					// Ephemeral storage for Qdrant (data is recreated each job run)
					name: "qdrant-storage",
					emptyDir: {
						medium: "MEMORY",
						sizeLimit: "2Gi",
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

// GCS bucket labels must be lowercase, no dots/slashes
// See: https://cloud.google.com/storage/docs/tags-and-labels#bucket-labels
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
		secretId: googleGenerativeAiApiKeySecret.secretId,
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
