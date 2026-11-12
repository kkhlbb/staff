#!/bin/bash
# M27 / M28 变异验证：故意改坏 → 目标用例必须红 → 恢复 → 必须绿。
set -u
cd /Users/aston/DSH/staff
LOG=docs/evidence/dxf-depth/logs
MUT=docs/evidence/dxf-depth/mutations/mutate.py
mkdir -p "$LOG"

echo "=== 变异前基线 ==="
npx vitest run src/drawing/dxfExport.test.ts 2>&1 | grep -E "Tests |Test Files" | tail -2

echo
echo "=== M27：2000 的标注退回「几何 + TEXT」==="
python3 "$MUT" backup
python3 "$MUT" m27
npx vitest run src/drawing/dxfExport.test.ts 2>&1 > "$LOG/50-M27-red.log"
grep -E "Tests |Test Files" "$LOG/50-M27-red.log" | tail -2
grep -E "×" "$LOG/50-M27-red.log" | head -12
python3 "$MUT" restore
npx vitest run src/drawing/dxfExport.test.ts 2>&1 > "$LOG/51-M27-green.log"
echo "--- 恢复后 ---"
grep -E "Tests |Test Files" "$LOG/51-M27-green.log" | tail -2

echo
echo "=== M28：视口比例写死 1:1 ==="
python3 "$MUT" m28
npx vitest run src/drawing/dxfExport.test.ts 2>&1 > "$LOG/52-M28-red.log"
grep -E "Tests |Test Files" "$LOG/52-M28-red.log" | tail -2
grep -E "×" "$LOG/52-M28-red.log" | head -12
python3 "$MUT" restore
npx vitest run src/drawing/dxfExport.test.ts 2>&1 > "$LOG/53-M28-green.log"
echo "--- 恢复后 ---"
grep -E "Tests |Test Files" "$LOG/53-M28-green.log" | tail -2
