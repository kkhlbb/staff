# Frontend M0 visual baseline: source-measured, not screenshot-tested

Baseline: local 0.4.2-beta, 61d8c435b220cea95c3b06f5435bdf81a6a8dbf9.

## Verified source locations

- src/index.css:15-20 defines system-ui, -apple-system, Segoe UI, Roboto, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif; base 15px/1.55. Keep installed CJK fallbacks; do not download a new font or assume which fallback the Mac selected.
- src/index.css:18 defines ui-monospace/SFMono-Regular/Consolas/Liberation Mono for numeric/code contexts. DesktopWorkspace.css:33,82 uses tabular numerals for version/value alignment.
- src/pages/DesktopWorkspace.css:1-30 overrides the global purple with an indigo desktop accent, neutral gray surfaces and distinct pending/danger/pass colors. Reuse desktop values rather than accidentally inheriting the global accent.
- src/components/layout/tokens.css:2-9 sets sidebar 320px, min240/max400, center min560, gap8, splitter6; max1123 changes sidebar280 and center360, min1400 changes sidebar360 and center700. These are existing CSS values, not a claim that all future split layouts fit them.

## Solid-color text contrast calculations

The following ratios are computed from the exact foreground/background hex values using sRGB relative luminance. They do not prove rendered accessibility, antialiasing quality, focus visibility or status comprehension. Target normal status text at least 4.5:1; assess actual states and inherited styles in a real window.

| Role | Foreground | Background | Calculated ratio |
|---|---|---|---|
| body | #172033 | #FFFFFF | 16.27:1 |
| muted | #526075 | #FFFFFF | 6.39:1 |
| selected | #3730A3 | #EEF2FF | 8.88:1 |
| pending | #92400E | #FFF4DD | 6.49:1 |
| blocked | #A61B1B | #FDEBEC | 6.54:1 |
| pass | #14633D | #EAF7EF | 6.61:1 |

## Reasons and acceptance criteria

Preserve the neutral light drawing surface so geometry is not confused with application state. Indigo marks selection/actions, not engineering pass. Pending, blocked and pass colors must always accompany explicit localized labels and evidence actions. Never represent uncovered checks as green or a connection handshake as project authorization.

Keep compact desktop typography for sidebars but do not shrink engineering labels merely to fit both views. Use retained tabs rather than unreadably small side-by-side canvases at narrow widths. Acceptance: model/drawing revision remains visible, sidebar text wraps without hiding recovery actions, and switching layouts changes neither camera nor engineering values.

Existing desktop buttons have minimum32px height and a 2px focus outline. Preserve keyboard reachability and tab semantics; test actual focus order, clipping and label announcements before claiming accessibility. Screen-reader strings must describe pending/failed/old revision, not only icon names.

## CLI draft review corrections and scope

The returned draft calls A05 a packaging test in its opening boundary note. That is inaccurate: A05 is the signed-gap range [1.7,2.3] mm, invariant under a shared +90-degree X rotation. Packaging is a separate M0 execution gate covering the required technical samples. Do not copy the draft wording into acceptance results.

The CLI draft and these calculations are review materials only. No screenshot, desktop navigation, feature selection, live bridge or A01/A05 geometric assertion has been executed here. The new projection and its tests remain separate from actual Electron rendering and backend enforcement.

## Reviewed source reference received from the research team

[Three 0.187.0 camera/picking boundary](https://app.notion.com/p/4212ae1f5db2817590bec3c6e10835b9?pvs=204) was fetched and read. It archives a partial source review, not target-machine execution. [Versioned package metadata](https://registry.npmjs.org/three/0.187.0) identifies gitHead 7e89746a687bb88271253698fa108b1dd59825d0. Referenced source locations: OrthographicCamera.js 191-223, Raycaster.js 158-175, Mesh.js 321-356 and package MIT LICENSE.

Implementation acceptance follows these boundaries: camera zoom/projection changes must not alter engineering mm; A03 edits preserve camera instead of auto-fit after every mesh replacement; picked faceIndex identifies a triangle in the current buffer, not a persistent engineering feature. Application mapping must include revision and stable partId/featureId/role; A12 recreation cannot silently reuse a stale index. Orthographic projection is not an exact vector engineering drawing, and A05 signed gap is not screen-space distance or world-Z alone. These are source-informed test obligations, not A01/A03/A05/A12 pass results. The source code snippets themselves have not been independently fetched in this frontend review.
