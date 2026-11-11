# V3.6 evidence reproducibility

Branch: `agent/v36-evidence-repro`, based on `main 9fe22fd`.

## Scope and acceptance boundary

This change normalizes the six named historical JSON captures, and routes their
five original producer scripts through the same evidence-only serializer.
It does not change product/domain code, q precision, schema validation or any
existing numeric assertion. Only the six allowlisted JSON paths are guarded;
other historical docs are neither scanned nor rewritten.

IMPORTANT: the regeneration command reads the original six captures from pinned
Git input `9fe22fdaac6cdfc2a7c7bbf254cded61e4e73d13`. It is historical capture
re-serialization, NOT a fresh execution of the old applications or PDF extractor.
Every output explicitly records that provenance in `reproduction`.
The byte equality proven here applies to that fixed-input regeneration path.
Original live capture pipelines have NOT been rerun twice; that acceptance item
must NOT be marked passed on the basis of these hashes.
In particular, `before-report.json` still records the original zero-coverage FAIL;
current fixed application output must not be substituted for the old failure.
The old refit script's absolute `ws` dependency is absent on this machine
(`/Users/aston/DSH/wt/dsh-v3-A/node_modules/ws/index.js`, `test -f` exit 1).
No historical build recreation or dependency repair was done in this task.

## Serialization

- Machine paths become repo-relative paths when they contain docs/src/out;
  otherwise retain the filename. Local file URLs retain `file:` semantics.
- UUID/revision UUID and draft/session/request IDs become `<generated>`, with
  `generatedValueKind` documenting the marker.
- startedAt/finishedAt/generatedAt become `<generated>` and are annotated with
  `generatedAtKind: "run-time"`; the runtime value is not part of the artifact.
  SHA-256 comparison below uses the entire file, with no exclusion filter.
- JSON-encoded detail probes are recursively normalized, not discarded.
- Hashes, byte sizes, numbers, booleans, nulls, array lengths and all original
  object keys remain. The preservation test compares the six files with pinned
  historical input, including numbers/hashes inside JSON-encoded probes.
- Separate unit coverage varies paths/UUIDs/IDs/times across independent inputs
  and checks byte equality, without changing hashes, q or structure.

## Reproduce and mutate

    node scripts/reproduce-evidence.mjs
    node scripts/verify-evidence-repro.mjs

The second command regenerates twice, runs actual `shasum -a 256` on all six
files, asserts identical complete outputs, performs M06, restores in finally,
and reruns the guard. Commands/real outputs are recorded under:

- `logs/evidence-repro/generate-1.log`, `generate-2.log`
- `logs/evidence-repro/sha256-1.log`, `sha256-2.log`
- `mutations/M06.patch`, `M06-red.log`, `M06-green.log`

M06 reintroduces the old absolute-path `target` field into 1110-extraction.json.
No evidence body is removed. The guard fails specifically with `absolute path`
(exit 1, one failing test); restoring exact original bytes passes all 18 tests
(exit 0). `git apply --check docs/evidence/V3.6/mutations/M06.patch` also passes.

## Six commands plus packaging

    node scripts/verify-evidence-repro.mjs --suites

Actual outputs in `logs/evidence-repro/command-{1..7}.log`:

1. `npm test`: exit 0, 93 files / 958 tests passed.
2. `npm run test:desktop`: exit 0, 27 files / 197 tests passed.
3. `npm run typecheck`: exit 0, no diagnostics.
4. `npm run typecheck:desktop`: exit 0, no diagnostics.
5. `npm run lint`: exit 0, no diagnostics.
6. `npm run build`: exit 0; existing >500 kB chunk warning retained.
7. `npm run package:desktop -- --arch=arm64`: exit 0; packaged PDF worker
   runtime-load check reports RESULT PASS. Actual arm64 app is under
   `out/寸链-darwin-arm64/寸链.app` (ignored local build output, not a release).

The frontend suite emits jsdom navigation/canvas not-implemented messages;
those are retained in the log, not hidden or counted as UI verification.

After committing, use `EVIDENCE_VERIFY_OUT=<external evidence directory>` for
both verification invocations so their fresh runtime logs do not dirty tracked
logs. The six JSON files must remain unchanged; check `git status --short`
after rerunning six commands plus packaging.

## Not done

- Fresh live capture of all six historical cases, twice, from original apps.
- Windows packaging / manual UI walkthrough.
- Merge, push, branch deletion, cherry-pick or release publication.

The readonly reference `05ce80a` was inspected with git show only.
