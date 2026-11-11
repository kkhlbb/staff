#!/bin/bash
# 用法: stats-rounds.sh <rounds> <workers|default> <burners> <prefix> <outdir>
# 逐轮跑全量 vitest，把每轮完整输出落到指定目录，并打印 Tests 行。
ROUNDS=${1:-10}
WORKERS=${2:-default}
BURNERS=${3:-0}
PREFIX=${4:-round}
OUTREL=${5:-logs}
REPO=/Users/aston/DSH/staff
OUTDIR=$REPO/docs/evidence/flake-fix/$OUTREL
cd "$REPO" || exit 1
mkdir -p "$OUTDIR"

pids=()
trap 'for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done' EXIT
for ((i=0; i<BURNERS; i++)); do yes > /dev/null & pids+=($!); done

if [ "$WORKERS" = "default" ]; then
  WORKER_ARGS=()
else
  WORKER_ARGS=(--maxWorkers="$WORKERS")
fi

echo "== rounds=$ROUNDS workers=$WORKERS burners=$BURNERS out=$OUTREL =="
fail=0
for ((r=1; r<=ROUNDS; r++)); do
  n=$(printf %02d "$r")
  out="$OUTDIR/$PREFIX-$n.log"
  start=$(date +%s)
  npx vitest run "${WORKER_ARGS[@]}" > "$out" 2>&1
  rc=$?
  dur=$(( $(date +%s) - start ))
  echo "$PREFIX-$n: rc=$rc ${dur}s | $(grep -E '^ +Test Files +' "$out" | sed 's/^ *//') | $(grep -E '^ +Tests +' "$out" | sed 's/^ *//')"
  [ $rc -ne 0 ] && fail=$((fail+1))
done
echo "== 汇总: $((ROUNDS-fail))/$ROUNDS 通过 =="
