/**
 * Benchmark GCE VM Infrastructure
 *
 * GPU-enabled Compute Engine VM for running LongMemEval benchmarks
 * with full Engram pipeline features (hybrid search, reranking, session-aware, etc.)
 *
 * Why GCE VM instead of Cloud Run:
 * - Full control over GPU memory allocation (no container memory sharing)
 * - Proper ONNX Runtime CUDA configuration without BFC arena issues
 * - Qdrant runs as a local service (not sidecar) with dedicated memory
 * - SSH access for debugging and monitoring
 *
 * GPU Specs:
 * - NVIDIA L4 (24GB VRAM) - G2 machine series
 * - Deep Learning VM with CUDA 12.1 pre-installed
 * - 32GB RAM, 100GB SSD
 *
 * Usage:
 *   # SSH into the VM
 *   gcloud compute ssh benchmark-vm --zone=us-central1-a
 *
 *   # Run the benchmark
 *   cd /opt/engram && npm run benchmark
 *
 * @see https://cloud.google.com/compute/docs/gpus
 * @see https://www.pulumi.com/registry/packages/gcp/api-docs/compute/instance/
 */

import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels, gcpProject, gcpRegion } from "../config";
import { googleGenerativeAiApiKeySecret } from "../secrets";
import { benchmarkDataBucket, benchmarkResultsBucket } from "../storage";

const config = new pulumi.Config();

/**
 * Benchmark VM configuration with sensible defaults.
 */
export const benchmarkVmConfig = {
	/** Machine type - G2 series supports L4 GPUs */
	machineType: config.get("benchmarkVmMachineType") ?? "g2-standard-8",
	/** Zone for the VM (must have L4 GPUs available) */
	zone: config.get("benchmarkVmZone") ?? "us-central1-a",
	/** Boot disk size in GB */
	diskSizeGb: config.getNumber("benchmarkVmDiskSize") ?? 100,
	/** GPU type */
	gpuType: config.get("benchmarkVmGpuType") ?? "nvidia-l4",
	/** Number of GPUs */
	gpuCount: config.getNumber("benchmarkVmGpuCount") ?? 1,
	/** Whether to create the VM (for cost savings) */
	enabled: config.getBoolean("benchmarkVmEnabled") ?? false,
};

/**
 * Startup script that configures the VM for benchmark execution.
 *
 * This script:
 * 1. Installs Node.js 24.x
 * 2. Installs Qdrant as a local service
 * 3. Clones and sets up the Engram repository
 * 4. Downloads the benchmark dataset
 */
