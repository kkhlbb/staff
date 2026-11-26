# ADR-004: Unified OCCT 7.8.1 + XCAF WASM Kernel & `spacer.wasm` Retirement

Status: Accepted (supersedes the split `replicad_single.wasm` + `vendor/step-narrow-v1/spacer.wasm` dual-kernel layout from `ADR-004-隔套STEP固定内核.md`).

## Context

Prior to M3 Track X, the desktop application shipped two separate Open CASCADE Technology (OCCT) WebAssembly binaries:
1. `replicad_single.wasm` (22.94 MB, from `replicad-opencascadejs@1.2.1`) for 3D geometry modeling, tessellation, HLR orthographic projection, and plain `STEPControl_Reader` STEP import. It lacked XCAF (`STEPCAFControl_Reader`, `XCAFDoc_ShapeTool`, `XCAFDoc_ColorTool`, `TDataStd_Name`), preventing multi-level STEP assembly hierarchy, UTF-8 part names, transforms, and RGB color extraction.
2. `vendor/step-narrow-v1/spacer.wasm` (17.74 MB) for narrow C ABI spacer AP214IS STEP export, blocked on upstream source provenance and formal LGPL 2.1 relinking supply.

Together these totaled 40.69 MB of duplicated OCCT code in every packaged release.

## Decision

1. **Single Unified OCCT 7.8.1 WASM Kernel (`vendor/occt-unified/`)**:
   - Ship a single bit-for-bit reproducible OCCT 7.8.1 (`V7_8_1`, commit `bd2a789f15235755ce4d1a3b07379a2e062fdc2e`) Emscripten build containing all geometry, HLR, XCAF (`TKXCAF`, `TKBinXCAF`, `TKDESTEP`), and the compiled `vendor/step-narrow-v1/spacer.cpp` `_spacer_step(D, d, L)` C ABI entry point.
   - Artifacts: `cunlian_occt.wasm` (34,129,104 bytes, SHA-256 `6cb34be8e7cd73b121618bb8d3900d2950dc1b67043e59c9e499771afaf89282`) and `cunlian_occt.mjs` (289,175 bytes, SHA-256 `0727731066be7847ab67312f187592db3ee5fe285621cf94cd6baa6aac4eed91`), reducing raw WASM payload by 6.56 MB vs the dual-kernel baseline.
   - Retire and delete `vendor/step-narrow-v1/spacer.wasm` and `vendor/step-narrow-v1/spacer.cjs`. Retain `vendor/step-narrow-v1/spacer.cpp` as the audited C++ translation unit linked into `cunlian_occt.wasm`.

2. **Single-Copy External Packaging (`Resources/occt-unified/`)**:
   - Package `cunlian_occt.wasm`, `cunlian_occt.mjs`, `step-worker.cjs`, `LICENSE_LGPL_21.txt`, `OCCT_LGPL_EXCEPTION.txt`, `SOURCE.md`, `SHA256SUMS`, and `STEP-SBOM.cdx.json` once in `Resources/occt-unified/` (external to `app.asar`).
   - `desktop/main/cad/stepKernel.ts` loads `Resources/occt-unified/` in packaged Electron and `node_modules/.cache/occt-unified/` in dev/test.
   - `desktop/main/geometry-prototype/plate.mjs` (bundled into `app.asar.unpacked/.vite/build/m2-worker/m2-geometry-worker.mjs`) loads `../../../../occt-unified/cunlian_occt.{mjs,wasm}` in packaged Electron and `vendor/occt-unified/` in Node dev/test.

3. **XCAF Multi-Level STEP Import with Plain Fallback (`src/core/geometry/stepImport.mjs`)**:
   - Prefer `STEPCAFControl_Reader` + `XCAFApp_Application` + `TDocStd_Document` + `XCAFDoc_ShapeTool` + `XCAFDoc_ColorTool` + `TDataStd_Name` to extract multi-level `assemblyGroups` (`{ id, name, parentGroupId? }`), per-part `groupId`, UTF-8 `displayName`, composed 4x4 row-major `nominalTransform`, and sRGB `#rrggbb` color.
   - Gracefully fall back to `STEPControl_Reader` when a STEP file contains no XCAF hierarchy, names, colors, or non-identity placements.
   - Always keep `mates: []` on import, close XCAF documents and unlink MEMFS files in `finally`, and dispose all Embind handles via `using` / `DisposableStack` (verified 0 leaked handles).

4. **LGPL 2.1 + OCCT Exception Compliance & Release Gate**:
   - Complete corresponding source provenance (`vendor/occt-unified/SOURCE.md`, `scripts/occt-wasm-build/reproduce.sh`, verified upstream OCCT 7.8.1 tarball SHA-256), verbatim `LICENSE_LGPL_21.txt` + `OCCT_LGPL_EXCEPTION.txt`, CycloneDX 1.6 SBOM (`STEP-NARROW-SBOM.cdx.json`), and user relinking/replacement via `Resources/occt-unified/` and `CUNLIAN_STEP_LOCAL_WASM` opt-in.
   - `scripts/assert-packaged-step.mjs` enforces that neither `spacer.wasm` nor `replicad_single.wasm` is packaged and verifies every unpacked and external asset hash.
   - `scripts/check-step-release.mjs` (`npm run check:release:step`) verifies unified WASM hashes, license texts, provenance, and SBOM completeness before exiting 0.
