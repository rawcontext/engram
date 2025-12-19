/**
 * Kubernetes Namespace for Engram
 *
 * All Engram workloads run in this namespace.
 */

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels } from "../config";
import { cluster } from "../gke";

// Create a Kubernetes provider using the GKE cluster
export const k8sProvider = new k8s.Provider("gke-k8s", {
	kubeconfig: cluster.endpoint.apply((endpoint) =>
		cluster.masterAuth.apply(
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

/**
 * Engram namespace where all workloads run
 */
export const namespace = new k8s.core.v1.Namespace(
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
);

export const namespaceName = namespace.metadata.name;