const startupScript = pulumi.interpolate`#!/bin/bash
set -euo pipefail

# Log startup
echo "=== Benchmark VM Startup Script ===" | tee /var/log/benchmark-startup.log
date | tee -a /var/log/benchmark-startup.log

# Wait for apt to be available
while fuser /var/lib/dpkg/lock >/dev/null 2>&1; do
  echo "Waiting for apt lock..." | tee -a /var/log/benchmark-startup.log
  sleep 5
done

# Update and install dependencies
apt-get update -y
apt-get install -y curl git build-essential

# Install Node.js 24.x
echo "Installing Node.js 24.x..." | tee -a /var/log/benchmark-startup.log
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
node --version | tee -a /var/log/benchmark-startup.log
npm --version | tee -a /var/log/benchmark-startup.log

# Install and start Qdrant
echo "Installing Qdrant..." | tee -a /var/log/benchmark-startup.log
curl -sSL https://github.com/qdrant/qdrant/releases/download/v1.12.4/qdrant-x86_64-unknown-linux-gnu.tar.gz | tar xz -C /usr/local/bin

# Create Qdrant service
cat > /etc/systemd/system/qdrant.service << 'EOF'
[Unit]
Description=Qdrant Vector Database
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/qdrant --config-path /opt/qdrant/config.yaml
WorkingDirectory=/opt/qdrant
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Create Qdrant config
mkdir -p /opt/qdrant/storage
cat > /opt/qdrant/config.yaml << 'EOF'
storage:
  storage_path: /opt/qdrant/storage
service:
  http_port: 6333
  grpc_port: 6334
telemetry_disabled: true
EOF

# Start Qdrant
systemctl daemon-reload
systemctl enable qdrant
systemctl start qdrant

# Wait for Qdrant to be ready
echo "Waiting for Qdrant..." | tee -a /var/log/benchmark-startup.log
for i in {1..30}; do
  if curl -s http://localhost:6333/readyz > /dev/null; then
    echo "Qdrant is ready!" | tee -a /var/log/benchmark-startup.log
    break
  fi
  sleep 2
done

# Clone Engram repository
echo "Cloning Engram repository..." | tee -a /var/log/benchmark-startup.log
mkdir -p /opt/engram
cd /opt/engram

# Clone with GitHub CLI or git
if ! git clone https://github.com/engram-labs/engram.git .; then
  echo "Failed to clone repo - may need authentication" | tee -a /var/log/benchmark-startup.log
fi

# Install dependencies (if repo was cloned)
if [ -f package.json ]; then
  echo "Installing dependencies..." | tee -a /var/log/benchmark-startup.log
  npm install
fi

# Download benchmark dataset from GCS
echo "Downloading benchmark dataset..." | tee -a /var/log/benchmark-startup.log
mkdir -p /data
gsutil cp gs://${gcpProject}-benchmark-data/longmemeval_oracle.json /data/ || true

# Set environment variables for the benchmark
cat > /opt/engram/.env << EOF
NODE_ENV=production
BENCHMARK_VERBOSE=true
GOOGLE_GENERATIVE_AI_API_KEY=$(gcloud secrets versions access latest --secret=google-generative-ai-api-key)
EMBEDDER_DEVICE=cuda
EMBEDDER_DTYPE=fp16
QDRANT_URL=http://localhost:6333
EOF

# Create benchmark runner script
cat > /opt/engram/run-benchmark.sh << 'SCRIPT'
#!/bin/bash
set -euo pipefail
cd /opt/engram
source .env
export NODE_OPTIONS="--max-old-space-size=24576"

echo "Starting LongMemEval benchmark with full Engram pipeline..."
npx tsx packages/benchmark/src/cli/index.ts \
  --dataset /data/longmemeval_oracle.json \
  --variant oracle \
  --llm gemini \
  --gemini-model gemini-3-flash-preview \
  --embeddings engram \
  --hybrid \
  --rerank \
  --rerank-tier accurate \
  --rerank-depth 150 \
  --multi-query \
  --session-aware \
  --temporal-query-parsing \
  --temporal-confidence-threshold 0.5 \
  --abstention \
  --abstention-threshold 0.3 \
  --abstention-hedging \
  --abstention-nli \
  --abstention-nli-threshold 0.7 \
  --key-expansion \
  --temporal-analysis \
  --chain-of-note \
  --time-aware \
  --embedding-model e5-large \
  --verbose \
  --output /data/benchmark-results.jsonl

echo "Benchmark complete! Results saved to /data/benchmark-results.jsonl"
gsutil cp /data/benchmark-results.jsonl gs://${gcpProject}-benchmark-results/
SCRIPT

chmod +x /opt/engram/run-benchmark.sh

echo "=== Startup Complete ===" | tee -a /var/log/benchmark-startup.log
date | tee -a /var/log/benchmark-startup.log
`;

/**
 * Service account for the benchmark VM.
 * Needs access to:
 * - Secret Manager (API keys)
 * - GCS (dataset and results)
 */
export const benchmarkVmServiceAccount = benchmarkVmConfig.enabled
	? new gcp.serviceaccount.Account("benchmark-vm-sa", {
			accountId: "benchmark-vm",
			displayName: "Benchmark VM Service Account",
			description: "Service account for the benchmark GCE VM with GPU",
		})
	: undefined;

/**
 * IAM binding for Secret Manager access.
 */
export const benchmarkVmSecretAccess = benchmarkVmConfig.enabled
	? new gcp.secretmanager.SecretIamMember("benchmark-vm-secret-access", {
			secretId: googleGenerativeAiApiKeySecret.secretId,
			role: "roles/secretmanager.secretAccessor",
			member: pulumi.interpolate`serviceAccount:${benchmarkVmServiceAccount!.email}`,
		})
	: undefined;

/**
 * IAM binding for GCS access (benchmark data bucket).
 */
export const benchmarkVmDataAccess = benchmarkVmConfig.enabled
	? new gcp.storage.BucketIAMMember("benchmark-vm-data-access", {
			bucket: benchmarkDataBucket.name,
			role: "roles/storage.objectViewer",
			member: pulumi.interpolate`serviceAccount:${benchmarkVmServiceAccount!.email}`,
		})
	: undefined;

/**
 * IAM binding for GCS access (benchmark results bucket).
 */
