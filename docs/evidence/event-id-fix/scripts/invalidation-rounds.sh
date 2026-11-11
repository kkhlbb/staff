#!/usr/bin/env bash
# EID-05：invalidation.test.ts 连跑 10 轮，逐轮日志落 logs/round-NN.log。
set -u
cd "$(dirname "$0")/../../../.." || exit 1
out=docs/evidence/event-id-fix/logs
mkdir -p "$out"
pass=0
for i in $(seq -w 1 10); do
  npx vitest run src/review/invalidation.test.ts > "$out/round-$i.log" 2>&1
  code=$?
  line=$(grep -E '^ +Tests ' "$out/round-$i.log" | tr -s ' ')
  echo "round-$i exit=$code $line"
  if [ "$code" -eq 0 ]; then pass=$((pass + 1)); fi
done
echo "GREEN=$pass/10"
