#!/bin/bash
# ─────────────────────────────────────────
#  TeleShare — One-click start script
#  Run: bash start.sh
# ─────────────────────────────────────────

# Kill any existing processes on our ports
echo "🔴 Stopping old servers..."
lsof -ti:8080 | xargs kill -9 2>/dev/null
lsof -ti:8081 | xargs kill -9 2>/dev/null
sleep 1

# Start CORS Proxy
echo "🚀 Starting CORS proxy on port 8081..."
node proxy/proxy.js &
PROXY_PID=$!
sleep 1

# Start HTTP file server
echo "🌐 Starting file server on port 8080..."
python3 -m http.server 8080 &
SERVER_PID=$!
sleep 1

# Verify both are running
if curl -s http://localhost:8081/ > /dev/null 2>&1; then
    echo "✅ Proxy is running at http://localhost:8081"
else
    echo "❌ Proxy failed to start!"
fi

if curl -s http://localhost:8080/ > /dev/null 2>&1; then
    echo "✅ File server running at http://localhost:8080"
else
    echo "❌ File server failed to start!"
fi

echo ""
echo "──────────────────────────────────────"
echo "  Open: http://localhost:8080"
echo "  Press Ctrl+C to stop both servers"
echo "──────────────────────────────────────"

# Wait for both processes
wait $PROXY_PID $SERVER_PID
