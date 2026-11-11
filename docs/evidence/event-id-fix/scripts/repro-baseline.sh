#!/usr/bin/env bash
# 基线复现：把 src/history/events.ts 临时回退到 ae3e89e（未修复），连跑 invalidation.test.ts 6 轮。
# 跑完自动恢复工作树里的修复版。
set -u
cd "$(dirname "$0")/../../../.." || exit 1
out=docs/evidence/event-id-fix/repro
mkdir -p "$out"
fixed=$(mktemp)
cp src/history/events.ts "$fixed"
git show ae3e89e:src/history/events.ts > src/history/events.ts
fail=0
for i in 01 02 03 04 05 06; do
  npx vitest run src/review/invalidation.test.ts > "$out/unfixed-round-$i.log" 2>&1
  code=$?
  echo "unfixed-round-$i exit=$code $(grep -E '^ +Tests ' "$out/unfixed-round-$i.log" | tr -s ' ')"
  if [ "$code" -ne 0 ]; then fail=$((fail + 1)); fi
done
cp "$fixed" src/history/events.ts
rm -f "$fixed"
echo "RED=$fail/6"
git status --short src/history/events.ts
