#!/bin/bash
# =============================================================================
# Engram Benchmark Runner for HF Spaces
# =============================================================================
# Starts Qdrant and runs the benchmark, serving status on port 7860
# =============================================================================

set -euo pipefail

echo "=== Engram Benchmark Runner ==="
echo "Starting at $(date)"

# Create Qdrant config
mkdir -p /app/qdrant-storage
cat > /app/qdrant-config.yaml << 'EOF'
storage:
  storage_path: /app/qdrant-storage
service:
  http_port: 6333
  grpc_port: 6334
telemetry_disabled: true
EOF

# Start Qdrant in background
echo "Starting Qdrant..."
/usr/local/bin/qdrant --config-path /app/qdrant-config.yaml &
QDRANT_PID=$!

# Wait for Qdrant to be ready
echo "Waiting for Qdrant..."
for i in {1..30}; do
  if curl -s http://localhost:6333/readyz > /dev/null 2>&1; then
    echo "Qdrant is ready!"
    break
  fi
  sleep 2
done

# Check if benchmark dataset exists, if not download from HF
if [ ! -f /data/longmemeval_oracle.json ]; then
  echo "Downloading benchmark dataset..."
  # Dataset should be uploaded to HF Datasets: engram/longmemeval
  # For now, check if mounted or provided
  if [ -f /app/data/longmemeval_oracle.json ]; then
    cp /app/data/longmemeval_oracle.json /data/
  else
    echo "WARNING: No dataset found. Upload longmemeval_oracle.json to /data"
  fi
fi

# Create a simple status server using Node.js
cat > /app/server.js << 'SERVEREOF'
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");

let status = "idle";
let output = [];
let benchmarkProcess = null;

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health" || req.url === "/") {
    res.end(JSON.stringify({ status: "ok", benchmark: status }));
  } else if (req.url === "/start" && req.method === "POST") {
    if (status === "running") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Benchmark already running" }));
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

    benchmarkProcess = spawn("npx", args, { cwd: "/app" });

    benchmarkProcess.stdout.on("data", (data) => {
      const line = data.toString();
      output.push(line);
      console.log(line);
    });

    benchmarkProcess.stderr.on("data", (data) => {
      const line = data.toString();
      output.push(line);
      console.error(line);
    });

    benchmarkProcess.on("close", (code) => {
      status = code === 0 ? "completed" : "failed";
      console.log(`Benchmark finished with code ${code}`);
    });

    res.end(JSON.stringify({ status: "started" }));
  } else if (req.url === "/status") {
    res.end(JSON.stringify({
      status,
      output: output.slice(-100).join(""),
      resultsExist: fs.existsSync("/results/benchmark-results.jsonl")
    }));
  } else if (req.url === "/results" && status === "completed") {
    if (fs.existsSync("/results/benchmark-results.jsonl")) {
      res.setHeader("Content-Type", "application/jsonl");
      fs.createReadStream("/results/benchmark-results.jsonl").pipe(res);
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Results not found" }));
    }
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(7860, "0.0.0.0", () => {
  console.log("Benchmark server running on http://0.0.0.0:7860");
  console.log("Endpoints:");
  console.log("  GET  /        - Health check");
  console.log("  POST /start   - Start benchmark");
  console.log("  GET  /status  - Get benchmark status");
  console.log("  GET  /results - Download results (when complete)");
});
SERVEREOF

echo "Starting benchmark server..."
node /app/server.js
