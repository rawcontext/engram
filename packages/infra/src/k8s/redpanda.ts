/**
 * Redpanda Streaming
 *
 * Kafka-compatible event streaming for Engram's message bus.
 * Connection: redpanda.engram.svc.cluster.local:9092
 *
 * Deployed via Helm chart: redpanda/redpanda
 * Repo: https://charts.redpanda.com
 */

import * as k8s from "@pulumi/kubernetes";
import { commonLabels } from "../config";
import { k8sProvider, namespaceName } from "./namespace";

/**
 * Redpanda Helm release
 */
export const redpandaRelease = new k8s.helm.v3.Release(
	"redpanda",
	{
		name: "redpanda",
		namespace: namespaceName,
		chart: "redpanda",
		repositoryOpts: {
			repo: "https://charts.redpanda.com",
		},
		version: "5.9.4", // Chart version
		values: {
			statefulset: {
				replicas: 1,
			},
			image: {
				repository: "docker.redpanda.com/redpandadata/redpanda",
				tag: "v24.2.1",
			},
			storage: {
				persistentVolume: {
					enabled: true,
					size: "50Gi",
					storageClass: "standard-rwo",
				},
			},
			resources: {
				cpu: {
					cores: 1,
				},
				memory: {
					container: {
						max: "2Gi",
					},
					redpanda: {
						memory: "1536Mi",
						reserveMemory: "512Mi",
					},
				},
			},
			// Internal access only
			external: {
				enabled: false,
			},
			listeners: {
				kafka: {
					port: 9092,
				},
				admin: {
					port: 9644,
				},
				schemaRegistry: {
					enabled: true,
					port: 8081,
				},
			},
			// Monitoring
			monitoring: {
				enabled: false,
			},
			// Console UI
			console: {
				enabled: false,
			},
			// Resource labels
			commonLabels: {
				...commonLabels,
				"app.kubernetes.io/part-of": "engram",
			},
		},
	},
	{ provider: k8sProvider },
);

export const redpandaEndpoint = "redpanda.engram.svc.cluster.local:9092";
export const redpandaSchemaRegistryEndpoint = "redpanda.engram.svc.cluster.local:8081";
