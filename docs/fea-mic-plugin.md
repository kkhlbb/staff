# External FEA & MIC Influence Coefficient Matrix Plugin Guide

## 1. Overview & Lightweight Architecture

Cunlian (`v0.8.0-beta`, M4 Track F2) supports **FEM-grade compliant assembly analysis** without bundling heavy finite element solvers into the desktop installer (**+0 MB bundled FEA binaries**):

1. **Offline / Sidecar Pre-computation**: An external FEA solver (such as **CalculiX `ccx`**, **Gmsh**, Abaqus, ANSYS, or Nastran) computes the linear **Method of Influence Coefficients (MIC)** sensitivity matrix $[S] \in \mathbb{R}^{m \times n}$ once for a compliant part.
2. **In-App Sub-Second Monte Carlo**: The resulting `MicMatrixPayloadV1` JSON is stored as a SHA-256-verified `'mic-matrix'` attachment inside the `.cunlian` project archive. During 3D + GD&T Monte Carlo simulation, Cunlian's pure-JS `Float64Array` engine (`src/core/solver/mic.mjs`) evaluates:
   $$\Delta \mathbf{u}_i = [S] \cdot (\Delta \mathbf{v}_0 + \Delta \mathbf{v}_i)$$
   across **50,000 samples in well under 500 ms**, outputting both statistical stackup metrics and `PartDisplacementField` data for 3D heatmap visualization and 60fps exaggerated animation.

---

## 2. `MicMatrixPayloadV1` JSON Schema Specification

Frozen schema reference: `src/project-file/assembly3d.ts` (`micMatrixPayloadV1Schema`) and `cloud/contracts/mcp-compliant-tools.json`.

### 2.1 Fields

| Field | Type | Required | Constraints |
|---|---|---|---|
| `schemaVersion` | `1` | Yes | Must be literal integer `1`. |
| `partId` | `string` | Yes | `1..200` chars; must match the target part ID in `assembly3d.parts`. |
| `units` | `"mm"` | Yes | Length/displacement units are strictly millimeters (`mm`). |
| `forceUnits` | `"N"` | Yes | Force units are strictly Newtons (`N`). |
| `controlPointsMm` | `[number, number, number][]` | Yes | $n$ control points (clamping points, load application points, or initial warp stations) in part local coordinates (`mm`). All coordinates must be finite numbers. |
| `measurePointsMm` | `[number, number, number][]` | Yes | $m$ measurement/observation nodes in part local coordinates (`mm`). All coordinates must be finite numbers. |
| `sensitivityMatrix` | `number[][]` | Yes | Strict $m \times n$ matrix ($m = \text{measurePointsMm.length}$, $n = \text{controlPointsMm.length}$). Every entry must be a finite real number (`NaN`, `Infinity`, `-Infinity` are rejected). |
| `sourceMeta` | `object` | No | Optional external FEA provenance metadata. Strict object (no extra keys). |
| `sourceMeta.solverName` | `string` | If `sourceMeta` set | `1..200` chars (e.g., `"CalculiX 2.21"`). |
| `sourceMeta.meshNodes` | `integer` | No | Non-negative integer mesh node count. |
| `sourceMeta.generatedAtIso` | `string` | No | ISO-8601 datetime with timezone offset (e.g., `"2026-11-26T00:00:00Z"`). |

No additional properties are allowed at the top level or inside `sourceMeta`.

### 2.2 Example Payload

See the canonical test fixture at `src/core/solver/test/fixtures/sample-mic-matrix.json`:

```json
{
  "schemaVersion": 1,
  "partId": "cover-plate-al6061",
  "units": "mm",
  "forceUnits": "N",
  "controlPointsMm": [
    [10, 10, 0],
    [110, 10, 0]
  ],
  "measurePointsMm": [
    [15, 15, 1.5],
    [60, 40, 1.5],
    [105, 65, 1.5]
  ],
  "sensitivityMatrix": [
    [0.00180, 0.00012],
    [0.00045, 0.00045],
    [0.00004, 0.00020]
  ],
  "sourceMeta": {
    "solverName": "CalculiX 2.21",
    "meshNodes": 4820,
    "generatedAtIso": "2026-11-26T00:00:00Z"
  }
}
```

