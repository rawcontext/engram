/**
 * Qdrant Vector Database
 *
 * Vector similarity search for Engram's semantic memory.
 * Connection: http://qdrant.engram.svc.cluster.local:6333
 *
 * Deployed via Helm chart: qdrant/qdrant
 * Repo: https://qdrant.github.io/qdrant-helm
 *
 * Only created when devEnabled=true.
 */

import * as k8s from "@pulumi/kubernetes";
import { commonLabels, databaseConfig } from "../config";
import { k8sProvider, namespaceName } from "./namespace";

/**
 * Qdrant Helm release
 * Only created when k8sProvider exists (devEnabled=true)
 */
/* istanbul ignore next */
export const qdrantRelease = k8sProvider
	? new k8s.helm.v3.Release(
			"qdrant",
			{
				name: "qdrant",
				namespace: namespaceName,
				chart: "qdrant",
				repositoryOpts: {
					repo: "https://qdrant.github.io/qdrant-helm",
				},
				version: "0.10.1", // Chart version
				values: {
					replicaCount: databaseConfig.replicas,
					image: {
						repository: "qdrant/qdrant",
						tag: "v1.12.1",
						pullPolicy: "IfNotPresent",
					},
					persistence: {
						enabled: true,
						size: "50Gi",
						storageClassName: "standard-rwo",
					},
					resources: {
						requests: {
							cpu: "500m",
							memory: "1Gi",
						},
						limits: {
							cpu: "2",
							memory: "4Gi",
						},
					},
					config: {
						service: {
							enable_tls: false,
							http_port: 6333,
							grpc_port: 6334,
						},
						cluster: {
							enabled: databaseConfig.replicas > 1,
						},
						storage: {
							performance: {
								optimizer_cpu_budget: 1,
							},
						},
					},
					service: {
						type: "ClusterIP",
						port: 6333,
						grpcPort: 6334,
					},
					livenessProbe: {
						enabled: true,
						initialDelaySeconds: 30,
						periodSeconds: 10,
					},
					readinessProbe: {
						enabled: true,
						initialDelaySeconds: 5,
						periodSeconds: 5,
					},
					podLabels: {
						...commonLabels,
						"app.kubernetes.io/part-of": "engram",
					},
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

export const qdrantEndpoint = "http://qdrant.engram.svc.cluster.local:6333";
export const qdrantGrpcEndpoint = "qdrant.engram.svc.cluster.local:6334";
