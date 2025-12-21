import * as pulumi from "@pulumi/pulumi";

/**
 * Engram Infrastructure Configuration
 *
 * This module provides centralized configuration for all infrastructure resources.
 * Values are loaded from Pulumi stack configuration with sensible defaults.
 */

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");

// GCP Configuration
export const gcpProject = gcpConfig.require("project");
export const gcpRegion = gcpConfig.get("region") ?? "us-central1";

// Environment
export const environment = pulumi.getStack();

// Network Configuration
export const networkConfig = {
	cidrRange: config.get("networkCidr") ?? "10.0.0.0/16",
};

// GKE Configuration
export const gkeConfig = {
	// Disable deletion protection for non-production environments
	deletionProtection: environment === "prod",
};

// Database Configuration
export const databaseConfig = {
	// Use 3 replicas for production HA, 1 for dev/test
	replicas: environment === "prod" ? 3 : 1,
};

// Common Labels (must be lowercase for GCP)
export const commonLabels = {
	project: "engram",
	environment: environment,
	"managed-by": "pulumi",
};

// =============================================================================
// Dev Environment On/Off Switch
// =============================================================================

/**
 * Master switch for dev environment.
 * When false, expensive resources (GKE, K8s workloads) are not created.
 * When true, everything is created and running.
 *
 * Toggle with:
 *   pulumi config set devEnabled true   # Turn on
 *   pulumi config set devEnabled false  # Turn off
 *   pulumi up                           # Apply changes
 *
 * Or use the helper scripts:
 *   npm run infra:wake    # Set devEnabled=true and apply
 *   npm run infra:sleep   # Set devEnabled=false and apply
 */
export const devEnabled = config.getBoolean("devEnabled") ?? true;
