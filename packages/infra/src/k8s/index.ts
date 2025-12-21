/**
 * Kubernetes Workloads for Engram
 *
 * This module deploys all Kubernetes workloads to the GKE cluster:
 * - FalkorDB: Graph database (Redis protocol)
 * - Qdrant: Vector similarity search
 * - Redpanda: Kafka-compatible streaming
 * - Tuner: Hyperparameter optimization (PostgreSQL + API + Dashboard)
 */

// FalkorDB Graph Database (endpoint only - resources are internal)
export { falkordbEndpoint } from "./falkordb";
// Namespace and K8s Provider
export { k8sProvider, namespace, namespaceName } from "./namespace";

// Qdrant Vector Database (endpoints only - resources are internal)
export { qdrantEndpoint, qdrantGrpcEndpoint } from "./qdrant";

// Redpanda Streaming (endpoints only - resources are internal)
export { redpandaEndpoint, redpandaSchemaRegistryEndpoint } from "./redpanda";

// Tuner Service (endpoints only - resources are internal)
export {
	// Dashboard
	dashboardEndpoint,
	// Tuner API
	tunerEndpoint,
} from "./tuner";
