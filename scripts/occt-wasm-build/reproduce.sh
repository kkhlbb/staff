#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/cunlian-occt-repro.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
for run in first second; do
  OCCT_BUILD_DIR="$scratch/$run/build" OCCT_OUTPUT_DIR="$scratch/$run/out" "$here/build.sh"
  OCCT_OUTPUT_DIR="$scratch/$run/out" node "$here/smoke.mjs"
done
for artifact in cunlian_occt.wasm cunlian_occt.mjs cunlian_occt.d.mts; do
  cmp "$scratch/first/out/$artifact" "$scratch/second/out/$artifact"
  shasum -a 256 "$scratch/first/out/$artifact"
done
