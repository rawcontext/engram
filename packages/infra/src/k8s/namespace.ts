/**
 * Kubernetes Namespace for Engram
 *
 * All Engram workloads run in this namespace.
 * Only created when devEnabled=true and GKE cluster exists.
 */

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels, devEnabled } from "../config";
import { cluster } from "../gke";

/**
 * Create a Kubernetes provider using the GKE cluster.
 * Returns undefined when cluster doesn't exist (devEnabled=false).
 */
function createK8sProvider(): k8s.Provider | undefined {
	/* istanbul ignore if */
	if (!cluster) return undefined;

	// Use local variable for TypeScript narrowing
	const c = cluster;

	return new k8s.Provider("gke-k8s", {
		kubeconfig: c.endpoint.apply((endpoint) =>
			c.masterAuth.apply(
				(auth) =>
					pulumi.interpolate`apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${auth.clusterCaCertificate}
    server: https://${endpoint}
  name: gke-cluster
contexts:
- context:
    cluster: gke-cluster
    user: gke-user
  name: gke-context
current-context: gke-context
kind: Config
users:
- name: gke-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gke-gcloud-auth-plugin
      installHint: Install gke-gcloud-auth-plugin for kubectl auth
      provideClusterInfo: true`,
			),
		),
	});
}

export const k8sProvider = createK8sProvider();

/**
 * Engram namespace where all workloads run
 * Only created when devEnabled=true
 */
export const namespace =
	k8sProvider && devEnabled
		? new k8s.core.v1.Namespace(
				"engram",
				{
					metadata: {
						name: "engram",
						labels: {
							...commonLabels,
							"app.kubernetes.io/part-of": "engram",
						},
					},
				},
				{ provider: k8sProvider },
			)
		: /* istanbul ignore next */ undefined;

export const namespaceName = namespace
	? namespace.metadata.name
	: /* istanbul ignore next */ pulumi.output("engram"); // Fallback for exports
