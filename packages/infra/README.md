# @engram/infra

Infrastructure-as-Code using Pulumi for GCP deployment.

## Overview

Declarative infrastructure setup for production deployment on Google Cloud Platform. Manages Kubernetes clusters, Cloud Run services, and all necessary backing services.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
- GCP project with billing enabled

## Setup

```bash
# Login to Pulumi
pulumi login

# Login to GCP
gcloud auth application-default login

# Select stack
pulumi stack select dev
```

## Deployment

```bash
# Preview changes
pulumi preview

# Deploy infrastructure
pulumi up

# Destroy infrastructure
pulumi destroy
```

## Infrastructure Components

### GKE Cluster

Managed Kubernetes cluster for running Engram services.

```typescript
// Configured in src/gke/
- Node pools with autoscaling
- Network policies
- Workload identity
```

### Kubernetes Workloads

| Service | Type | Description |
|:--------|:-----|:------------|
| FalkorDB | StatefulSet | Graph database |
| Qdrant | StatefulSet | Vector database |
| Redpanda | StatefulSet | Message queue |
| Dashboard | Deployment | Optuna dashboard |
| Tuner | Deployment | Tuner service |

### Cloud Run

Serverless containers for batch workloads.

```typescript
// Configured in src/cloudrun/
- Benchmark jobs
- Batch processing
```

### Networking

- VPC with private subnets
- Cloud NAT for egress
- Internal load balancing
- Firewall rules

## Configuration

### Stack Configuration

```yaml
# Pulumi.dev.yaml
config:
  gcp:project: your-project-id
  gcp:region: us-central1
  engram:environment: dev
```

### Secrets

```bash
# Set secrets
pulumi config set --secret database-password "..."
```

## Stacks

| Stack | Purpose |
|:------|:--------|
| `dev` | Development environment |
| `staging` | Pre-production testing |
| `prod` | Production environment |

## Outputs

After deployment, access outputs:

```bash
# Get all outputs
pulumi stack output

# Get specific output
pulumi stack output kubeconfig --show-secrets
```

## Directory Structure

```
packages/infra/
├── src/
│   ├── index.ts        # Main entry point
│   ├── config.ts       # Configuration loading
│   ├── gke/            # GKE cluster setup
│   ├── k8s/            # Kubernetes resources
│   ├── cloudrun/       # Cloud Run services
│   └── networking/     # VPC and networking
├── Pulumi.yaml         # Project definition
└── Pulumi.dev.yaml     # Dev stack config
```
