#!/bin/bash
# 用法: measure-full.sh <burners> <workers> <label>
# 全量 + CPU 抢占 + testTimeout=20000 + verbose，拿到真实并行压力下逐用例耗时。
BURNERS=${1:-8}
WORKERS=${2:-8}
LABEL=${3:-full}
REPO=/Users/aston/DSH/staff
OUT=$REPO/docs/evidence/flake-fix/repro/$LABEL.log
cd "$REPO" || exit 1
pids=()
trap 'for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done' EXIT
for ((i=0; i<BURNERS; i++)); do yes > /dev/null & pids+=($!); done

npx vitest run --maxWorkers="$WORKERS" --testTimeout=20000 --reporter=verbose > "$OUT" 2>&1
rc=$?
echo "exit=$rc log=docs/evidence/flake-fix/repro/$LABEL.log"
grep -E "^ +Tests  |^ +Duration" "$OUT"
grep -E "逐格输入案例 A" "$OUT"
