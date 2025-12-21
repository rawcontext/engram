/**
 * Kubernetes RBAC for Engram
 *
 * Implements least-privilege access control for service accounts.
 * Each service has its own ServiceAccount with minimal required permissions.
 *
 * Only created when devEnabled=true.
 */

import * as k8s from "@pulumi/kubernetes";
import { commonLabels } from "../config";
import { k8sProvider, namespaceName } from "./namespace";

/**
 * ServiceAccount for Memory service
 */
export const memoryServiceAccount = k8sProvider
	? new k8s.core.v1.ServiceAccount(
			"memory-sa",
			{
				metadata: {
					name: "memory-sa",
					namespace: namespaceName,
					labels: { ...commonLabels, "app.kubernetes.io/component": "memory" },
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Role for Memory service
 * Grants access to ConfigMaps and Secrets needed for operation
 */
export const memoryRole = k8sProvider
	? new k8s.rbac.v1.Role(
			"memory-role",
			{
				metadata: {
					name: "memory-role",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				rules: [
					{
						apiGroups: [""],
						resources: ["configmaps", "secrets"],
						verbs: ["get", "list", "watch"],
					},
					{
						apiGroups: [""],
						resources: ["pods"],
						verbs: ["get", "list"],
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * RoleBinding for Memory service
 */
export const memoryRoleBinding = k8sProvider
	? new k8s.rbac.v1.RoleBinding(
			"memory-rolebinding",
			{
				metadata: {
					name: "memory-rolebinding",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				roleRef: {
					apiGroup: "rbac.authorization.k8s.io",
					kind: "Role",
					name: memoryRole?.metadata.name ?? "memory-role",
				},
				subjects: [
					{
						kind: "ServiceAccount",
						name: memoryServiceAccount?.metadata.name ?? "memory-sa",
						namespace: namespaceName,
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * ServiceAccount for Ingestion service
 */
export const ingestionServiceAccount = k8sProvider
	? new k8s.core.v1.ServiceAccount(
			"ingestion-sa",
			{
				metadata: {
					name: "ingestion-sa",
					namespace: namespaceName,
					labels: { ...commonLabels, "app.kubernetes.io/component": "ingestion" },
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Role for Ingestion service
 */
export const ingestionRole = k8sProvider
	? new k8s.rbac.v1.Role(
			"ingestion-role",
			{
				metadata: {
					name: "ingestion-role",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				rules: [
					{
						apiGroups: [""],
						resources: ["configmaps", "secrets"],
						verbs: ["get", "list", "watch"],
					},
					{
						apiGroups: [""],
						resources: ["pods"],
						verbs: ["get", "list"],
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * RoleBinding for Ingestion service
 */
export const ingestionRoleBinding = k8sProvider
	? new k8s.rbac.v1.RoleBinding(
			"ingestion-rolebinding",
			{
				metadata: {
					name: "ingestion-rolebinding",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				roleRef: {
					apiGroup: "rbac.authorization.k8s.io",
					kind: "Role",
					name: ingestionRole?.metadata.name ?? "ingestion-role",
				},
				subjects: [
					{
						kind: "ServiceAccount",
						name: ingestionServiceAccount?.metadata.name ?? "ingestion-sa",
						namespace: namespaceName,
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * ServiceAccount for Search service
 */
export const searchServiceAccount = k8sProvider
	? new k8s.core.v1.ServiceAccount(
			"search-sa",
			{
				metadata: {
					name: "search-sa",
					namespace: namespaceName,
					labels: { ...commonLabels, "app.kubernetes.io/component": "search" },
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Role for Search service
 */
export const searchRole = k8sProvider
	? new k8s.rbac.v1.Role(
			"search-role",
			{
				metadata: {
					name: "search-role",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				rules: [
					{
						apiGroups: [""],
						resources: ["configmaps", "secrets"],
						verbs: ["get", "list", "watch"],
					},
					{
						apiGroups: [""],
						resources: ["pods"],
						verbs: ["get", "list"],
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * RoleBinding for Search service
 */
export const searchRoleBinding = k8sProvider
	? new k8s.rbac.v1.RoleBinding(
			"search-rolebinding",
			{
				metadata: {
					name: "search-rolebinding",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				roleRef: {
					apiGroup: "rbac.authorization.k8s.io",
					kind: "Role",
					name: searchRole?.metadata.name ?? "search-role",
				},
				subjects: [
					{
						kind: "ServiceAccount",
						name: searchServiceAccount?.metadata.name ?? "search-sa",
						namespace: namespaceName,
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * ServiceAccount for MCP service
 */
export const mcpServiceAccount = k8sProvider
	? new k8s.core.v1.ServiceAccount(
			"mcp-sa",
			{
				metadata: {
					name: "mcp-sa",
					namespace: namespaceName,
					labels: { ...commonLabels, "app.kubernetes.io/component": "mcp" },
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Role for MCP service
 */
export const mcpRole = k8sProvider
	? new k8s.rbac.v1.Role(
			"mcp-role",
			{
				metadata: {
					name: "mcp-role",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				rules: [
					{
						apiGroups: [""],
						resources: ["configmaps", "secrets"],
						verbs: ["get", "list", "watch"],
					},
					{
						apiGroups: [""],
						resources: ["pods"],
						verbs: ["get", "list"],
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * RoleBinding for MCP service
 */
export const mcpRoleBinding = k8sProvider
	? new k8s.rbac.v1.RoleBinding(
			"mcp-rolebinding",
			{
				metadata: {
					name: "mcp-rolebinding",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
				roleRef: {
					apiGroup: "rbac.authorization.k8s.io",
					kind: "Role",
					name: mcpRole?.metadata.name ?? "mcp-role",
				},
				subjects: [
					{
						kind: "ServiceAccount",
						name: mcpServiceAccount?.metadata.name ?? "mcp-sa",
						namespace: namespaceName,
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * ClusterRole for backup jobs
 * Needs to access PVCs and perform backups
 */
export const backupClusterRole = k8sProvider
	? new k8s.rbac.v1.ClusterRole(
			"backup-clusterrole",
			{
				metadata: {
					name: "engram-backup-clusterrole",
					labels: { ...commonLabels },
				},
				rules: [
					{
						apiGroups: [""],
						resources: ["persistentvolumeclaims", "persistentvolumes"],
						verbs: ["get", "list"],
					},
					{
						apiGroups: [""],
						resources: ["pods", "pods/log"],
						verbs: ["get", "list"],
					},
					{
						apiGroups: ["storage.k8s.io"],
						resources: ["storageclasses"],
						verbs: ["get", "list"],
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * ClusterRoleBinding for backup jobs
 */
export const backupClusterRoleBinding = k8sProvider
	? new k8s.rbac.v1.ClusterRoleBinding(
			"backup-clusterrolebinding",
			{
				metadata: {
					name: "engram-backup-clusterrolebinding",
					labels: { ...commonLabels },
				},
				roleRef: {
					apiGroup: "rbac.authorization.k8s.io",
					kind: "ClusterRole",
					name: backupClusterRole?.metadata.name ?? "engram-backup-clusterrole",
				},
				subjects: [
					{
						kind: "ServiceAccount",
						name: "backup-sa",
						namespace: namespaceName,
					},
				],
			},
			{ provider: k8sProvider },
		)
	: undefined;
