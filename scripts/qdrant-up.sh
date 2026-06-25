#!/usr/bin/env bash
# Start a local Qdrant instance via Docker. Vector dedup will not work without this.
# Stop with: docker stop vendor-threat-watch-qdrant

set -euo pipefail

CONTAINER_NAME="vendor-threat-watch-qdrant"
PORT="${QDRANT_PORT:-6333}"

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container ${CONTAINER_NAME} already exists. Starting if stopped..."
  docker start "${CONTAINER_NAME}"
else
  docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${PORT}:6333" \
    -p "6334:6334" \
    -v qdrant_data:/qdrant/storage \
    qdrant/qdrant:latest
fi

echo "Qdrant running at http://localhost:${PORT}"
echo "Verify: curl http://localhost:${PORT}/collections"
