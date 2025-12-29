#!/bin/bash
# Kill processes on dev server ports before starting

PORTS=(6174 6175 6176 6177 6178 6185)

for port in "${PORTS[@]}"; do
  pid=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "Killing process on port $port (PID: $pid)"
    kill -9 $pid 2>/dev/null
  fi
done

echo "Dev ports cleared"
