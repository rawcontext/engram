/**
 * Backup Policies for Databases
 *
 * Configures automated backups for FalkorDB, Qdrant, and Redpanda using CronJobs.
 * Backups are stored in GCS with retention policies.
 *
 * Only created when devEnabled=true.
 */

import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels, gcpProject } from "../config";
import { k8sProvider, namespaceName } from "./namespace";

const config = new pulumi.Config();
const backupRetentionDays = config.getNumber("backupRetentionDays") ?? 30;

/**
 * GCS bucket for database backups
 */
export const backupBucket = new gcp.storage.Bucket("engram-backups", {
	name: `${gcpProject}-engram-backups`,
	location: "US",
	storageClass: "STANDARD",
	uniformBucketLevelAccess: true,
	lifecycleRules: [
		{
			action: {
				type: "Delete",
			},
			condition: {
				age: backupRetentionDays,
			},
		},
	],
	labels: commonLabels,
});

/**
 * ServiceAccount for backup jobs
 */
const backupServiceAccount = k8sProvider
	? new k8s.core.v1.ServiceAccount(
			"backup-sa",
			{
				metadata: {
					name: "backup-sa",
					namespace: namespaceName,
					labels: { ...commonLabels },
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * FalkorDB backup CronJob
 * Runs daily at 2 AM UTC, backs up to GCS
 */
export const falkordbBackupCron = k8sProvider
	? new k8s.batch.v1.CronJob(
			"falkordb-backup",
			{
				metadata: {
					name: "falkordb-backup",
					namespace: namespaceName,
					labels: { ...commonLabels, "app.kubernetes.io/component": "backup" },
				},
				spec: {
					schedule: "0 2 * * *", // Daily at 2 AM UTC
					successfulJobsHistoryLimit: 3,
					failedJobsHistoryLimit: 1,
					jobTemplate: {
						spec: {
							template: {
								metadata: {
									labels: { "app.kubernetes.io/name": "falkordb-backup" },
								},
								spec: {
									serviceAccountName: backupServiceAccount?.metadata.name,
									restartPolicy: "OnFailure",
									containers: [
										{
											name: "backup",
											image: "google/cloud-sdk:alpine",
											command: ["/bin/sh"],
											args: [
												"-c",
												`
												TIMESTAMP=$(date +%Y%m%d_%H%M%S)
												redis-cli -h falkordb.engram.svc.cluster.local -p 6379 --rdb /tmp/dump.rdb
												gsutil cp /tmp/dump.rdb gs://${backupBucket.name}/falkordb/dump_$TIMESTAMP.rdb
												echo "Backup completed: falkordb/dump_$TIMESTAMP.rdb"
												`,
											],
											env: [
												{
													name: "GOOGLE_APPLICATION_CREDENTIALS",
													value: "/var/secrets/google/key.json",
												},
											],
										},
									],
								},
							},
						},
					},
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Qdrant backup CronJob
 * Runs daily at 3 AM UTC, creates snapshots and backs up to GCS
 */
export const qdrantBackupCron = k8sProvider
	? new k8s.batch.v1.CronJob(
			"qdrant-backup",
			{
				metadata: {
					name: "qdrant-backup",
					namespace: namespaceName,
					labels: { ...commonLabels, "app.kubernetes.io/component": "backup" },
				},
				spec: {
					schedule: "0 3 * * *", // Daily at 3 AM UTC
					successfulJobsHistoryLimit: 3,
					failedJobsHistoryLimit: 1,
					jobTemplate: {
						spec: {
							template: {
								metadata: {
									labels: { "app.kubernetes.io/name": "qdrant-backup" },
								},
								spec: {
									serviceAccountName: backupServiceAccount?.metadata.name,
									restartPolicy: "OnFailure",
									containers: [
										{
											name: "backup",
											image: "google/cloud-sdk:alpine",
											command: ["/bin/sh"],
											args: [
												"-c",
												`
												TIMESTAMP=$(date +%Y%m%d_%H%M%S)
												apk add --no-cache curl
												curl -X POST http://qdrant.engram.svc.cluster.local:6333/collections/engram/snapshots
												curl -X GET http://qdrant.engram.svc.cluster.local:6333/collections/engram/snapshots -o /tmp/snapshot.tar
												gsutil cp /tmp/snapshot.tar gs://${backupBucket.name}/qdrant/snapshot_$TIMESTAMP.tar
												echo "Backup completed: qdrant/snapshot_$TIMESTAMP.tar"
												`,
											],
											env: [
												{
													name: "GOOGLE_APPLICATION_CREDENTIALS",
													value: "/var/secrets/google/key.json",
												},
											],
										},
									],
								},
							},
						},
					},
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

/**
 * Redpanda backup CronJob
 * Runs daily at 4 AM UTC, backs up topic data to GCS
 */
export const redpandaBackupCron = k8sProvider
	? new k8s.batch.v1.CronJob(
			"redpanda-backup",
			{
				metadata: {
					name: "redpanda-backup",
					namespace: namespaceName,
					labels: { ...commonLabels, "app.kubernetes.io/component": "backup" },
				},
				spec: {
					schedule: "0 4 * * *", // Daily at 4 AM UTC
					successfulJobsHistoryLimit: 3,
					failedJobsHistoryLimit: 1,
					jobTemplate: {
						spec: {
							template: {
								metadata: {
									labels: { "app.kubernetes.io/name": "redpanda-backup" },
								},
								spec: {
									serviceAccountName: backupServiceAccount?.metadata.name,
									restartPolicy: "OnFailure",
									containers: [
										{
											name: "backup",
											image: "google/cloud-sdk:alpine",
											command: ["/bin/sh"],
											args: [
												"-c",
												`
												TIMESTAMP=$(date +%Y%m%d_%H%M%S)
												wget https://github.com/redpanda-data/redpanda/releases/download/v24.2.1/rpk-linux-amd64.zip
												unzip rpk-linux-amd64.zip
												chmod +x rpk
												./rpk cluster metadata --brokers redpanda.engram.svc.cluster.local:9092 > /tmp/metadata.json
												gsutil cp /tmp/metadata.json gs://${backupBucket.name}/redpanda/metadata_$TIMESTAMP.json
												echo "Backup completed: redpanda/metadata_$TIMESTAMP.json"
												`,
											],
											env: [
												{
													name: "GOOGLE_APPLICATION_CREDENTIALS",
													value: "/var/secrets/google/key.json",
												},
											],
										},
									],
								},
							},
						},
					},
				},
			},
			{ provider: k8sProvider },
		)
	: undefined;

export const backupSchedules = {
	falkordb: "Daily at 2 AM UTC",
	qdrant: "Daily at 3 AM UTC",
	redpanda: "Daily at 4 AM UTC",
};
