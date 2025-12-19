/**
 * FalkorDB StatefulSet
 *
 * Graph database using Redis protocol for Engram's knowledge graph.
 * Connection: redis://falkordb.engram.svc.cluster.local:6379
 *
 * Only created when devEnabled=true.
 */

import * as k8s from "@pulumi/kubernetes";
import { commonLabels } from "../config";
import { k8sProvider, namespaceName } from "./namespace";

const appLabels = {
	"app.kubernetes.io/name": "falkordb",
	"app.kubernetes.io/component": "graph-database",
	"app.kubernetes.io/part-of": "engram",
};

/**
 * FalkorDB StatefulSet for persistent graph storage
 * Only created when k8sProvider exists (devEnabled=true)
 */
export const falkordbStatefulSet = k8sProvider
	? new k8s.apps.v1.StatefulSet(
			"falkordb",
			{
				metadata: {
					name: "falkordb",
					namespace: namespaceName,
					labels: { ...commonLabels, ...appLabels },
				},
				spec: {
					serviceName: "falkordb",
					replicas: 1,
					selector: {
						matchLabels: { "app.kubernetes.io/name": "falkordb" },
					},
					template: {
						metadata: {
							labels: appLabels,
						},
						spec: {
							containers: [
								{
									name: "falkordb",
									image: "falkordb/falkordb:v4.2.1",
									ports: [
										{
											containerPort: 6379,
											name: "redis",
											protocol: "TCP",
										},
									],
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
									livenessProbe: {
										exec: {
											command: ["redis-cli", "ping"],
										},
										initialDelaySeconds: 30,
										periodSeconds: 10,
									},
									readinessProbe: {
										exec: {
											command: ["redis-cli", "ping"],
										},
										initialDelaySeconds: 5,
										periodSeconds: 5,
									},
									volumeMounts: [
										{
											name: "data",
											mountPath: "/data",
										},
									],
								},
							],
						},
					},
					volumeClaimTemplates: [
						{
							metadata: {
								name: "data",
							},
							spec: {
								accessModes: ["ReadWriteOnce"],
								storageClassName: "standard-rwo",
								resources: {
									requests: {
										storage: "50Gi",
									},
								},
							},
						},
					],
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Headless service for FalkorDB StatefulSet
 */
export const falkordbService = k8sProvider
	? new k8s.core.v1.Service(
			"falkordb",
			{
				metadata: {
					name: "falkordb",
					namespace: namespaceName,
					labels: { ...commonLabels, ...appLabels },
				},
				spec: {
					type: "ClusterIP",
					clusterIP: "None", // Headless service
					ports: [
						{
							port: 6379,
							targetPort: 6379,
							protocol: "TCP",
							name: "redis",
						},
					],
					selector: {
						"app.kubernetes.io/name": "falkordb",
					},
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

export const falkordbEndpoint = "redis://falkordb.engram.svc.cluster.local:6379";
