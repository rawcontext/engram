/**
 * Pulumi Test Utilities
 *
 * Provides helper functions for unit testing Pulumi infrastructure code.
 * Uses Pulumi's runtime mocks to test resource properties without deploying.
 *
 * IMPORTANT: Call setupPulumiMocks() before importing any infrastructure modules,
 * otherwise Pulumi's Config will fail with "Missing required configuration variable".
 */

import * as pulumi from "@pulumi/pulumi";

/**
 * Resource tracking for test assertions
 */
interface TrackedResource {
	type: string;
	name: string;
	inputs: Record<string, unknown>;
	id: string;
}

const trackedResources: TrackedResource[] = [];

/**
 * Get all tracked resources (for test assertions)
 */
export function getTrackedResources(): TrackedResource[] {
	return trackedResources;
}

/**
 * Get resources by type
 */
export function getResourcesByType(type: string): TrackedResource[] {
	return trackedResources.filter((r) => r.type === type);
}

/**
 * Get a single resource by type and name
 */
export function getResource(type: string, name: string): TrackedResource | undefined {
	return trackedResources.find((r) => r.type === type && r.name === name);
}

/**
 * Clear tracked resources (call in beforeEach)
 */
export function clearTrackedResources(): void {
	trackedResources.length = 0;
}

/**
 * Extract the value from a Pulumi Output for testing.
 * This uses the internal promise() method available in test mode.
 */
export function getOutputValue<T>(output: pulumi.Output<T>): Promise<T | undefined> {
	return (output as unknown as { promise(): Promise<T | undefined> }).promise();
}

/**
 * Setup Pulumi mocks for unit testing.
 * Must be called before importing infrastructure modules.
 *
 * @param project - The project name for the mock
 * @param stack - The stack name for the mock
 */
export function setupPulumiMocks(project = "engram", stack = "test"): void {
	clearTrackedResources();

	pulumi.runtime.setMocks(
		{
			newResource: (args: pulumi.runtime.MockResourceArgs): pulumi.runtime.MockResourceResult => {
				// Track the resource for test assertions
				trackedResources.push({
					type: args.type,
					name: args.name,
					inputs: args.inputs as Record<string, unknown>,
					id: `${args.name}-id`,
				});

				// Return mock state based on resource type
				const defaultState: Record<string, unknown> = {
					...args.inputs,
					name: args.name,
				};

				// Add type-specific mock outputs
				switch (args.type) {
					case "gcp:compute/network:Network":
						defaultState.selfLink = `https://compute.googleapis.com/compute/v1/projects/test-project/global/networks/${args.name}`;
						defaultState.id = `projects/test-project/global/networks/${args.name}`;
						break;

					case "gcp:compute/subnetwork:Subnetwork":
						defaultState.selfLink = `https://compute.googleapis.com/compute/v1/projects/test-project/regions/us-central1/subnetworks/${args.name}`;
						defaultState.gatewayAddress = "10.0.0.1";
						break;

					case "gcp:compute/router:Router":
						defaultState.selfLink = `https://compute.googleapis.com/compute/v1/projects/test-project/regions/us-central1/routers/${args.name}`;
						break;

					case "gcp:compute/routerNat:RouterNat":
						// NAT resources don't have additional outputs
						break;

					case "gcp:container/cluster:Cluster":
						defaultState.endpoint = "34.123.45.67";
						defaultState.masterAuth = {
							clusterCaCertificate:
								"LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCnRlc3QtY2EtY2VydAotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==",
							clientCertificate: "",
							clientKey: "",
						};
						defaultState.selfLink = `https://container.googleapis.com/v1/projects/test-project/locations/us-central1/clusters/${args.name}`;
						break;

					case "gcp:secretmanager/secret:Secret":
						defaultState.id = `projects/test-project/secrets/${args.inputs.secretId}`;
						defaultState.name = `projects/test-project/secrets/${args.inputs.secretId}`;
						break;

					// Kubernetes resources
					case "kubernetes:core/v1:Namespace":
						defaultState.metadata = {
							...((args.inputs.metadata as Record<string, unknown>) ?? {}),
							uid: `${args.name}-uid`,
						};
						break;

					case "kubernetes:core/v1:Secret":
					case "kubernetes:core/v1:ConfigMap":
					case "kubernetes:core/v1:Service":
						defaultState.metadata = {
							...((args.inputs.metadata as Record<string, unknown>) ?? {}),
							uid: `${args.name}-uid`,
						};
						break;

					case "kubernetes:apps/v1:StatefulSet":
					case "kubernetes:apps/v1:Deployment":
						defaultState.metadata = {
							...((args.inputs.metadata as Record<string, unknown>) ?? {}),
							uid: `${args.name}-uid`,
						};
						defaultState.status = {
							readyReplicas: (args.inputs.spec as Record<string, unknown>)?.replicas ?? 1,
							availableReplicas: (args.inputs.spec as Record<string, unknown>)?.replicas ?? 1,
						};
						break;

					case "kubernetes:policy/v1:PodDisruptionBudget":
						defaultState.metadata = {
							...((args.inputs.metadata as Record<string, unknown>) ?? {}),
							uid: `${args.name}-uid`,
						};
						break;

					case "kubernetes:helm.sh/v3:Release":
						defaultState.status = {
							status: "deployed",
						};
						break;

					case "pulumi:providers:kubernetes":
						// Provider resources
						break;

					// Cloud Run resources
					case "gcp:cloudrunv2/job:Job":
						defaultState.uid = `${args.name}-uid`;
						defaultState.generation = "1";
						defaultState.observedGeneration = "1";
						break;

					case "gcp:storage/bucket:Bucket":
						defaultState.url = `gs://${args.inputs.name}`;
						defaultState.selfLink = `https://storage.googleapis.com/storage/v1/b/${args.inputs.name}`;
						break;

					case "gcp:storage/bucketIAMMember:BucketIAMMember":
						// IAM bindings don't have special outputs
						break;

					case "gcp:serviceaccount/account:Account":
						defaultState.email = `${args.inputs.accountId}@test-project.iam.gserviceaccount.com`;
						defaultState.uniqueId = `${args.name}-unique-id`;
						break;

					case "gcp:secretmanager/secretIamMember:SecretIamMember":
						// IAM bindings don't have special outputs
						break;
				}

				return {
					id: `${args.name}-id`,
					state: defaultState,
				};
			},

			call: (args: pulumi.runtime.MockCallArgs): Record<string, unknown> => {
				// Mock function calls (e.g., gcp.config.project)
				switch (args.token) {
					case "gcp:config/project:project":
						return { project: "test-project" };
					case "gcp:config/region:region":
						return { region: "us-central1" };
					default:
						return args.inputs;
				}
			},
		},
		project,
		stack,
		false, // dryRun = false for unit tests
	);
}

/**
 * Initialize Pulumi for testing by setting required environment variables
 * and calling setupPulumiMocks. This should be called once at the start
 * of the test file, before any other imports.
 */
export function initPulumiTest(): void {
	// Set Pulumi config via environment variables (format: PULUMI_CONFIG_<namespace>:<key>)
	// These need to be set before Pulumi Config is instantiated
	process.env.PULUMI_CONFIG = JSON.stringify({
		"gcp:project": "test-project",
		"gcp:region": "us-central1",
	});

	setupPulumiMocks();
}
