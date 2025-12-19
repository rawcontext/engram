#!/bin/bash
# Real-world integration test for the ingestion API
# Captures Claude Code stream-json output and sends to ingestion API

set -e

INGESTION_URL="http://localhost:5001"
SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
OUTPUT_FILE="/tmp/claude-stream-$SESSION_ID.jsonl"
PROMPT="${1:-Read the package.json file and tell me the project name}"

echo "=== Claude Code Ingestion Integration Test ==="
echo ""
echo "Session ID: $SESSION_ID"
echo "Ingestion URL: $INGESTION_URL"
echo "Prompt: \"$PROMPT\""
echo ""

# Run Claude and capture stream-json output
echo "Running Claude Code in headless mode..."
claude -p "$PROMPT" \
  --output-format stream-json \
  --verbose \
  --max-turns 1 \
  --allowedTools "Read,Glob" \
  > "$OUTPUT_FILE" 2>&1

echo "Captured $(wc -l < "$OUTPUT_FILE" | tr -d ' ') events to $OUTPUT_FILE"
echo ""

# Process each line and send to ingestion
echo "Sending events to ingestion API..."
EVENT_COUNT=0
SUCCESS_COUNT=0

while IFS= read -r line; do
  if [ -z "$line" ]; then
    continue
  fi

  # Check if line is valid JSON
  if ! echo "$line" | jq -e . >/dev/null 2>&1; then
    echo "  Skipping non-JSON line"
    continue
  fi

  EVENT_TYPE=$(echo "$line" | jq -r '.type // "unknown"')
  EVENT_UUID=$(echo "$line" | jq -r '.uuid // empty')

  if [ -z "$EVENT_UUID" ]; then
    EVENT_UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
  fi

  # Create RawStreamEvent wrapper
  # Use "claude_code" provider for Claude Code stream-json format
  RAW_EVENT=$(jq -n \
    --arg event_id "$EVENT_UUID" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg session_id "$SESSION_ID" \
    --arg cwd "$(pwd)" \
    --argjson payload "$line" \
    '{
      event_id: $event_id,
      ingest_timestamp: $timestamp,
      provider: "claude_code",
      payload: $payload,
      headers: {
        "x-session-id": $session_id,
        "x-working-dir": $cwd,
        "x-git-remote": "github.com/engram-labs/engram",
        "x-agent-type": "claude-code"
      }
    }')

  # Send to ingestion
  RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null -X POST "$INGESTION_URL/ingest" \
    -H "Content-Type: application/json" \
    -d "$RAW_EVENT")

  EVENT_COUNT=$((EVENT_COUNT + 1))

  if [ "$RESPONSE" = "200" ]; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "  [$EVENT_COUNT] $EVENT_TYPE -> OK"
  else
    echo "  [$EVENT_COUNT] $EVENT_TYPE -> FAILED ($RESPONSE)"
  fi
done < "$OUTPUT_FILE"

echo ""
echo "=== Results ==="
echo "Total events: $EVENT_COUNT"
echo "Successful: $SUCCESS_COUNT"
echo "Failed: $((EVENT_COUNT - SUCCESS_COUNT))"
echo ""
echo "View session at: http://localhost:5000/session/$SESSION_ID"
echo ""

# Cleanup
rm -f "$OUTPUT_FILE"
