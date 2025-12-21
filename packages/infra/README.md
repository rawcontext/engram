# @engram/infra

Infrastructure-as-Code using Pulumi for GCP deployment.

## Overview

Manages Engram's production infrastructure on Google Cloud Platform, including a GKE Autopilot cluster, VPC networking, and Kubernetes workloads for databases, streaming, and services. All infrastructure is conditionally deployed based on the `devEnabled` configuration flag to control costs.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
- [gke-gcloud-auth-plugin](https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-access-for-kubectl#install_plugin)
- GCP project with billing enabled

## Setup

```bash
# Login to Pulumi
pulumi login

# Login to GCP
gcloud auth application-default login

# Select stack
pulumi stack select dev

# Install gke-gcloud-auth-plugin for kubectl
gcloud components install gke-gcloud-auth-plugin
```

## Deployment

### Quick Start

```bash
# From packages/infra directory
npm run preview    # Preview changes
npm run up         # Deploy infrastructure
npm run destroy    # Destroy infrastructure
```

### Cost Control

The infrastructure includes a master on/off switch for development environments:

```bash
# Turn on infrastructure (creates GKE cluster and all workloads)
npm run wake

# Turn off infrastructure (removes expensive resources)
npm run sleep

# Check current status
npm run status
```

Or manually:

```bash
pulumi config set devEnabled true   # Enable
pulumi config set devEnabled false  # Disable
pulumi up                           # Apply changes
```

When `devEnabled=false`, only inexpensive resources (VPC, NAT, GCS buckets, secrets) are created. GKE cluster and all Kubernetes workloads are skipped.

## Infrastructure Components

### Networking

**Module:** `src/network.ts`

- VPC network (`engram-network`) with manual subnet configuration
- Regional subnet with private Google access enabled
- Cloud Router for NAT gateway
- Cloud NAT for egress traffic from private GKE nodes
- Error-only logging for NAT gateway

**Exports:** `network`, `subnet`, `router`, `nat`

### GKE Autopilot Cluster

**Module:** `src/gke.ts`

- Fully-managed GKE Autopilot cluster
- Automatic node provisioning and scaling
- Vertical Pod Autoscaling enabled
- Regular release channel for automatic upgrades
- Deletion protection enabled for `prod` stack
- Conditionally created when `devEnabled=true`

**Exports:** `cluster`, `kubeconfig`

**Kubeconfig:** Generated dynamically using `gke-gcloud-auth-plugin` for authentication

### Secret Manager

**Module:** `src/secrets.ts`

- Google Generative AI API key (for Gemini-based reranking and query expansion)
- Automatic replication across regions
- Secrets created as containers only—values must be set manually:

```bash
echo -n "your-api-key" | gcloud secrets versions add google-generative-ai-api-key --data-file=-
```

**Exports:** `googleGenerativeAiApiKeySecret`

### Kubernetes Workloads

All workloads run in the `engram` namespace and are conditionally created when `devEnabled=true`.

**Module:** `src/k8s/`

#### FalkorDB (Graph Database)

**File:** `src/k8s/falkordb.ts`

- StatefulSet with Redis protocol compatibility
- Image: `falkordb/falkordb:v4.2.1`
- Storage: 50Gi persistent volume (`standard-rwo`)
- Replicas: 1 (dev), 3 (prod)
- Headless service for stable network identity
- Liveness/readiness probes via `redis-cli ping`

**Connection:** `redis://falkordb.engram.svc.cluster.local:6379`

#### Qdrant (Vector Database)

**File:** `src/k8s/qdrant.ts`

- Deployed via Helm chart (`qdrant/qdrant` v0.10.1)
- Image: `qdrant/qdrant:v1.12.1`
- Storage: 50Gi persistent volume
- Replicas: 1 (dev), 3 (prod)
- Clustering enabled for multi-replica deployments
- HTTP and gRPC endpoints

**Connections:**
- HTTP: `http://qdrant.engram.svc.cluster.local:6333`
- gRPC: `qdrant.engram.svc.cluster.local:6334`

#### Redpanda (Kafka-Compatible Streaming)

**File:** `src/k8s/redpanda.ts`

- Deployed via Helm chart (`redpanda/redpanda` v5.9.4)
- Image: `docker.redpanda.com/redpandadata/redpanda:v24.2.1`
- Storage: 50Gi persistent volume
- Replicas: 1 (dev), 3 (prod)
- Schema Registry enabled
- Internal-only access (no external listeners)

**Connections:**
- Kafka: `redpanda.engram.svc.cluster.local:9092`
- Schema Registry: `redpanda.engram.svc.cluster.local:8081`

#### Tuner Service (Hyperparameter Optimization)

**File:** `src/k8s/tuner.ts`

Complete Optuna-based hyperparameter tuning stack:

**PostgreSQL (Optuna Persistence):**
- StatefulSet running `postgres:17-alpine`
- Storage: 10Gi persistent volume
- Credentials configured via environment variables or secrets
- Connection: `postgresql://tuner-postgres.engram.svc.cluster.local:5432/optuna`

**Tuner API:**
- Deployment with 2 replicas
- Image: `gcr.io/{gcp-project}/engram-tuner:v0.1.0`
- FastAPI service with Optuna integration
- Rolling updates with zero downtime
- Topology spread for high availability
- Connection: `http://tuner.engram.svc.cluster.local:8000`

**Optuna Dashboard:**
- Deployment with 1 replica
- Image: `ghcr.io/optuna/optuna-dashboard:v0.17.0`
- Visualization interface for studies
- Connection: `http://tuner-dashboard.engram.svc.cluster.local:8080`

#### Automated Backups

**File:** `src/k8s/backups.ts`

- GCS bucket with 30-day retention policy (configurable)
- CronJobs for daily backups of all databases:
  - FalkorDB: 2 AM UTC (RDB dump)
  - Qdrant: 3 AM UTC (snapshots)
  - Redpanda: 4 AM UTC (metadata)
- Backups stored in `gs://{project}-engram-backups/`

**Exports:** `backupBucket`, `backupSchedules`

#### Network Policies

**File:** `src/k8s/network-policy.ts`

Implements least-privilege network segmentation:

- FalkorDB: Accessible only by memory, ingestion, mcp services and backup jobs
- Qdrant: Accessible only by search, memory services and backup jobs
- Redpanda: Accessible only by ingestion, memory services and backup jobs
- Default deny-all ingress policy for namespace

#### RBAC

**File:** `src/k8s/rbac.ts`

Service accounts with minimal required permissions:

- `memory-sa`: Access to ConfigMaps, Secrets, and Pods
- `ingestion-sa`: Access to ConfigMaps, Secrets, and Pods
- `search-sa`: Access to ConfigMaps, Secrets, and Pods
- `mcp-sa`: Access to ConfigMaps, Secrets, and Pods
- `backup-sa`: ClusterRole for accessing PVCs and storage

**Exports:** `memoryServiceAccount`, `ingestionServiceAccount`, `searchServiceAccount`, `mcpServiceAccount`

## Configuration

### Stack Configuration Files

**Pulumi.yaml** (Project definition):
```yaml
name: engram-infra
runtime:
  name: nodejs
  options:
    typescript: true
main: src/
description: Engram Infrastructure - GCP resources for services
```

**Pulumi.dev.yaml** (Stack-specific config):
```yaml
config:
  gcp:project: your-project-id
  gcp:region: us-central1
  engram-infra:devEnabled: "true"
```

### Configuration Options

**Module:** `src/config.ts`

| Config Key | Default | Description |
|------------|---------|-------------|
| `gcp:project` | *(required)* | GCP project ID |
| `gcp:region` | `us-central1` | GCP region for resources |
| `devEnabled` | `true` | Master switch for expensive resources (GKE, workloads) |
| `networkCidr` | `10.0.0.0/16` | VPC CIDR range |
| `backupRetentionDays` | `30` | GCS backup retention period |

**Environment-specific behavior:**
- `environment = prod`: 3 database replicas, deletion protection enabled
- `environment != prod`: 1 database replica, deletion protection disabled

### Tuner Secrets

Set via environment variables or Kubernetes secrets:

```bash
# PostgreSQL credentials (defaults shown)
TUNER_POSTGRES_USER=postgres
TUNER_POSTGRES_PASSWORD=CHANGE_ME_IN_PRODUCTION

# Database URL (auto-generated from above if not set)
TUNER_DATABASE_URL=postgresql://postgres:password@tuner-postgres.engram.svc.cluster.local:5432/optuna
```

## Outputs

Access deployed infrastructure details:

```bash
# Get all outputs
pulumi stack output

# Get kubeconfig for kubectl access
pulumi stack output kubeconfig --show-secrets > ~/.kube/engram-config
export KUBECONFIG=~/.kube/engram-config
kubectl get pods -n engram
```

**Available outputs:**
- `cluster`: GKE cluster resource
- `kubeconfig`: Kubectl configuration with gke-gcloud-auth-plugin
- `namespace`: Engram Kubernetes namespace
- `falkordbEndpoint`, `qdrantEndpoint`, `qdrantGrpcEndpoint`, `redpandaEndpoint`, `redpandaSchemaRegistryEndpoint`
- `tunerEndpoint`, `dashboardEndpoint`, `postgresEndpoint`
- `backupBucket`, `backupSchedules`
- Service accounts: `memoryServiceAccount`, `ingestionServiceAccount`, `searchServiceAccount`, `mcpServiceAccount`

## Directory Structure

```
packages/infra/
├── src/
│   ├── index.ts              # Main entry point, re-exports all resources
│   ├── config.ts             # Centralized configuration and devEnabled switch
│   ├── network.ts            # VPC, subnet, router, NAT
│   ├── gke.ts                # GKE Autopilot cluster
│   ├── secrets.ts            # Secret Manager secrets
│   ├── k8s/
│   │   ├── index.ts          # Kubernetes workload aggregator
│   │   ├── namespace.ts      # Engram namespace and K8s provider
│   │   ├── falkordb.ts       # FalkorDB StatefulSet
│   │   ├── qdrant.ts         # Qdrant Helm release
│   │   ├── redpanda.ts       # Redpanda Helm release
│   │   ├── tuner.ts          # Tuner stack (PostgreSQL, API, Dashboard)
│   │   ├── backups.ts        # GCS bucket and backup CronJobs
│   │   ├── rbac.ts           # Service accounts and role bindings
│   │   └── network-policy.ts # Network segmentation policies
│   └── testing.ts            # Test utilities
├── Pulumi.yaml               # Project definition
├── Pulumi.dev.yaml           # Dev stack configuration
├── package.json
└── README.md
```

## Dependencies

**From `package.json`:**

```json
{
  "dependencies": {
    "@pulumi/gcp": "^9.6.0",
    "@pulumi/kubernetes": "^4.24.1",
    "@pulumi/pulumi": "^3.213.0"
  }
}
```

## Common Tasks

### Accessing the Cluster

```bash
# Get kubeconfig
pulumi stack output kubeconfig --show-secrets > ~/.kube/engram-config
export KUBECONFIG=~/.kube/engram-config

# View pods
kubectl get pods -n engram

# Port-forward to services
kubectl port-forward -n engram svc/tuner-dashboard 8080:8080
kubectl port-forward -n engram svc/tuner 8000:8000
kubectl port-forward -n engram svc/qdrant 6333:6333
```

### Monitoring Backups

```bash
# List backup jobs
kubectl get cronjobs -n engram

# View backup job logs
kubectl logs -n engram -l app.kubernetes.io/component=backup

# List backups in GCS
gsutil ls gs://$(pulumi stack output backupBucket)/
```

### Updating Workloads

```bash
# Edit configuration
pulumi config set backupRetentionDays 60

# Preview changes
npm run preview

# Apply changes
npm run up
```
