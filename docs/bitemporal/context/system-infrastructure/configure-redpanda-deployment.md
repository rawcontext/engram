# Bead: Configure Redpanda Deployment (Local/GCP)

## Context
**Redpanda** is our event bus.
-   **Local**: `docker-compose`.
-   **GCP**: GKE Autopilot StatefulSet (or Redpanda Cloud BYOC). We will document the GKE StatefulSet approach for strict "GCP native" compliance.

## Goal
Provide configuration for running Redpanda in both environments.

## Local (docker-compose.yml snippet)
```yaml
redpanda:
  image: docker.redpanda.com/redpandadata/redpanda:v23.3.1
  command:
    - redpanda start
    - --smp 1
    - --memory 1G
    - --reserve-memory 0M
    - --overprovisioned
    - --node-id 0
    - --check=false
  ports:
    - 18081:8081
    - 9092:9092
  volumes:
    - redpanda-data:/var/lib/redpanda/data
```

## GCP (Kubernetes Manifest - StatefulSet)
*Note: Use the official Redpanda Helm Chart for production.*

```bash
helm repo add redpanda https://charts.redpanda.com
helm install redpanda redpanda/redpanda \
  --namespace soul-infra \
  --create-namespace \
  --set statefulset.replicas=3 \
  --set storage.persistentVolume.enabled=true \
  --set storage.persistentVolume.size=100Gi \
  --set resources.cpu.cores=2 \
  --set resources.memory.container.max=4Gi
```

## Acceptance Criteria
-   [ ] Local Redpanda starts via `docker-compose up`.
-   [ ] Helm chart configuration verified against GKE Autopilot requirements.

```