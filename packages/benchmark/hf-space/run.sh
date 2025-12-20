#!/bin/bash
# =============================================================================
# Engram Benchmark Runner for HF Spaces
# =============================================================================
# Starts FalkorDB, Qdrant and runs the benchmark, serving status on port 7860
# Full Engram stack: FalkorDB (graph) + Qdrant (vectors)
# =============================================================================

set -euo pipefail

echo "=== Engram Benchmark Runner ==="
echo "Starting at $(date)"

# -----------------------------------------------------------------------------
# Start FalkorDB (Redis + FalkorDB module)
# -----------------------------------------------------------------------------
echo "Starting FalkorDB..."
mkdir -p /app/falkordb-data

# FalkorDB module path
FALKORDB_MODULE="/opt/falkordb/falkordb.so"
if [ ! -f "$FALKORDB_MODULE" ]; then
  echo "ERROR: FalkorDB module not found at $FALKORDB_MODULE"
  exit 1
fi

# Start Redis with FalkorDB module
echo "Starting redis-server with FalkorDB module..."
redis-server --daemonize yes \
  --port 6379 \
  --bind 127.0.0.1 \
  --dir /app/falkordb-data \
  --loadmodule "$FALKORDB_MODULE" \
  --loglevel verbose \
  --logfile /app/redis.log \
  --save "" \
  --appendonly no

# Check if redis started
sleep 2
if [ -f /app/redis.log ]; then
  echo "Redis log (first 20 lines):"
  head -20 /app/redis.log
fi

# Wait for FalkorDB to be ready
echo "Waiting for FalkorDB..."
FALKOR_READY=0
for i in $(seq 1 30); do
  if redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -q PONG; then
    echo "FalkorDB is ready!"
    redis-cli -h 127.0.0.1 MODULE LIST
    FALKOR_READY=1
    break
  fi
  echo "  Attempt $i: waiting..."
  sleep 1
done

if [ "$FALKOR_READY" -eq 0 ]; then
  echo "ERROR: FalkorDB failed to start!"
  echo "Redis log:"
  cat /app/redis.log 2>/dev/null || echo "No log file"
  echo "Checking redis process:"
  ps aux | grep redis || echo "No redis process"
  exit 1
fi

# -----------------------------------------------------------------------------
# Start Qdrant
# -----------------------------------------------------------------------------
echo "Starting Qdrant..."
mkdir -p /app/qdrant-storage
cat > /app/qdrant-config.yaml << 'EOF'
storage:
  storage_path: /app/qdrant-storage
service:
  http_port: 6333
  grpc_port: 6334
telemetry_disabled: true
EOF

/usr/local/bin/qdrant --config-path /app/qdrant-config.yaml &
QDRANT_PID=$!

echo "Waiting for Qdrant..."
for i in {1..30}; do
  if curl -s http://localhost:6333/readyz > /dev/null 2>&1; then
    echo "Qdrant is ready!"
    break
  fi
  sleep 2
done

# -----------------------------------------------------------------------------
# Check/Download Dataset
# -----------------------------------------------------------------------------
if [ ! -f /data/longmemeval_oracle.json ]; then
  echo "Checking for benchmark dataset..."
  if [ -f /app/packages/benchmark/data/longmemeval_oracle.json ]; then
    cp /app/packages/benchmark/data/longmemeval_oracle.json /data/
    echo "Dataset copied from app bundle"
  else
    echo "WARNING: No dataset found at /data/longmemeval_oracle.json"
    echo "Upload dataset or include in packages/benchmark/data/"
  fi
fi

# -----------------------------------------------------------------------------
# Create Server with Ingest + Benchmark APIs
# -----------------------------------------------------------------------------
cat > /app/server.js << 'SERVEREOF'
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");

