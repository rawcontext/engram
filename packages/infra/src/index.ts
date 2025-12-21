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
 *
 * Note: Benchmarks now run on Hugging Face Spaces (see packages/benchmark/)
 */

// Re-export configuration for reference
export { commonLabels, environment, gcpProject, gcpRegion } from "./config";
// Re-export GKE resources
export { cluster, kubeconfig } from "./gke";
// Re-export Kubernetes workloads (endpoints only - resources are internal)
export {
	// Dashboard
	dashboardEndpoint,
	// FalkorDB
	falkordbEndpoint,
	// K8s Provider
	k8sProvider,
	// Namespace
	namespace,
	namespaceName,
	// Qdrant
	qdrantEndpoint,
	qdrantGrpcEndpoint,
	// Redpanda
	redpandaEndpoint,
	redpandaSchemaRegistryEndpoint,
	// Tuner
	tunerEndpoint,
} from "./k8s";
// Re-export network resources
export { nat, network, router, subnet } from "./network";
// Re-export secrets
export { googleGenerativeAiApiKeySecret } from "./secrets";
