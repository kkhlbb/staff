# Frontend M0: observation and synthetic-state acceptance draft

Status: source review and scenario specification only. No desktop launch, screenshots, live connection, geometry or packaged acceptance performed.

## Baseline and ownership

Local 0.4.2-beta: 61d8c435b220cea95c3b06f5435bdf81a6a8dbf9.
Branch: agent/dsh-agent-refactor-m0. Remote remains unverified.
Backend owns production desktop/shared/project-agent contracts. Frontend owns only its __fixtures__/synthetic scenarios and these notes. IPC, package.json, lockfile and packaging configuration must not be edited concurrently. Other local versions and uncommitted viewer changes remain untouched and excluded.

## Source observations, not runtime evidence

DesktopWorkspace.tsx includes drawing/3D/source PDF/dimension-chain/history/taskbook/sketch tabs, ThreeViewport, ModelViewport and AgentSidebar. workspace/status.ts distinguishes no-result, pending, within, outside and no-target states. Unconfirmed or stale previews are not formal success. Preserve these boundaries during migration.

Old-file opening, independent drafts, source navigation, typography and actual layout still need real execution evidence. Legacy 12.00/12.04/12.10/12.05 behavior must be tested, not inferred from these notes. The unrelated old PartViewer is not imported.

## Frontend M0 task cards

- F-M0-01: archive old-project display and navigation using isolated copies. Record version, draft, source, drawing and 3D entry points. Pending real desktop evidence.
- F-M0-02: 15 synthetic state scenarios in frontend-state-scenarios.json. These are scenario specifications, NOT production event DTOs. Once shared types land, add typed adapters and behavioral display tests. Keep simulated inputs permanently labelled in the fixture harness.
- F-M0-03: acceptance criteria for layout and interaction. Preserve the desktop shell, existing CJK font fallback and drawing appearance pending actual inspection; use a central canvas plus activity/requirements/checks/history sidebar to retain viewing context. At narrow widths switch model/drawing with tabs that retain camera and visible revision/status. Status requires text as well as color; recovery and evidence actions must be keyboard reachable.

## Shared-contract review

Backend report sections 2 and 3 reviewed. Agree: persistent project sequence; snapshot/cursor from one consistent boundary; fresh snapshot on unfillable gap; base/draft CAS; writerEpoch fencing including queued writes; project/caller/operation/key idempotency; confirmation bound to current preview and check fingerprints.

Events include projectId/baseRevision/draftRevision/jobId/sequence/type. Artifacts add artifactId/kind/hash/inputFingerprint/objectMapVersion/attempt. Cancelled attempts cannot publish visible artifacts. Production field names, nullability and error structures will be checked against landed shared types before adapters are written.

Same-revision completion must compare full input manifests, not revision IDs alone. Old drawings show their actual revision. Late old jobs only enter history. Natural-language finish opens review, never commits by itself. A changed draft invalidates prior confirmation.

## Measurable display acceptance

- Disconnected, partial, failed and blocked states contain localized explanatory text and a recovery action; no color/spinner alone implies success.
- A08 delay/reordering does not replace current draft with an older one, or reset still-valid camera/selection. Current model and drawing revisions remain visible.
- A09 separates connection from project authorization; disconnection keeps existing artifacts readable; ownership loss does not imply successful save.
- A11 shows progress before all artifacts are ready, then current same-manifest preview; expired confirmation returns to review without auto-resubmitting.
- A12 deletion and recreation with equal diameter does not transfer old references. Affected evidence requires explicit rebind.

## Execution blocker and honest scope

The Antigravity request with --model gemini-4-neon-medium exited 3 with: User location is not supported for the API use. Its response is empty and reported token usage is zero. No retry, model change, DSH fallback, network or account change was performed. These scenario notes were prepared by direct review, not by a successful CLI run. Frontend implementation through the selected execution endpoint remains blocked.

M0 also requires real packaged old-project loading and A01/A05 geometry evidence from backend. Synthetic fixtures cannot satisfy these gates. M0 is NOT complete and M1 has NOT started.

## Execution status update

The initial regional error was followed by exactly one requested retry at 08:40:27 PST. That retry finished with exit 0 / SUCCESS after 162.85 seconds and returned an M0 review draft (no tests executed by that request). A later over-broad implementation request hit its 4-minute deadline, exit 3 / DEADLINE_EXCEEDED, returning incomplete JSON and tests; that output was not applied. Work is now narrowed to a short adapter that reuses the backend contract, with bounded tests. The original regional-error paragraph is historical, not a claim that the endpoint is currently disconnected.

The immutable backend contract handoff contract-handoff-ju6e554n was verified for all 7 file hashes; 5 production contract files were copied without overwrites. Local npm ci --ignore-scripts --no-audit --no-fund succeeded. Desktop and app/node/MCP typechecks passed before adding frontend adapter code; they must run again after code lands. No live UI/geometry/packaged acceptance is implied.
