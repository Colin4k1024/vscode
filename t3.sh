#!/bin/bash
set -eu
cd /tmp/guardtest/repo
EXT_OUT_COUNT=$(ls -d extensions/*/out 2>/dev/null | wc -l | tr -d ' ')
echo "no-pipefail count=${EXT_OUT_COUNT}"
