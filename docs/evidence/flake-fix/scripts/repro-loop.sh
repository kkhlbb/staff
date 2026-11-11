#!/bin/bash
# 用法: repro-loop.sh <rounds> <workers> <burners> <label>
# 在未修复/修复版上重复跑全量 vitest，逐轮落日志，遇到红立即停并保留现场。
ROUNDS=${1:-10}
WORKERS=${2:-8}
BURNERS=${3:-0}
LABEL=${4:-round}
REPO=/Users/aston/DSH/staff
OUTDIR=$REPO/docs/evidence/flake-fix/repro
cd "$REPO" || exit 1
mkdir -p "$OUTDIR"

pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done
}
trap cleanup EXIT
for ((i=0; i<BURNERS; i++)); do
  yes > /dev/null &
  pids+=($!)
done

echo "== 条件: workers=$WORKERS burners=$BURNERS rounds=$ROUNDS label=$LABEL =="
echo "== 主机: $(sysctl -n hw.ncpu) 核, 起始负载: $(uptime | sed 's/.*load averages*: //') =="

for ((r=1; r<=ROUNDS; r++)); do
  n=$(printf %02d "$r")
  out="$OUTDIR/$LABEL-attempt-$n.log"
  start=$(date +%s)
  npx vitest run --maxWorkers="$WORKERS" > "$out" 2>&1
  rc=$?
  dur=$(( $(date +%s) - start ))
  tests_line=$(grep -E "^ +Tests +" "$out" | tail -1 | sed 's/^ *//')
  echo "round $n: rc=$rc ${dur}s | ${tests_line:-<无 Tests 行>}"
  if [ $rc -ne 0 ]; then
    echo "RED-FOUND round=$n log=docs/evidence/flake-fix/repro/$LABEL-attempt-$n.log"
    exit 1
  fi
done
echo "ALL-GREEN rounds=$ROUNDS"
exit 0
