# Bead: Configure FalkorDB Deployment (Local/GCP)

## Context
**FalkorDB** is the Knowledge Graph store. It is a Redis module.

## Goal
Deploy FalkorDB locally and on GKE.

## Local (docker-compose.yml snippet)
```yaml
falkordb:
  image: falkordb/falkordb:latest
  ports:
    - 6379:6379
  volumes:
    - falkor-data:/data
```

## GCP (Kubernetes Manifest)
Use a standard Redis deployment with the FalkorDB module loaded.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: falkordb
spec:
  serviceName: "falkordb"
  replicas: 1 # Start with 1 for simplicity, handle HA later
  selector:
    matchLabels:
      app: falkordb
  template:
    metadata:
      labels:
        app: falkordb
    spec:
      containers:
      - name: falkordb
        image: falkordb/falkordb:latest
        ports:
        - containerPort: 6379
          name: redis
        volumeMounts:
        - name: data
          mountPath: /data
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 50Gi
```

## Acceptance Criteria
-   [ ] Local FalkorDB accepts Graph queries (`GRAPH.QUERY`).
-   [ ] GKE manifest applies successfully.
