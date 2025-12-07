# Bead: Define CI/CD Pipeline (Cloud Build)

## Context
We need a continuous integration and deployment pipeline. Since we are GCP native, **Google Cloud Build** is the natural choice.

## Goal
Create a `cloudbuild.yaml` that:
1.  Detects changes in specific Turborepo workspaces.
2.  Runs tests/lints.
3.  Builds Docker images.
4.  Pushes to Google Artifact Registry (GAR).
5.  Deploys to Cloud Run.

## Pipeline Config (`cloudbuild.yaml`)

```yaml
steps:
  # 1. Install dependencies
  - name: 'oven/bun:1'
    entrypoint: 'bun'
    args: ['install', '--frozen-lockfile']

  # 2. Lint & Test
  - name: 'oven/bun:1'
    entrypoint: 'bun'
    args: ['run', 'turbo', 'run', 'test', 'lint']

  # 3. Build & Push Ingestion Service (Conditional on change?)
  # In a real setup, we use triggers or a script to determine what to build.
  # Here is a generic step for Ingestion.
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'us-central1-docker.pkg.dev/$PROJECT_ID/soul-repo/ingestion:latest', '-f', 'docs/bitemporal/context/system-infrastructure/create-ingestion-service-dockerfile.md', '.']
  
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'us-central1-docker.pkg.dev/$PROJECT_ID/soul-repo/ingestion:latest']

  # 4. Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args: ['run', 'deploy', 'ingestion', '--image', 'us-central1-docker.pkg.dev/$PROJECT_ID/soul-repo/ingestion:latest', '--region', 'us-central1', '--platform', 'managed']

options:
  logging: CLOUD_LOGGING_ONLY
```

## Acceptance Criteria
-   [ ] `cloudbuild.yaml` created.
-   [ ] Artifact Registry repository `soul-repo` defined via Terraform.
-   [ ] Cloud Build triggers configured for `main` branch push.
