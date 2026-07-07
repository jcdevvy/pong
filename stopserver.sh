#!/bin/bash
# Stops the server that startserver.sh previously started, using the PID
# it saved to server.pid.

PID_FILE="server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No server.pid found — is the server even running?"
  exit 1
fi

PID=$(cat "$PID_FILE")
if kill "$PID" 2>/dev/null; then
  echo "Stopped server (PID $PID)."
else
  echo "Process $PID wasn't running (already stopped?)."
fi
rm -f "$PID_FILE"
