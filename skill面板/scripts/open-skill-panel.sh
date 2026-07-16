#!/bin/bash
set -e

URL="http://localhost:4174"
PROJECT_DIR="$HOME/Documents/Skill管理器"

# Check if server is already running
if curl -s -o /dev/null --connect-timeout 2 "$URL" 2>/dev/null; then
  echo "Skill manager already running at $URL"
else
  echo "Starting skill manager..."
  cd "$PROJECT_DIR"
  node server/index.js &
  # Wait for server to be ready
  for i in $(seq 1 12); do
    sleep 0.5
    if curl -s -o /dev/null --connect-timeout 1 "$URL" 2>/dev/null; then
      echo "Skill manager started at $URL"
      break
    fi
  done
fi

# Open in browser
open "$URL"
echo "Opened Skill manager: $URL"
