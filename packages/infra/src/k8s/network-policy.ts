/**
 * Kubernetes NetworkPolicies for Engram
 *
 * Implements network segmentation and least-privilege access between services.
 * Each database can only be accessed by authorized application pods.
 *
 * Only created when devEnabled=true.
 */

import * as k8s from "@pulumi/kubernetes";
import { commonLabels } from "../config";
import { k8sProvider, namespaceName } from "./namespace";

/**
 * NetworkPolicy for FalkorDB
 * Allows ingress only from pods with label app.kubernetes.io/component: memory|ingestion|mcp
 */
export const falkordbNetworkPolicy = k8sProvider
	? new k8s.networking.v1.NetworkPolicy(
			"falkordb-netpol",
			{
				metadata: {
					name: "falkordb-netpol",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				spec: {
					podSelector: {
						matchLabels: {
							"app.kubernetes.io/name": "falkordb",
						},
					},
					policyTypes: ["Ingress"],
					ingress: [
						{
							from: [
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/component": "memory",
										},
									},
								},
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/component": "ingestion",
										},
									},
								},
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/component": "mcp",
										},
									},
								},
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/name": "falkordb-backup",
										},
									},
								},
							],
							ports: [
								{
									protocol: "TCP",
									port: 6379,
								},
							],
						},
					],
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * NetworkPolicy for Qdrant
 * Allows ingress only from pods with label app.kubernetes.io/component: search|memory
 */
export const qdrantNetworkPolicy = k8sProvider
	? new k8s.networking.v1.NetworkPolicy(
			"qdrant-netpol",
			{
				metadata: {
					name: "qdrant-netpol",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				spec: {
					podSelector: {
						matchLabels: {
							"app.kubernetes.io/name": "qdrant",
						},
					},
					policyTypes: ["Ingress"],
					ingress: [
						{
							from: [
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/component": "search",
										},
									},
								},
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/component": "memory",
										},
									},
								},
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/name": "qdrant-backup",
										},
									},
								},
							],
							ports: [
								{
									protocol: "TCP",
									port: 6333,
								},
								{
									protocol: "TCP",
									port: 6334,
								},
							],
						},
					],
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * NetworkPolicy for Redpanda
 * Allows ingress only from pods with label app.kubernetes.io/component: ingestion|memory
 */
export const redpandaNetworkPolicy = k8sProvider
	? new k8s.networking.v1.NetworkPolicy(
			"redpanda-netpol",
			{
				metadata: {
					name: "redpanda-netpol",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				spec: {
					podSelector: {
						matchLabels: {
							"app.kubernetes.io/name": "redpanda",
						},
					},
					policyTypes: ["Ingress"],
					ingress: [
						{
							from: [
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/component": "ingestion",
										},
									},
								},
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/component": "memory",
										},
									},
								},
								{
									podSelector: {
										matchLabels: {
											"app.kubernetes.io/name": "redpanda-backup",
										},
									},
								},
							],
							ports: [
								{
									protocol: "TCP",
									port: 9092,
								},
								{
									protocol: "TCP",
									port: 9644,
								},
								{
									protocol: "TCP",
									port: 8081,
								},
							],
						},
					],
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Default deny all ingress policy for namespace
 * Ensures all pods must explicitly allow ingress via specific NetworkPolicies
 */
export const defaultDenyIngress = k8sProvider
	? new k8s.networking.v1.NetworkPolicy(
			"default-deny-ingress",
			{
				metadata: {
					name: "default-deny-ingress",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				spec: {
					podSelector: {}, // Empty selector matches all pods in namespace
					policyTypes: ["Ingress"],
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;
