/**
 * Tuner Service Infrastructure
 *
 * Hyperparameter optimization service with Optuna.
 * Components:
 * - PostgreSQL for study persistence
 * - Tuner API (FastAPI + Optuna)
 * - Optuna Dashboard for visualization
 *
 * Connections:
 * - Tuner API: http://tuner.engram.svc.cluster.local:8000
 * - Dashboard: http://tuner-dashboard.engram.svc.cluster.local:8080
 * - PostgreSQL: postgresql://tuner-postgres.engram.svc.cluster.local:5432/optuna
 *
 * Only created when devEnabled=true.
 */

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels, gcpProject } from "../config";
import { k8sProvider, namespaceName } from "./namespace";

// =============================================================================
// PostgreSQL for Optuna Persistence
// =============================================================================

const postgresLabels = {
	"app.kubernetes.io/name": "tuner-postgres",
	"app.kubernetes.io/component": "database",
	"app.kubernetes.io/part-of": "engram",
};

/**
 * PostgreSQL credentials secret
 */
export const postgresSecret = k8sProvider
	? new k8s.core.v1.Secret(
			"tuner-postgres-credentials",
			{
				metadata: {
					name: "tuner-postgres-credentials",
					namespace: namespaceName,
					labels: { ...commonLabels, ...postgresLabels },
				},
				type: "Opaque",
				stringData: {
					POSTGRES_USER: pulumi
						.secret(process.env.TUNER_POSTGRES_USER || "postgres")
						.apply((v) => v),
					POSTGRES_PASSWORD: pulumi.secret(
						process.env.TUNER_POSTGRES_PASSWORD || "CHANGE_ME_IN_PRODUCTION",
					),
					POSTGRES_DB: "optuna",
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * PostgreSQL StatefulSet
 */
export const postgresStatefulSet =
	k8sProvider && postgresSecret
		? new k8s.apps.v1.StatefulSet(
				"tuner-postgres",
				{
					metadata: {
						name: "tuner-postgres",
						namespace: namespaceName,
						labels: { ...commonLabels, ...postgresLabels },
					},
					spec: {
						serviceName: "tuner-postgres",
						replicas: 1,
						selector: {
							matchLabels: { "app.kubernetes.io/name": "tuner-postgres" },
						},
						template: {
							metadata: {
								labels: postgresLabels,
							},
							spec: {
								containers: [
									{
										name: "postgres",
										image: "postgres:17-alpine",
										ports: [
											{
												containerPort: 5432,
												name: "postgres",
												protocol: "TCP",
											},
										],
										envFrom: [
											{
												secretRef: {
													name: "tuner-postgres-credentials",
												},
											},
										],
										resources: {
											requests: {
												cpu: "250m",
												memory: "512Mi",
											},
											limits: {
												cpu: "1",
												memory: "2Gi",
											},
										},
										livenessProbe: {
											exec: {
												command: ["pg_isready", "-U", "postgres"],
											},
											initialDelaySeconds: 30,
											periodSeconds: 10,
										},
										readinessProbe: {
											exec: {
												command: ["pg_isready", "-U", "postgres"],
											},
											initialDelaySeconds: 5,
											periodSeconds: 5,
										},
										volumeMounts: [
											{
												name: "data",
												mountPath: "/var/lib/postgresql/data",
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
											storage: "10Gi",
										},
									},
								},
							},
						],
					},
				},
				{ provider: k8sProvider, dependsOn: [postgresSecret] },
			)
		: undefined;

/**
 * PostgreSQL service
 */
export const postgresService = k8sProvider
	? new k8s.core.v1.Service(
			"tuner-postgres",
			{
				metadata: {
					name: "tuner-postgres",
					namespace: namespaceName,
					labels: { ...commonLabels, ...postgresLabels },
				},
				spec: {
					type: "ClusterIP",
					ports: [
						{
							port: 5432,
							targetPort: 5432,
							protocol: "TCP",
							name: "postgres",
						},
					],
					selector: {
						"app.kubernetes.io/name": "tuner-postgres",
					},
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

// =============================================================================
// Tuner API Service
// =============================================================================

const tunerLabels = {
	"app.kubernetes.io/name": "tuner",
	"app.kubernetes.io/component": "service",
	"app.kubernetes.io/part-of": "engram",
};

/**
 * Tuner service configuration
 */
export const tunerConfigMap = k8sProvider
	? new k8s.core.v1.ConfigMap(
			"tuner-config",
			{
				metadata: {
					name: "tuner-config",
					namespace: namespaceName,
					labels: { ...commonLabels, ...tunerLabels },
				},
				data: {
					CORS_ORIGINS: '["http://localhost:3000","http://localhost:5173"]',
					WORKERS: "2",
					LOG_LEVEL: "info",
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Tuner secrets (database URL)
 */
export const tunerSecret = k8sProvider
	? new k8s.core.v1.Secret(
			"tuner-secrets",
			{
				metadata: {
					name: "tuner-secrets",
					namespace: namespaceName,
					labels: { ...commonLabels, ...tunerLabels },
				},
				type: "Opaque",
				stringData: {
					DATABASE_URL: pulumi.secret(
						process.env.TUNER_DATABASE_URL ||
							"postgresql://postgres:CHANGE_ME_IN_PRODUCTION@tuner-postgres.engram.svc.cluster.local:5432/optuna",
					),
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Tuner API Deployment
 */
export const tunerDeployment =
	k8sProvider && postgresStatefulSet && tunerConfigMap && tunerSecret
		? new k8s.apps.v1.Deployment(
				"tuner",
				{
					metadata: {
						name: "tuner",
						namespace: namespaceName,
						labels: { ...commonLabels, ...tunerLabels },
					},
					spec: {
						replicas: 2,
						selector: {
							matchLabels: { "app.kubernetes.io/name": "tuner" },
						},
						strategy: {
							type: "RollingUpdate",
							rollingUpdate: {
								maxSurge: 1,
								maxUnavailable: 0,
							},
						},
						template: {
							metadata: {
								labels: tunerLabels,
							},
							spec: {
								securityContext: {
									runAsNonRoot: true,
									runAsUser: 1000,
									fsGroup: 1000,
								},
								containers: [
									{
										name: "tuner",
										image: pulumi.interpolate`gcr.io/${gcpProject}/engram-tuner:v0.1.0`,
										imagePullPolicy: "IfNotPresent",
										ports: [
											{
												containerPort: 8000,
												name: "http",
												protocol: "TCP",
											},
										],
										envFrom: [
											{ configMapRef: { name: "tuner-config" } },
											{ secretRef: { name: "tuner-secrets" } },
										],
										resources: {
											requests: {
												cpu: "250m",
												memory: "512Mi",
											},
											limits: {
												cpu: "1",
												memory: "1Gi",
											},
										},
										livenessProbe: {
											httpGet: {
												path: "/api/v1/health",
												port: "http",
											},
											initialDelaySeconds: 10,
											periodSeconds: 15,
											timeoutSeconds: 5,
											failureThreshold: 3,
										},
										readinessProbe: {
											httpGet: {
												path: "/api/v1/health",
												port: "http",
											},
											initialDelaySeconds: 5,
											periodSeconds: 10,
											timeoutSeconds: 3,
											failureThreshold: 3,
										},
										startupProbe: {
											httpGet: {
												path: "/api/v1/health",
												port: "http",
											},
											initialDelaySeconds: 5,
											periodSeconds: 5,
											failureThreshold: 30,
										},
										securityContext: {
											allowPrivilegeEscalation: false,
											readOnlyRootFilesystem: true,
											capabilities: {
												drop: ["ALL"],
											},
										},
										volumeMounts: [
											{
												name: "tmp",
												mountPath: "/tmp",
											},
										],
									},
								],
								volumes: [
									{
										name: "tmp",
										emptyDir: {},
									},
								],
								topologySpreadConstraints: [
									{
										maxSkew: 1,
										topologyKey: "kubernetes.io/hostname",
										whenUnsatisfiable: "ScheduleAnyway",
										labelSelector: {
											matchLabels: { "app.kubernetes.io/name": "tuner" },
										},
									},
								],
							},
						},
					},
				},
				{ provider: k8sProvider, dependsOn: [postgresStatefulSet, tunerConfigMap, tunerSecret] },
			)
		: undefined;

/**
 * Tuner API Service
 */
export const tunerService = k8sProvider
	? new k8s.core.v1.Service(
			"tuner",
			{
				metadata: {
					name: "tuner",
					namespace: namespaceName,
					labels: { ...commonLabels, ...tunerLabels },
				},
				spec: {
					type: "ClusterIP",
					ports: [
						{
							port: 8000,
							targetPort: "http",
							protocol: "TCP",
							name: "http",
						},
					],
					selector: {
						"app.kubernetes.io/name": "tuner",
					},
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Pod Disruption Budget for Tuner
 */
export const tunerPdb = k8sProvider
	? new k8s.policy.v1.PodDisruptionBudget(
			"tuner-pdb",
			{
				metadata: {
					name: "tuner-pdb",
					namespace: namespaceName,
					labels: { ...commonLabels, ...tunerLabels },
				},
				spec: {
					minAvailable: 1,
					selector: {
						matchLabels: { "app.kubernetes.io/name": "tuner" },
					},
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

// =============================================================================
// Optuna Dashboard
// =============================================================================

const dashboardLabels = {
	"app.kubernetes.io/name": "tuner-dashboard",
	"app.kubernetes.io/component": "dashboard",
	"app.kubernetes.io/part-of": "engram",
};

/**
 * Optuna Dashboard Deployment
 */
export const dashboardDeployment =
	k8sProvider && postgresStatefulSet
		? new k8s.apps.v1.Deployment(
				"tuner-dashboard",
				{
					metadata: {
						name: "tuner-dashboard",
						namespace: namespaceName,
						labels: { ...commonLabels, ...dashboardLabels },
					},
					spec: {
						replicas: 1,
						selector: {
							matchLabels: { "app.kubernetes.io/name": "tuner-dashboard" },
						},
						template: {
							metadata: {
								labels: dashboardLabels,
							},
							spec: {
								containers: [
									{
										name: "dashboard",
										image: "ghcr.io/optuna/optuna-dashboard:v0.17.0",
										env: [
											{
												name: "POSTGRES_USER",
												valueFrom: {
													secretKeyRef: {
														name: "tuner-postgres-credentials",
														key: "POSTGRES_USER",
													},
												},
											},
											{
												name: "POSTGRES_PASSWORD",
												valueFrom: {
													secretKeyRef: {
														name: "tuner-postgres-credentials",
														key: "POSTGRES_PASSWORD",
													},
												},
											},
										],
										command: ["/bin/sh"],
										args: [
											"-c",
											`optuna-dashboard "postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@tuner-postgres.engram.svc.cluster.local:5432/optuna"`,
										],
										ports: [
											{
												containerPort: 8080,
												name: "http",
												protocol: "TCP",
											},
										],
										resources: {
											requests: {
												cpu: "100m",
												memory: "256Mi",
											},
											limits: {
												cpu: "500m",
												memory: "512Mi",
											},
										},
										livenessProbe: {
											httpGet: {
												path: "/",
												port: "http",
											},
											initialDelaySeconds: 10,
											periodSeconds: 30,
										},
										readinessProbe: {
											httpGet: {
												path: "/",
												port: "http",
											},
											initialDelaySeconds: 5,
											periodSeconds: 10,
										},
									},
								],
							},
						},
					},
				},
				{ provider: k8sProvider, dependsOn: [postgresStatefulSet] },
			)
		: undefined;

/**
 * Optuna Dashboard Service
 */
export const dashboardService = k8sProvider
	? new k8s.core.v1.Service(
			"tuner-dashboard",
			{
				metadata: {
					name: "tuner-dashboard",
					namespace: namespaceName,
					labels: { ...commonLabels, ...dashboardLabels },
				},
				spec: {
					type: "ClusterIP",
					ports: [
						{
							port: 8080,
							targetPort: "http",
							protocol: "TCP",
							name: "http",
						},
					],
					selector: {
						"app.kubernetes.io/name": "tuner-dashboard",
					},
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

// =============================================================================
// Exports
// =============================================================================

export const tunerEndpoint = "http://tuner.engram.svc.cluster.local:8000";
export const dashboardEndpoint = "http://tuner-dashboard.engram.svc.cluster.local:8080";
export const postgresEndpoint = pulumi
	.secret(process.env.TUNER_POSTGRES_USER || "postgres")
	.apply((user) => `postgresql://${user}:***@tuner-postgres.engram.svc.cluster.local:5432/optuna`);
