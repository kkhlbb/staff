#!/bin/bash
# M16（最终版）：以当前修复为基准生成补丁，回退全文 → 16 抢占进程下必须红；恢复 → 同条件必须绿。
set -u
REPO=/Users/aston/DSH/staff
EVID=$REPO/docs/evidence/flake-fix/mutations
mkdir -p "$EVID/logs"
cd "$REPO" || exit 1

git diff > "$EVID/M16-fix-delay-null-and-timeout.patch"
git diff -R > "$EVID/M16-mutation-revert-fix.patch"
echo "修复补丁 $(wc -l < "$EVID/M16-fix-delay-null-and-timeout.patch") 行 / 回退补丁 $(wc -l < "$EVID/M16-mutation-revert-fix.patch") 行"

burn() { for ((i=0; i<16; i++)); do yes > /dev/null & pids+=($!); done; }
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; pids=(); }
trap cleanup EXIT

diff -q <(git show HEAD:src/pages/Workspace.test.tsx) src/pages/Workspace.test.tsx > /dev/null && echo "注意: 工作区文件与 HEAD 相同(未施加修复?)"

# ---- 变异态 ----
git checkout -- src/pages/Workspace.test.tsx
echo "[变异] userEvent.setup()=$(grep -c 'userEvent.setup()' src/pages/Workspace.test.tsx) setConfig=$(grep -c 'vi.setConfig' src/pages/Workspace.test.tsx || true)"
burn
red=0
for r in 1 2 3; do
  n=$(printf %02d "$r")
  npx vitest run --maxWorkers=8 > "$EVID/logs/M16-red-attempt-$n.log" 2>&1
  rc=$?
  echo "[变异] 轮 $n: rc=$rc | $(grep -E '^ +Tests +' "$EVID/logs/M16-red-attempt-$n.log" | sed 's/^ *//')"
  [ $rc -ne 0 ] && red=$((red+1))
done
cleanup

# ---- 恢复态 ----
git apply "$EVID/M16-fix-delay-null-and-timeout.patch"
echo "[恢复] delay:null=$(grep -c 'delay: null' src/pages/Workspace.test.tsx) setConfig=$(grep -c 'vi.setConfig' src/pages/Workspace.test.tsx)"
burn
green=0
for r in 1 2; do
  n=$(printf %02d "$r")
  npx vitest run --maxWorkers=8 > "$EVID/logs/M16-green-restored-$n.log" 2>&1
  rc=$?
  echo "[恢复] 轮 $n: rc=$rc | $(grep -E '^ +Tests +' "$EVID/logs/M16-green-restored-$n.log" | sed 's/^ *//')"
  [ $rc -eq 0 ] && green=$((green+1))
done
cleanup
echo "== M16: 变异红 $red/3，恢复绿 $green/2 =="
