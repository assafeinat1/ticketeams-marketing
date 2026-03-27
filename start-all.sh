#!/usr/bin/env bash
# Ticketeams — Unified Startup Script
# Starts backend (port 3000) + dashboard (port 5173) concurrently

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo ""
  echo "[start-all] Shutting down..."
  kill $PID_BACKEND $PID_FRONTEND 2>/dev/null
  wait $PID_BACKEND $PID_FRONTEND 2>/dev/null
  echo "[start-all] Done."
  exit 0
}
trap cleanup INT TERM

# Backend
echo "[start-all] Starting backend on port 3000..."
(cd "$ROOT_DIR/ticketeams-ai-engine" && node src/webhook-server.js) &
PID_BACKEND=$!

# Frontend
echo "[start-all] Starting dashboard on port 5173..."
cd "$ROOT_DIR/ticketeams-dashboard" && npm run dev &
PID_FRONTEND=$!

echo ""
echo "================================================"
echo "  Backend:   http://localhost:3000"
echo "  Dashboard: http://localhost:5173"
echo "  Press Ctrl+C to stop both"
echo "================================================"
echo ""

wait