---

## 3. Mathematical Formulation & Runtime Engine (`src/core/solver/mic.mjs`)

For a part with $n$ control points and $m$ measurement points:
- $[S]$ is an $m \times n$ matrix where $S_{r, c}$ is the displacement response (in `mm`) at measurement point $r$ due to a unit input (`1 N` load or `1 mm` unit displacement, depending on the formulation) at control point $c$.
- For Monte Carlo sample $i \in \{0, \dots, N-1\}$ with static/initial warp vector $\Delta \mathbf{v}_0 \in \mathbb{R}^n$ and stochastic perturbation $\Delta \mathbf{v}_i \in \mathbb{R}^n$:
  $$\Delta \mathbf{u}_i = [S]\Delta \mathbf{v}_0 + [S]\Delta \mathbf{v}_i$$
- `evaluateMicBatch(mic, loadVectors, options)` precomputes $[S]\Delta \mathbf{v}_0$ once and executes the $N$ matrix-vector products on contiguous row-major `Float64Array` buffers.
- `buildMicDisplacementField(mic, displacementVector, options)` converts a length-$m$ scalar vector (projected along a unit normal, default `[0, 0, 1]`) or a length-$3m$ 3D vector into a frozen `PartDisplacementField` (`{ partId, maxDisplacementMm, minDisplacementMm, samples }`) consumed by Three.js heatmap coloring and deformation animation.
- `prepareMicAttachment(rawPayload, meta)` validates the payload, canonicalizes JSON keys to deterministic UTF-8 bytes, computes its lowercase 64-hex SHA-256 digest, and builds the `'mic-matrix'` attachment record (`attachments/<blobKey>.bin`) and `micMatrixRef` ready for `import_mic_matrix`.

---

## 4. Exporting MIC Matrices from CalculiX (`ccx`) & Gmsh (Unit-Load Method)

To generate a `MicMatrixPayloadV1` JSON from a STEP part using open-source **Gmsh** and **CalculiX (`ccx`)**:

### Step 1: Mesh the STEP Geometry with Gmsh
Mesh the part in millimeters (matching Cunlian's `units: "mm"`), exporting a CalculiX-compatible `.inp` mesh (e.g., quadratic tetrahedra `C3D10` or shell elements `S6`/`S8R`):

```bash
gmsh part.step -3 -order 2 -clmax 4.0 -format inp -o part_mesh.inp
```

### Step 2: Map Control Points and Measurement Points to Mesh Nodes
Find the nearest mesh node IDs to each coordinate in `controlPointsMm` ($c = 1 \dots n$) and `measurePointsMm` ($r = 1 \dots m$), plus the fixed datum/clamping boundary nodes (`BOUNDARY_SET`).

### Step 3: Build a Multi-Step Unit-Load CalculiX Input Deck (`mic_job.inp`)
Define material properties in consistent `mm` / `N` / `MPa` units ($1\text{ MPa} = 1\text{ N/mm}^2$), apply boundary conditions, and run $n$ linear static `*STEP` load cases—one unit load ($F_c = 1.0\text{ N}$) per control point:

```text
*INCLUDE, INPUT=part_mesh.inp
*MATERIAL, NAME=AL6061
*ELASTIC
68900.0, 0.33
*SOLID SECTION, ELSET=Eall, MATERIAL=AL6061
*BOUNDARY
BOUNDARY_SET, 1, 3, 0.0

** Load case 1: unit 1.0 N along Z at control node 101
*STEP
*STATIC
*CLOAD
101, 3, 1.0
*NODE FILE
U
*END STEP

** Repeat *STEP ... *END STEP for each control node c = 1..n
```

Run CalculiX:

```bash
ccx -i mic_job
```

### Step 4: Assemble `[S]` Column-by-Column
Parse `mic_job.frd` (or `.dat` with `*NODE PRINT, NSET=MEASURE_SET`) for each load step $c \in \{0, \dots, n-1\}$:
- Extract the displacement component $u_{r, c}$ (in `mm`) at every measurement node $r \in \{0, \dots, m-1\}$.
- If you applied a non-unit load $F_0 \neq 1.0\text{ N}$ for numerical conditioning, divide by $F_0$: $S_{r, c} = u_{r, c} / F_0$.
- Write the resulting $m \times n$ matrix into `MicMatrixPayloadV1` JSON with `sourceMeta.solverName` and `sourceMeta.generatedAtIso`.

---

## 5. Optional External FEA Sidecar Plugin Protocol (`desktop/main/fea-plugin/`)

Cunlian never bundles `ccx` or `gmsh`. Instead, `desktop/main/fea-plugin/` provides two opt-in desktop main-process functions:

### 5.1 Probing Local Solvers: `detectFeaSidecars(options?)`

Safely probes `ccx -v` and `gmsh --version` with `shell: false` and a 5-second timeout.
- When neither solver is installed, it returns **zero errors**:
  ```json
  {
    "available": false,
    "solvers": {
      "ccx": { "installed": false, "reason": "Binary \"ccx\" not found in PATH" },
      "gmsh": { "installed": false, "reason": "Binary \"gmsh\" not found in PATH" }
    },
    "statuses": [
      { "solver": "calculix", "available": false, "reason": "Binary \"ccx\" not found in PATH" },
      { "solver": "gmsh", "available": false, "reason": "Binary \"gmsh\" not found in PATH" }
    ]
  }
  ```
- When installed, it reports `available: true` along with parsed version strings.

### 5.2 Generating a MIC Matrix: `generateMicFromSidecar(partStepPath, spec, options)`

Invokes a user-configured external CLI adapter executable (`options.adapterPath`) via a deterministic **JSON stdin -> JSON stdout** protocol.

#### Stdin Request Envelope (`protocolVersion: 1`)

```json
{
  "protocolVersion": 1,
  "command": "generate-mic",
  "partStepPath": "/abs/path/to/cover-plate.step",
  "spec": {
    "partId": "cover-plate-al6061",
    "material": {
      "youngsModulusMpa": 68900,
      "poissonRatio": 0.33
    },
    "controlPointsMm": [[10, 10, 0], [110, 10, 0]],
    "measurePointsMm": [[15, 15, 1.5], [60, 40, 1.5]],
    "unitLoadN": 1.0,
    "meshSizeMm": 4.0,
    "solver": "calculix"
  }
}
```

#### Stdout Response Contract

- On success, the adapter MUST exit with code `0` and write a single valid `MicMatrixPayloadV1` JSON object to `stdout` (diagnostics/progress logs must go to `stderr`).
- `payload.partId` MUST match `spec.partId`.
- On error, the adapter MUST exit with a non-zero exit code and write a concise diagnostic message to `stderr`.

---

## 6. Security, Timeout, Validation & Provenance Rules

1. **No Shell Execution (`shell: false`)**: Both `detectFeaSidecars` and `generateMicFromSidecar` spawn executables directly without a shell, preventing command injection via file paths or arguments. Null bytes in paths are rejected upfront.
2. **Hard Timeout & Cancellation**: Probes default to `5,000 ms`; MIC generation defaults to `120,000 ms` (configurable via `options.timeoutMs`) and supports `AbortSignal`. Timed-out or cancelled child processes are terminated with `SIGKILL` and reject with `FeaPluginError('FEA_TIMEOUT' | 'FEA_CANCELLED')`.
3. **Output Byte Cap**: `stdout` is capped (default `32 MiB`, configurable via `options.maxOutputBytes`) to prevent unbounded memory consumption (`FeaPluginError('FEA_OUTPUT_TOO_LARGE')`).
4. **Strict Matrix & Numeric Validation**: Every MIC payload—whether imported manually or returned by a sidecar—passes through `parseAndValidateMicMatrix`, rejecting `NaN`, `Infinity`, non-numeric values, dimension mismatches, wrong units, or unknown keys before entering the solver or project archive.
5. **SHA-256 Integrity & `EvidenceRef` Provenance (`ADR-001`)**: `prepareMicAttachment` canonicalizes JSON bytes and computes a lowercase 64-hex SHA-256 digest stored in the `.cunlian` manifest (`kind: 'mic-matrix'`). Callers of `import_mic_matrix` must supply non-empty `EvidenceRef` citations (e.g., external FEA report or user attestation) and commit through the existing fingerprint-bound human review flow.