export const benchmarkVmResultsAccess = benchmarkVmConfig.enabled
	? new gcp.storage.BucketIAMMember("benchmark-vm-results-access", {
			bucket: benchmarkResultsBucket.name,
			role: "roles/storage.objectAdmin",
			member: pulumi.interpolate`serviceAccount:${benchmarkVmServiceAccount!.email}`,
		})
	: undefined;

/**
 * Static external IP for the benchmark VM.
 */
export const benchmarkVmAddress = benchmarkVmConfig.enabled
	? new gcp.compute.Address("benchmark-vm-ip", {
			name: "benchmark-vm-ip",
			region: gcpRegion,
			addressType: "EXTERNAL",
		})
	: undefined;

/**
 * Firewall rule to allow SSH access to the benchmark VM.
 */
export const benchmarkVmFirewall = benchmarkVmConfig.enabled
	? new gcp.compute.Firewall("benchmark-vm-ssh", {
			name: "benchmark-vm-ssh",
			network: "default",
			allows: [
				{
					protocol: "tcp",
					ports: ["22"],
				},
			],
			sourceRanges: ["0.0.0.0/0"],
			targetTags: ["benchmark-vm"],
		})
	: undefined;

/**
 * Benchmark GCE VM with L4 GPU.
 *
 * Uses Deep Learning VM image with CUDA pre-installed for optimal GPU performance.
 */
export const benchmarkVm = benchmarkVmConfig.enabled
	? new gcp.compute.Instance(
			"benchmark-vm",
			{
				name: "benchmark-vm",
				machineType: benchmarkVmConfig.machineType,
				zone: benchmarkVmConfig.zone,

				// Boot disk with Deep Learning VM image (CUDA 12.8 + NVIDIA driver 570)
				bootDisk: {
					initializeParams: {
						image:
							"projects/deeplearning-platform-release/global/images/family/common-cu128-ubuntu-2204-nvidia-570",
						size: benchmarkVmConfig.diskSizeGb,
						type: "pd-ssd",
					},
				},

				// L4 GPU accelerator
				guestAccelerators: [
					{
						type: `projects/${gcpProject}/zones/${benchmarkVmConfig.zone}/acceleratorTypes/${benchmarkVmConfig.gpuType}`,
						count: benchmarkVmConfig.gpuCount,
					},
				],

				// GPU instances must terminate on maintenance
				scheduling: {
					onHostMaintenance: "TERMINATE",
					automaticRestart: true,
				},

				// Network configuration
				networkInterfaces: [
					{
						network: "default",
						accessConfigs: [
							{
								natIp: benchmarkVmAddress!.address,
								networkTier: "PREMIUM",
							},
						],
					},
				],

				// Service account with required permissions
				serviceAccount: {
					email: benchmarkVmServiceAccount!.email,
					scopes: ["cloud-platform"],
				},

				// Startup script
				metadataStartupScript: startupScript,

				// Tags for firewall rules
				tags: ["benchmark-vm"],

				// Labels
				labels: {
					...commonLabels,
					purpose: "benchmark",
					gpu: "l4",
				},

				// Metadata
				metadata: {
					"enable-oslogin": "TRUE",
				},
			},
			{
				dependsOn: [
					benchmarkVmServiceAccount!,
					benchmarkVmSecretAccess!,
					benchmarkVmDataAccess!,
					benchmarkVmResultsAccess!,
				],
			},
		)
	: undefined;

// =============================================================================
// Exports
// =============================================================================

/** SSH command to connect to the benchmark VM */
export const benchmarkVmSshCommand = benchmarkVmConfig.enabled
	? pulumi.interpolate`gcloud compute ssh benchmark-vm --zone=${benchmarkVmConfig.zone} --project=${gcpProject}`
	: pulumi.output("Benchmark VM not enabled. Set benchmarkVmEnabled=true to create.");

/** External IP of the benchmark VM */
export const benchmarkVmExternalIp = benchmarkVmAddress?.address;

/** Command to start the benchmark */
export const benchmarkVmRunCommand = benchmarkVmConfig.enabled
	? pulumi.interpolate`gcloud compute ssh benchmark-vm --zone=${benchmarkVmConfig.zone} --project=${gcpProject} --command="/opt/engram/run-benchmark.sh"`
	: pulumi.output("Benchmark VM not enabled.");

/** Command to check benchmark VM status */
export const benchmarkVmStatusCommand = benchmarkVmConfig.enabled
	? pulumi.interpolate`gcloud compute instances describe benchmark-vm --zone=${benchmarkVmConfig.zone} --project=${gcpProject} --format="value(status)"`
	: pulumi.output("Benchmark VM not enabled.");
