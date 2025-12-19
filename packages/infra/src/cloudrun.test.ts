/**
 * Cloud Run Infrastructure Tests
 *
 * Tests for GPU-enabled Cloud Run resources:
 * - Benchmark Job with NVIDIA L4 GPU
 * - GCS Buckets for data and results
 * - Service Account with IAM bindings
 * - Secret Manager integration
 */

import { describe, expect, it } from "vitest";
import * as cloudrun from "./cloudrun";
import { getOutputValue, getResource, getResourcesByType } from "./testing";

describe("Cloud Run Infrastructure", () => {
	describe("Benchmark Job", () => {
		it("should create a Cloud Run Job", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			expect(job).toBeDefined();
		});

		it("should be named engram-benchmark", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			expect(job?.inputs.name).toBe("engram-benchmark");
		});

		it("should use BETA launch stage for GPU support", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			expect(job?.inputs.launchStage).toBe("BETA");
		});

		it("should be in us-central1 region", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			expect(job?.inputs.location).toBe("us-central1");
		});

		it("should have deletion protection disabled", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			expect(job?.inputs.deletionProtection).toBe(false);
		});

		it("should configure nvidia-l4 GPU accelerator", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			const template = job?.inputs.template as Record<string, unknown>;
			const innerTemplate = template?.template as Record<string, unknown>;
			const nodeSelector = innerTemplate?.nodeSelector as Record<string, string>;
			expect(nodeSelector?.accelerator).toBe("nvidia-l4");
		});

		it("should disable GPU zonal redundancy", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			const template = job?.inputs.template as Record<string, unknown>;
			const innerTemplate = template?.template as Record<string, unknown>;
			expect(innerTemplate?.gpuZonalRedundancyDisabled).toBe(true);
		});

		it("should have correct resource limits for GPU", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			const template = job?.inputs.template as Record<string, unknown>;
			const innerTemplate = template?.template as Record<string, unknown>;
			const containers = innerTemplate?.containers as Array<Record<string, unknown>>;
			const resources = containers?.[0]?.resources as Record<string, unknown>;
			const limits = resources?.limits as Record<string, string>;

			// GPU requires minimum 4 CPU and 16Gi memory
			expect(limits?.cpu).toBe("8");
			expect(limits?.memory).toBe("32Gi");
			expect(limits?.["nvidia.com/gpu"]).toBe("1");
		});

		it("should have correct labels", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			const labels = job?.inputs.labels as Record<string, string>;
			expect(labels?.["app.kubernetes.io/name"]).toBe("engram-benchmark");
			expect(labels?.["app.kubernetes.io/component"]).toBe("job");
			expect(labels?.["app.kubernetes.io/part-of"]).toBe("engram");
			expect(labels?.managedBy).toBe("pulumi");
		});

		it("should mount GCS volumes for data and results", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			const template = job?.inputs.template as Record<string, unknown>;
			const innerTemplate = template?.template as Record<string, unknown>;
			const volumes = innerTemplate?.volumes as Array<Record<string, unknown>>;

			const volumeNames = volumes?.map((v) => v.name);
			expect(volumeNames).toContain("benchmark-data");
			expect(volumeNames).toContain("benchmark-results");
		});

		it("should have environment variables including GOOGLE_GENERATIVE_AI_API_KEY from secret", () => {
			const job = getResource("gcp:cloudrunv2/job:Job", "engram-benchmark");
			const template = job?.inputs.template as Record<string, unknown>;
			const innerTemplate = template?.template as Record<string, unknown>;
			const containers = innerTemplate?.containers as Array<Record<string, unknown>>;
			const envs = containers?.[0]?.envs as Array<Record<string, unknown>>;

			const envNames = envs?.map((e) => e.name);
			expect(envNames).toContain("NODE_ENV");
			expect(envNames).toContain("BENCHMARK_VERBOSE");
			expect(envNames).toContain("GOOGLE_GENERATIVE_AI_API_KEY");

			// GOOGLE_GENERATIVE_AI_API_KEY should come from Secret Manager
			const googleAiEnv = envs?.find((e) => e.name === "GOOGLE_GENERATIVE_AI_API_KEY");
			expect(googleAiEnv?.valueSource).toBeDefined();
		});
	});

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
	});

	describe("Service Account", () => {
		it("should create a benchmark runner service account", () => {
			const sa = getResource("gcp:serviceaccount/account:Account", "benchmark-runner");
			expect(sa).toBeDefined();
		});

		it("should have correct account ID", () => {
			const sa = getResource("gcp:serviceaccount/account:Account", "benchmark-runner");
			expect(sa?.inputs.accountId).toBe("benchmark-runner");
		});

		it("should have display name", () => {
			const sa = getResource("gcp:serviceaccount/account:Account", "benchmark-runner");
			expect(sa?.inputs.displayName).toBe("Engram Benchmark Runner");
		});
	});

	describe("IAM Bindings", () => {
		it("should grant storage objectViewer on data bucket", () => {
			const binding = getResource(
				"gcp:storage/bucketIAMMember:BucketIAMMember",
				"benchmark-data-access",
			);
			expect(binding).toBeDefined();
			expect(binding?.inputs.role).toBe("roles/storage.objectViewer");
		});

		it("should grant storage objectAdmin on results bucket", () => {
			const binding = getResource(
				"gcp:storage/bucketIAMMember:BucketIAMMember",
				"benchmark-results-access",
			);
			expect(binding).toBeDefined();
			expect(binding?.inputs.role).toBe("roles/storage.objectAdmin");
		});

		it("should grant secretAccessor on Gemini API key secret", () => {
			const binding = getResource(
				"gcp:secretmanager/secretIamMember:SecretIamMember",
				"benchmark-secret-access",
			);
			expect(binding).toBeDefined();
			expect(binding?.inputs.role).toBe("roles/secretmanager.secretAccessor");
		});
	});

	describe("Secrets", () => {
		it("should create a Google Generative AI API key secret", () => {
			const secret = getResource("gcp:secretmanager/secret:Secret", "google-generative-ai-api-key");
			expect(secret).toBeDefined();
		});

		it("should have correct secret ID", () => {
			const secret = getResource("gcp:secretmanager/secret:Secret", "google-generative-ai-api-key");
			expect(secret?.inputs.secretId).toBe("google-generative-ai-api-key");
		});

		it("should use auto replication", () => {
			const secret = getResource("gcp:secretmanager/secret:Secret", "google-generative-ai-api-key");
			const replication = secret?.inputs.replication as Record<string, unknown>;
			expect(replication?.auto).toBeDefined();
		});
	});

	describe("Exports", () => {
		it("should export benchmark job name", async () => {
			const name = await getOutputValue(cloudrun.benchmarkJobName);
			expect(name).toBe("engram-benchmark");
		});

		it("should export benchmark job location", async () => {
			const location = await getOutputValue(cloudrun.benchmarkJobLocation);
			expect(location).toBe("us-central1");
		});

		it("should export execute command", async () => {
			const cmd = await getOutputValue(cloudrun.executeCommand);
			expect(cmd).toContain("gcloud run jobs execute");
			expect(cmd).toContain("engram-benchmark");
		});

		it("should export logs command", async () => {
			const cmd = await getOutputValue(cloudrun.logsCommand);
			expect(cmd).toContain("gcloud run jobs executions logs");
		});
	});

	describe("Resource Count", () => {
		it("should create exactly 1 Cloud Run Job", () => {
			const jobs = getResourcesByType("gcp:cloudrunv2/job:Job");
			expect(jobs).toHaveLength(1);
		});

		it("should create exactly 2 GCS Buckets", () => {
			const buckets = getResourcesByType("gcp:storage/bucket:Bucket");
			expect(buckets).toHaveLength(2);
		});

		it("should create exactly 1 Service Account", () => {
			const accounts = getResourcesByType("gcp:serviceaccount/account:Account");
			expect(accounts).toHaveLength(1);
		});

		it("should create exactly 2 Bucket IAM Members", () => {
			const bindings = getResourcesByType("gcp:storage/bucketIAMMember:BucketIAMMember");
			expect(bindings).toHaveLength(2);
		});

		it("should create exactly 1 Secret IAM Member", () => {
			const bindings = getResourcesByType("gcp:secretmanager/secretIamMember:SecretIamMember");
			expect(bindings).toHaveLength(1);
		});
	});
});