let status = "idle";
let ingestStatus = "not_started";
let output = [];
let currentProcess = null;

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Health check
  if (req.url === "/health" || req.url === "/") {
    res.end(JSON.stringify({
      status: "ok",
      benchmark: status,
      ingest: ingestStatus,
      falkordb: "redis://localhost:6379",
      qdrant: "http://localhost:6333"
    }));
    return;
  }

  // Ingest data into FalkorDB
  if (req.url === "/ingest" && req.method === "POST") {
    if (ingestStatus === "running") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Ingest already running" }));
      return;
    }

    ingestStatus = "running";
    output = [];

    // Run ingest script
    const args = [
      "tsx", "packages/benchmark/src/cli/index.ts",
      "ingest",
      "--dataset", "/data/longmemeval_oracle.json",
      "--falkor-url", "redis://localhost:6379",
      "--qdrant-url", "http://localhost:6333",
      "--verbose"
    ];

    currentProcess = spawn("npx", args, { cwd: "/app" });

    currentProcess.stdout.on("data", (data) => {
      const line = data.toString();
      output.push(line);
      console.log("[ingest]", line);
    });

    currentProcess.stderr.on("data", (data) => {
      const line = data.toString();
      output.push(line);
      console.error("[ingest]", line);
    });

    currentProcess.on("close", (code) => {
      ingestStatus = code === 0 ? "completed" : "failed";
      console.log(`Ingest finished with code ${code}`);
      currentProcess = null;
    });

    res.end(JSON.stringify({ status: "ingest_started" }));
    return;
  }

  // Start benchmark
  if (req.url === "/start" && req.method === "POST") {
    if (status === "running") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Benchmark already running" }));
      return;
    }

    if (ingestStatus !== "completed") {
      res.statusCode = 400;
      res.end(JSON.stringify({
        error: "Data not ingested. POST /ingest first.",
        ingestStatus
      }));
      return;
    }

    status = "running";
    output = [];

    const args = [
      "tsx", "packages/benchmark/src/cli/index.ts",
      "run", "longmemeval",
      "--dataset", "/data/longmemeval_oracle.json",
      "--variant", "oracle",
      "--embeddings", "engram",
      "--llm", "gemini",
      "--gemini-model", "gemini-2.5-flash-preview-05-20",
      "--falkor-url", "redis://localhost:6379",
      "--qdrant-url", "http://localhost:6333",
      "--top-k", "10",
      "--hybrid-search",
      "--rerank",
      "--rerank-tier", "accurate",
      "--rerank-depth", "50",
      "--multi-query",
      "--session-aware",
      "--temporal-aware",
      "--abstention",
      "--abstention-hedging",
      "--abstention-nli",
      "--key-expansion",
      "--temporal-analysis",
      "--chain-of-note",
      "--time-aware",
      "--embedding-model", "e5-large",
      "--verbose",
      "--output", "/results/benchmark-results.jsonl"
    ];

    currentProcess = spawn("npx", args, { cwd: "/app" });

    currentProcess.stdout.on("data", (data) => {
      const line = data.toString();
      output.push(line);
      console.log("[benchmark]", line);
    });

    currentProcess.stderr.on("data", (data) => {
      const line = data.toString();
      output.push(line);
      console.error("[benchmark]", line);
    });

    currentProcess.on("close", (code) => {
      status = code === 0 ? "completed" : "failed";
      console.log(`Benchmark finished with code ${code}`);
      currentProcess = null;
    });

    res.end(JSON.stringify({ status: "started" }));
    return;
  }

  // Get status
  if (req.url === "/status") {
    res.end(JSON.stringify({
      benchmark: status,
      ingest: ingestStatus,
      output: output.slice(-100).join(""),
      resultsExist: fs.existsSync("/results/benchmark-results.jsonl")
    }));
    return;
  }

  // Download results
  if (req.url === "/results" && status === "completed") {
    if (fs.existsSync("/results/benchmark-results.jsonl")) {
      res.setHeader("Content-Type", "application/jsonl");
      fs.createReadStream("/results/benchmark-results.jsonl").pipe(res);
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Results not found" }));
    return;
  }

  // 404
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(7860, "0.0.0.0", () => {
  console.log("Engram Benchmark Server running on http://0.0.0.0:7860");
  console.log("");
  console.log("API Endpoints:");
  console.log("  GET  /         - Health check");
  console.log("  POST /ingest   - Ingest dataset into FalkorDB + Qdrant");
  console.log("  POST /start    - Start benchmark (requires ingest first)");
  console.log("  GET  /status   - Get current status");
  console.log("  GET  /results  - Download results (when complete)");
  console.log("");
  console.log("Workflow:");
  console.log("  1. POST /ingest  - Load data into graph + vectors");
  console.log("  2. POST /start   - Run benchmark with full Engram pipeline");
  console.log("  3. GET /results  - Download results");
});
SERVEREOF

echo "Starting benchmark server..."
node /app/server.js
