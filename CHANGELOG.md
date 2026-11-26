# Changelog

All notable changes to **寸链 (Cunlian)** are documented in this file.

## v1.0.1 - 2026-11-26

Patch release fixing out-of-the-box desktop GA workflows, built-in template switching, read-only authorization ergonomics, and Windows P0 packaging/IPC reliability.

### Fixed
- **Desktop Out-of-the-Box 3D / GD&T / Compliant / Report GA**:
  - Enabled 3D assembly, 10-type GD&T, compliant physics, and audit reporting by default in the packaged desktop workbench.
  - Fixed offline PDF report printing via a hidden iframe (no external popups or network dependency) with clean HTML/CSV/JSON export fallbacks.
- **Built-in Templates & Warpage Displacement Field**:
  - Verified all 3 built-in templates (`builtin-mounting-plate`, `builtin-shaft-spacer`, `builtin-compliant-cover-warpage`) load distinct 3D assemblies and 2D drawings, with subdivided cover mesh geometry producing non-zero warpage displacement fields.
- **Read-Only Authorization Controls**:
  - Added direct read-only launch and full close/exit affordances (`×`, `取消/退出`, `Esc`, and backdrop click) on the authorization modal.
- **Windows P0 Fixes**:
  - Normalized Windows `file:///C:/...` and UNC paths in `rendererUrl.ts` for the IPC `SenderGuard` (resolving "没有 IPC 权限" errors on Windows).
  - Replaced macOS `ditto` with a UTF-8 clean Windows ZIP builder (`scripts/build-win-zip.mjs`, 100% UTF-8 flag bit `0x800` and 0 AppleDouble `._*` entries).
  - Added `startupDiagnostics.ts` crash logging and native error dialogs for startup failures.
  - Hardened the NSIS Windows x64 installer with PE `VersionInfo` (`1.0.1.0`), standard `zlib` compression, and an optional Authenticode RFC 3161 signing hook.

---

## [1.0.0] - 2026-11-26 (GA)

Official General Availability release completing the 3D assembly, full 10-type GD&T, compliant physics + MIC/FEA sidecar, offline audit reporting, and dual-mode Desktop + Cloud/AgentArts platform.

### Added
- **5 Advanced GD&T Controls (10 GD&T Types Total)**:
  - Surface Profile (`profile-surface`, including unequal bilateral `UZ` outer fraction), Circular Runout (`circular-runout`), Total Runout (`total-runout`), Cylindricity (`cylindricity`), and Composite Position (`composite-position` with upper/lower segments & pattern grouping), coupled with 3-2-1 DRF, MMC/LMC bonus, and datum shift.
  - 3D visual feature control frames & runout/profile overlays in both Desktop and Cloud/Web viewports.
- **Offline Audit Simulation Reports (`HTML` / `PDF` / `CSV` / `JSON`)**:
  - Self-contained offline report engine (`src/report/`) with zero external CDN links, embedding `projectId`, `revision`, `checksetFingerprint`, deterministic `seed`, SHA-256 digest, rigid-vs-compliant Cp/Cpk/PPM summary, sensitivity/Pareto charts, and full `EvidenceRef` provenance appendix.
  - Wired end-to-end across Desktop IPC (`exportSimulationReport`), MCP (`export_simulation_report`), Cloud REST (`POST /api/v1/projects/:id/report`), and Desktop/Cloud UI.
- **Dual-State GA Verification & Documentation**:
  - Extended `scripts/cloud-smoke.mjs` to verify both `FEATURE_3D_ASSEMBLY_M1=false` competition baseline and `FEATURE_3D_ASSEMBLY_M1=true` 3D + 10 GD&T + compliant + HTML/CSV/JSON report export.
  - Cloud / AgentArts deployment documentation (`docs/cloud-deployment.md`).

### Performance
- 50,000-sample 3D + 10 GD&T + 4 compliant physics Monte Carlo simulation completes in `< 1.0s` on Apple M4 (`< 2.2s` budget); incremental What-If completes in `< 260ms` (`< 350ms` budget).

---

## [0.8.0-beta] - 2026-11-26 (M4 Compliant Assembly & MIC/FEA)

### Added
- **4 Analytical Compliance Models**: Axial compression/preload springback (`axial-compression`), Kirchhoff thin-plate clamping warpage (`kirchhoff-plate`), Euler–Bernoulli beam bending (`euler-beam`), and uniform/bonded-layer thermal distortion (`thermal-expansion`), coupled directly into assembly Monte Carlo trials with common random draws.
- **MIC Influence Matrix & FEA Sidecar Protocol**: High-speed batch MIC evaluator (`50k` samples in `< 10ms`), `.mic.json` attachment canonicalization + SHA-256 provenance, and zero-bloat (`+0 MB` bundled binaries) FEA sidecar discovery protocol (`docs/fea-mic-plugin.md`).
- **3D Deformation Visualization**: Vertex-color displacement heatmaps, 60fps deformation animation, rigid-vs-compliant Cpk/PPM comparison, and `compliantSnapshot` in Cloud `GET /review`.
- **MCP & Cloud Tools**: `stage_physics`, `import_mic_matrix`, `analyze_compliant_stackup`, and `detectFeaSidecars`.

---

## [0.7.0-beta] - 2026-11-25 (M3 3D GD&T & Unified XCAF OCCT)

### Added
- **Core 3D GD&T Engine**: 3-2-1 Datum Reference Frames (A/B/C), MMC/LMC material bonus, datum shift, and 5 foundational GD&T controls (Position, Parallelism, Perpendicularity, Flatness, Coaxiality) in a resident solver worker.
- **Unified XCAF OCCT 7.8.1 WASM Kernel**: Consolidated single `cunlian_occt.wasm` with full LGPL-2.1-only + OCCT Exception compliance gate (`npm run check:release:step`), CycloneDX SBOM, and external replacement opt-in.
- **GD&T MCP & Cloud Wiring**: `stage_datum`, `stage_gdt`, `analyze_gdt_stackup`, and `gdtSnapshot` in Cloud `GET /review`.

---

## [0.5.0-beta] – [0.5.3-beta] - Mechanical Drawing Agent & Cloud Foundation

### Added
- Dual-entry mechanical drawing workbench (local `cunlian-local` stdio MCP bridge + 10 built-in OpenAI-compatible model API presets).
- Real 3D Three.js picking + real 2D SVG/DXF(R12/2000)/PDF orthographic drawings with bidirectional feature-to-dimension highlighting.
- Asynchronous drawing pipeline, out-of-order revision guards, single-writer lease protocol, human-confirmed atomic `.cunlian` commits, and legacy 1D integer-`q` spacer stackup compatibility.
- Cloud Streamable HTTP MCP + OpenAPI REST server (`cloud/server/`) and Windows x64 NSIS installer + macOS arm64 desktop packaging.
