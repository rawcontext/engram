# Bead: Define Secret Management (Secret Manager)

## Context
Applications need sensitive config (Database URLs, API Keys). GCP **Secret Manager** is the standard solution.

## Goal
Integrate Secret Manager with Cloud Run.

## Strategy
1.  **Storage**: Secrets are stored in GCP Secret Manager (e.g., `projects/$ID/secrets/openai-api-key`).
2.  **Access**: Cloud Run Service Identity (Service Account) is granted `roles/secretmanager.secretAccessor`.
3.  **Mounting**: Secrets are exposed as Environment Variables or Volume Mounts in Cloud Run.

## Configuration Example (Cloud Run YAML)
```yaml
apiVersion: serving.knative.dev/v1
kind: Service
spec:
  template:
    spec:
      containers:
        - image: ...
          env:
            - name: OPENAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: openai-api-key
                  key: latest
```

## Acceptance Criteria
-   [ ] List of required secrets identified (OPENAI_KEY, ANTHROPIC_KEY, DB_PASSWORDS).
-   [ ] Terraform config to create placeholders for these secrets.
-   [ ] Documentation on how to rotate secrets.
