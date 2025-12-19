#!/bin/bash
# =============================================================================
# Deploy Engram Benchmark to Hugging Face Spaces
# =============================================================================
# Prerequisites:
#   - huggingface-cli installed: pip install huggingface_hub
#   - Logged in: huggingface-cli login
#   - HF_TOKEN environment variable set (for programmatic access)
#
# Usage:
#   ./deploy.sh                    # Deploy to ccheney/engram-benchmark
#   ./deploy.sh myorg/myspace      # Deploy to custom space
# =============================================================================

set -euo pipefail

SPACE_NAME="${1:-ccheney/engram-benchmark}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "=== Deploying Engram Benchmark to HF Spaces ==="
echo "Space: $SPACE_NAME"
echo "Repo root: $REPO_ROOT"
echo ""

# Check if hf CLI is installed
if ! command -v hf &> /dev/null; then
    echo "Error: hf CLI not found"
    echo "Install with: pip install huggingface_hub[cli]"
    exit 1
fi

# Create temp directory for deployment
DEPLOY_DIR=$(mktemp -d)
trap "rm -rf $DEPLOY_DIR" EXIT

echo "Preparing deployment in $DEPLOY_DIR..."

# Copy HF Space files
cp "$SCRIPT_DIR/Dockerfile" "$DEPLOY_DIR/"
cp "$SCRIPT_DIR/README.md" "$DEPLOY_DIR/"
cp "$SCRIPT_DIR/run.sh" "$DEPLOY_DIR/"

# Copy monorepo files needed for Docker build
cp "$REPO_ROOT/package.json" "$DEPLOY_DIR/"
cp "$REPO_ROOT/package-lock.json" "$DEPLOY_DIR/" 2>/dev/null || true
cp "$REPO_ROOT/biome.json" "$DEPLOY_DIR/"

# Copy packages (only what's needed)
mkdir -p "$DEPLOY_DIR/packages"
for pkg in benchmark search graph storage logger common temporal; do
    if [ -d "$REPO_ROOT/packages/$pkg" ]; then
        echo "  Copying packages/$pkg..."
        cp -r "$REPO_ROOT/packages/$pkg" "$DEPLOY_DIR/packages/"
    fi
done

# Remove node_modules and build artifacts to reduce size
find "$DEPLOY_DIR" -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find "$DEPLOY_DIR" -name ".turbo" -type d -exec rm -rf {} + 2>/dev/null || true
find "$DEPLOY_DIR" -name "*.tsbuildinfo" -delete 2>/dev/null || true

# Copy benchmark dataset if available
if [ -f "$REPO_ROOT/packages/benchmark/data/longmemeval_oracle.json" ]; then
    mkdir -p "$DEPLOY_DIR/packages/benchmark/data"
    echo "  Copying benchmark dataset..."
    cp "$REPO_ROOT/packages/benchmark/data/longmemeval_oracle.json" "$DEPLOY_DIR/packages/benchmark/data/"
fi

echo ""
echo "Deployment directory prepared. Contents:"
ls -la "$DEPLOY_DIR"
echo ""

# Create or update the Space
echo "Pushing to Hugging Face Spaces..."
cd "$DEPLOY_DIR"

# Initialize git if needed
git init -q
git add -A
git commit -q -m "Deploy Engram Benchmark"

# Push to HF Spaces
hf upload "$SPACE_NAME" . . --repo-type space

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Space URL: https://huggingface.co/spaces/$SPACE_NAME"
echo ""
echo "Next steps:"
echo "  1. Go to Space settings and set GOOGLE_GENERATIVE_AI_API_KEY secret"
echo "  2. Select L4 GPU hardware (\$0.80/hr)"
echo "  3. Wait for build to complete"
echo "  4. POST to /start to run benchmark"
echo ""
