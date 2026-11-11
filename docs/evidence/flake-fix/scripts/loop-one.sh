#!/bin/bash
# 用法: loop-one.sh <runs> <burners> <test-name> <label>
# 只跑 Workspace.test.tsx 中匹配名称的用例，统计失败率。
RUNS=${1:-8}
BURNERS=${2:-0}
TESTNAME=${3}
LABEL=${4:-single}
REPO=/Users/aston/DSH/staff
OUT=$REPO/docs/evidence/flake-fix/repro/$LABEL.log
cd "$REPO" || exit 1
pids=()
trap 'for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done' EXIT
for ((i=0; i<BURNERS; i++)); do yes > /dev/null & pids+=($!); done

: > "$OUT"
red=0
for ((r=1; r<=RUNS; r++)); do
  npx vitest run src/pages/Workspace.test.tsx --maxWorkers=1 -t "$TESTNAME" >> "$OUT" 2>&1
  rc=$?
  [ $rc -ne 0 ] && red=$((red+1))
  echo "run $r rc=$rc" | tee -a "$OUT"
done
echo "== $LABEL: 红 $red/$RUNS（$TESTNAME, burners=$BURNERS）==" | tee -a "$OUT"
