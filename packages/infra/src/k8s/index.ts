/**
 * Kubernetes Workloads for Engram
 *
 * This module deploys all Kubernetes workloads to the GKE cluster:
 * - FalkorDB: Graph database (Redis protocol)
 * - Qdrant: Vector similarity search
 * - Redpanda: Kafka-compatible streaming
 * - Tuner: Hyperparameter optimization (PostgreSQL + API + Dashboard)
 */

// Namespace and K8s Provider
export { k8sProvider, namespace, namespaceName } from "./namespace";

// FalkorDB Graph Database
export { falkordbEndpoint, falkordbService, falkordbStatefulSet } from "./falkordb";

// Qdrant Vector Database
export { qdrantEndpoint, qdrantGrpcEndpoint, qdrantRelease } from "./qdrant";

// Redpanda Streaming
export { redpandaEndpoint, redpandaRelease, redpandaSchemaRegistryEndpoint } from "./redpanda";

// Tuner Service
export {
	// Dashboard
	dashboardDeployment,
	dashboardEndpoint,
	dashboardService,
	// PostgreSQL
	postgresEndpoint,
	postgresSecret,
	postgresService,
	postgresStatefulSet,
	// Tuner API
	tunerConfigMap,
	tunerDeployment,
	tunerEndpoint,
	tunerPdb,
	tunerSecret,
	tunerService,
} from "./tuner";
