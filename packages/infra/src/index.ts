/**
 * Engram Infrastructure
 *
 * This is the main entry point for Pulumi infrastructure deployment.
 * Infrastructure is organized into logical modules:
 *
 * - config.ts: Centralized configuration and constants
 * - network.ts: VPC, subnets, NAT configuration
 * - gke.ts: GKE Autopilot cluster
 * - secrets.ts: Secret Manager secrets
 * - k8s/: Kubernetes workloads deployed to GKE
 *   - namespace.ts: Engram namespace and K8s provider
 *   - falkordb.ts: Graph database (Redis protocol)
 *   - qdrant.ts: Vector database (Helm)
 *   - redpanda.ts: Kafka-compatible streaming (Helm)
 *   - tuner.ts: Hyperparameter optimization stack
 */

// Re-export Cloud Run resources
export {
	// Benchmark Job
	benchmarkConfig,
	benchmarkDataAccess,
	benchmarkDataBucket,
	benchmarkDataBucketName,
	benchmarkJob,
	benchmarkJobLocation,
	benchmarkJobName,
	benchmarkResultsAccess,
	benchmarkResultsBucket,
	benchmarkResultsBucketName,
	benchmarkSecretAccess,
	benchmarkServiceAccount,
	executeCommand,
	geminiApiKeySecret,
	logsCommand,
} from "./cloudrun";
// Re-export configuration for reference
export { commonLabels, environment, gcpProject, gcpRegion } from "./config";
// Re-export GKE resources
export { cluster, kubeconfig } from "./gke";
// Re-export Kubernetes workloads
export {
	// Dashboard
	dashboardDeployment,
	dashboardEndpoint,
	dashboardService,
	// FalkorDB
	falkordbEndpoint,
	falkordbService,
	falkordbStatefulSet,
	// K8s Provider
	k8sProvider,
	// Namespace
	namespace,
	namespaceName,
	// PostgreSQL
	postgresEndpoint,
	postgresSecret,
	postgresService,
	postgresStatefulSet,
	// Qdrant
	qdrantEndpoint,
	qdrantGrpcEndpoint,
	qdrantRelease,
	// Redpanda
	redpandaEndpoint,
	redpandaRelease,
	redpandaSchemaRegistryEndpoint,
	// Tuner
	tunerConfigMap,
	tunerDeployment,
	tunerEndpoint,
	tunerPdb,
	tunerSecret,
	tunerService,
} from "./k8s";
// Re-export network resources
export { nat, network, router, subnet } from "./network";
// Re-export secrets
export { googleGenerativeAiApiKeySecret } from "./secrets";
