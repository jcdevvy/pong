#!/bin/bash
# Starts server.js in the background so it keeps running after you close
# this SSH session, and remembers its process ID (in server.pid) so
# stopserver.sh can find it again later.

PID_FILE="server.pid"

# If a PID file exists AND that process is still alive, don't start a
# second copy — two servers both trying to listen on port 8080 would
# just crash the second one anyway. `kill -0` doesn't actually kill
# anything; sending signal 0 is a no-op that only checks "does a process
# with this PID exist," which is exactly what we want here.
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Server already running (PID $(cat "$PID_FILE"))."
  exit 1
fi

# nohup ignores the hangup signal your terminal sends on disconnect; `&`
# backgrounds the process so this script doesn't just hang here forever;
# `$!` is bash's variable for "PID of the last backgrounded command."
nohup node server.js > server.log 2>&1 &
echo $! > "$PID_FILE"
echo "Server started (PID $(cat "$PID_FILE")). Logs: server.log"
