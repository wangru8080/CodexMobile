#!/usr/bin/env bash
set -euo pipefail

PORT=44556
LOG_FILE="app.log"
NPM="/volume2/SSD/node-v24.14.0/bin/npm"

PIDS="$(lsof -ti :"${PORT}" || true)"

if [ -n "${PIDS}" ]; then
  echo "Killing processes on port ${PORT}: ${PIDS}"
  kill ${PIDS}
  sleep 1
fi

echo "Starting server with logs appended to ${LOG_FILE}"
nohup "${NPM}" run start:env >> "${LOG_FILE}" 2>&1 &
PID="$!"
echo "Server started, pid: ${PID}"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server started, pid: ${PID}" >> "${LOG_FILE}"
