#!/bin/sh
set -e
echo "Starting anchor-mcp..."
cd /app
node mcp-server.js
