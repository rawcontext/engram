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
 *
 * Note: Data plane services (FalkorDB, Qdrant, Redpanda) are deployed
 * via Helm charts after the cluster is provisioned. See k8s/ directory
 * for Helm values files.
 */

// Re-export configuration for reference
export { commonLabels, environment, gcpProject, gcpRegion } from "./config";

// Re-export GKE resources
export { cluster, kubeconfig } from "./gke";
// Re-export network resources
export { nat, network, router, subnet } from "./network";
// Re-export secrets
export { anthropicApiKeySecret, openaiApiKeySecret, xaiApiKeySecret } from "./secrets";
