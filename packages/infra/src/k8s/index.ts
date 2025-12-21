/**
 * Kubernetes Workloads for Engram
 *
 * This module deploys all Kubernetes workloads to the GKE cluster:
 * - FalkorDB: Graph database (Redis protocol)
 * - Qdrant: Vector similarity search
 * - Redpanda: Kafka-compatible streaming
 * - Tuner: Hyperparameter optimization (PostgreSQL + API + Dashboard)
 * - Backups: Automated database backups to GCS
 * - NetworkPolicies: Network segmentation and access control
 * - RBAC: Service accounts and role bindings
 */

// Backups (bucket and schedules only - CronJobs are internal)
export { backupBucket, backupSchedules } from "./backups";

// FalkorDB Graph Database (endpoint only - resources are internal)
export { falkordbEndpoint } from "./falkordb";

// Namespace and K8s Provider
export { k8sProvider, namespace, namespaceName } from "./namespace";

// NetworkPolicies (no exports - all internal)
import "./network-policy";

// Qdrant Vector Database (endpoints only - resources are internal)
export { qdrantEndpoint, qdrantGrpcEndpoint } from "./qdrant";

// RBAC (service accounts only - roles are internal)
export {
	ingestionServiceAccount,
	mcpServiceAccount,
	memoryServiceAccount,
	searchServiceAccount,
} from "./rbac";

// Redpanda Streaming (endpoints only - resources are internal)
export { redpandaEndpoint, redpandaSchemaRegistryEndpoint } from "./redpanda";

// Tuner Service (endpoints only - resources are internal)
export {
	// Dashboard
	dashboardEndpoint,
	// Tuner API
	tunerEndpoint,
} from "./tuner";
