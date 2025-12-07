# Bead: Configure Qdrant Deployment (Local/GCP)

## Context
**Qdrant** is the Vector Database.

## Goal
Deploy Qdrant locally and on GKE.

## Local (docker-compose.yml snippet)
```yaml
qdrant:
  image: qdrant/qdrant:latest
  ports:
    - 6333:6333
  volumes:
    - qdrant-data:/qdrant/storage
```

## GCP (Kubernetes Manifest)
Use the official Qdrant Helm Chart.

```bash
helm repo add qdrant https://qdrant.to/helm
helm install qdrant qdrant/qdrant \
  --namespace soul-infra \
  --set replicaCount=1 \
  --set persistence.enabled=true \
  --set persistence.size=50Gi
```

## Acceptance Criteria
-   [ ] Local Qdrant UI accessible at `http://localhost:6333/dashboard`.
-   [ ] GKE Helm install successful.

```