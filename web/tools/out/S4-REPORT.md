# S4 - Performance matrix, teardown and leak audit

Machine: NVIDIA GeForce RTX 3090, ANGLE D3D11, Chromium headless (Playwright).
Viewport 1600x900, deviceScaleFactor 1. Warmup 6s, measure 12s per cell.
Harness: `tools/s4-perf-matrix.mjs`. Raw data: `tools/out/s4-perf-matrix-final.json`.

## Method

- One fresh browser + fresh context per cell, torn down before the next. No
  reused WebGL contexts (context exhaustion invalidates late cells).
- Strictly sequential. Never two CPU-bound measurement jobs at once -
  contention fabricates multi-second phantom hitches.
- Camera orbiting (`showcase(true)`) with an AI game running for every cell.
  No static-camera numbers appear anywhere in this report.
- Full distribution reported: p50/p95/p99/max plus hitch count over 50ms.
- Frame times are raw unclamped wall deltas, so a hitch shows its true length.
- Every cell asserts the preset/arena/era it actually resolved to, so a silently
  ignored query parameter cannot pass as a measured cell.

48 cells = 4 presets x 4 battlegrounds (classic-jungle, classic-dawn,
rome-frost, rome-dusk) x 3 phases (opening 32 pieces, midgame with effects,
endgame). All 48 completed, 0 failed, 0 console errors, 0 frame errors,
0 preset drift, 0 arena/era drift.

## Preset rollup (median of cell p50, opening phase)

| preset | opening p50 | p99 | 60fps p50 gate | 60fps p99 gate | programs | textures | lit lights |
|---|---|---|---|---|---|---|---|
| low | 6.4ms (156fps) | 11.0ms | 12/12 | 12/12 | 45 | 79 | 8 |
| medium | 10.1ms (99fps) | 15.9ms | 12/12 | 12/12 | 71 | 104 | 10 |
| high | 15.7ms (64fps) | 24.6ms | 12/12 | 4/12 | 75 | 105 | 11 |
| ultra | 21.8ms (46fps) | 34.0ms | 4/12 | 4/12 | 81 | 110 | 12 |

Phase rollup: opening 15.5ms, midgame 15.1ms, endgame 6.3ms (median across all
presets). Midgame is not more expensive than opening - effects cost less than
the 32-piece roster they replace.

Battleground rollup is flat: classic-jungle 10.1ms, classic-dawn 9.7ms,
rome-frost 9.7ms, rome-dusk 9.9ms. Era rollup identical at 9.7ms for both
civilisations despite Rome carrying 2.1x the triangles (1,124,630 vs 535,605 at
low/opening) - triangle count is not the limiting factor.

## Result against the gate

- low, medium, high: 36/36 cells at or above 60fps p50. PASS.
- ultra: 4/12. The 8 failures are every opening and midgame cell across all
  four battlegrounds, 43.5-47.4fps. Endgame ultra passes everywhere.

## Diagnosis: ultra is CPU-submission bound, not GPU bound

Resolution sweep at ultra (`tools/s4-ultra-diagnose.mjs`), classic-jungle/opening:

| resolution | pixels | p50 | draw calls | frame time |
|---|---|---|---|---|
| 1600x900 | 100% | 21.90ms | 2257 | 100.0% |
| 1131x636 | 50% | 21.70ms | 2257 | 99.1% |
| 800x450 | 25% | 21.90ms | 2257 | 100.0% |
| 566x318 | 12.5% | 21.10ms | 2257 | 96.3% |

Cutting pixel count by 87.5% moved frame time by 3.7%. The resolution-dependent
(fragment) portion of the frame is 0.80ms of 21.90ms. VERDICT: CPU bound on
draw-call submission.

Attribution (`tools/s4-attribute.mjs`, ultra): 2272 calls/frame, 3.31M triangles.
Scene groups by visible mesh count: castle_hall 80, board 67, battlefield 53,
jungle 48, then 32 piece groups at 7-15 meshes each. The 32 figures contribute
~370 visible meshes and ~250 shadow casters - more than any single environment
group. Shadow analysis (`tools/s4-lights.mjs`): 15 lights, exactly 1 casts
shadows (the key DirectionalLight at 4096x4096), so shadow passes are 1, not a
multiplier. 322 shadow casters x 1 pass.

The honest ceiling on this machine: ultra runs 43-47fps in opening/midgame
because it submits ~2260 draw calls per frame from ~600 visible meshes. Lowering
resolution, shadow map size, or the shadow-caster set cannot fix it - all three
were measured and none is the limiting side. Fixing it properly means merging or
instancing the per-piece mesh parts, which is a geometry-authoring change beyond
this step's scope. Documented rather than papered over.

## Fix applied: the adaptive step-down did not defend 60fps

`sampleFps()` only stepped the preset down below **40fps average**. Auto-detected
ultra sits at 43-47fps - fast enough to never trigger, far short of budget. On
this machine `detectQualityPreset()` returns ultra (strongGpu + cores>=8 +
memory>=8), so the default experience was the failing tier.

Changed in `src/scene/sceneEngine.ts`:
- step-down threshold 40fps -> 58fps, so it defends the target it exists for;
- allow repeated steps (was one-shot) rate-limited to one per 6s, so ultra can
  reach high and, on a weaker machine, medium;
- clear `fpsSamples` on step, so the next window is not judged on stale frames
  belonging to the preset just left.
Pinned presets still never step down - a capture must not recompile mid-run.

With this, a default-preset session converges to high, which measures 12/12
cells at or above 60fps p50.

## Shader prewarm

Prewarm ran in 48/48 cells, compiling 38-39 programs behind the loading screen
in 3.57-5.13s. Late compiles during the measurement window: **1 of 48 cells**.

Additional fix applied to `prewarmShaders()`: `renderer.compile()` skips
invisible objects, so materials on groups hidden at boot (the jungle temple set,
`normalMap+roughnessMap`) were never compiled up front. Prewarm now forces every
non-light object visible for the compile and restores the exact previous flags
afterwards. Lights are deliberately excluded - toggling light visibility
rewrites the program key of every lit material, which is the trap this step
explicitly warns about.

## Light-count constancy

PASS across all 48 cells: visible and lit light counts are identical before and
after every measurement window (12 total/12 visible at low, 15/15 at
medium-ultra). The three `spell_light_*` point lights are held at intensity 0.00
with `visible=true` - driven to zero rather than hidden, exactly as required.
No lit-material recompile from a torch crossing a cull radius was observed.

## The one remaining defect: a 384-400ms stall, honestly unresolved

Cell `classic-jungle/medium/endgame` shows 1 hitch, max 396.6ms, and +1 program.
Every other cell has 0 hitches. Investigation:

1. Not a material or object appearing - material count (689) and renderable
   count (913) are byte-identical across the stall.
2. Not the hidden-group compile - fixed and rebuilt, stall persists.
3. CDP profiler over the stall: `getProgramInfoLog` 381.8ms self time, matching
   the observed 384ms longtask almost exactly. That is three.js blocking on the
   synchronous GL program link.
4. Decisive control: letting background clip warming finish first
   (`S4_SETTLE=30000`) gives the SAME cell **p50 10.50ms, p95 14.1, p99 16.5,
   max 20.3ms, 0 hitches, 0 late programs**. With warming overlapping the
   window, the stall returns.

Conclusion: the last rigged-GLB clip binds at ~14.7s and introduces a material
variant that was not in the graph when prewarm ran, so its program links during
gameplay and blocks for ~390ms. Pacing the warm loop (single lane + a frame
yield per bind, applied in `src/scene/pieces.ts`) did not remove it, which
proves it is one heavy link rather than a batch of parses sharing a task.

Not claimed as fixed. The correct fix is to compile the clip-bound material
variants at bind time behind the loading screen, or to prewarm after
`warmClips()` resolves rather than before. That is a change to load sequencing
and was not made blind at the end of this step.

Scope: one cell in 48, one frame in ~2000, on a background asset stream that
completes ~15s into a session.

## Teardown and leak audit

`tools/s4-leak-audit.mjs` - 6 menu -> game -> menu cycles plus 20s idle,
driving the real UI (Showcase -> "Roll the showcase" -> New game):

| metric | baseline | after 6 cycles + idle | delta |
|---|---|---|---|
| geometries | 155 | 155 | 0 |
| textures | 115 | 117 | +2 |
| programs | 85 | 80 | -5 |
| canvases | 1 | 1 | 0 |
| DOM nodes | 108 | 108 | 0 |

Routed cleanly 6/6. Per-cycle figures are flat from cycle 2 onward - no
monotonic growth. The +2 textures appear once between baseline and cycle 1 and
never grow again (first-game lazy allocation, not a per-cycle leak). Programs
fell because the baseline was captured after a fuller warm state.

`tools/s4-worker-audit.mjs` - Worker constructor and RAF wrapped before app
code: across 5 cycles, **1 worker created, 1 live, never duplicated**. The chess
engine worker is shared for the page lifetime rather than per-game, so repeated
routing cannot leak engine threads. RAF: 7664 requested, 0 cancelled - expected
for a single persistent loop that is never unmounted during these cycles.

## Verification

- `npx tsc --noEmit` clean after all three patches.
- `npx vitest run` 79/79 pass (4 files).
- `npx vite build` succeeds.
- Rebuilt bundle confirmed served before re-measuring.

## Files produced

- `tools/out/s4-perf-matrix-final.json` - all 48 cells, full raw distributions
- `tools/out/s4-analysis.txt` - rollups and gate results
- `tools/out/s4-leak-audit.json` - leak audit cycles
- `tools/s4-analyze.mjs`, `s4-ultra-diagnose.mjs`, `s4-lights.mjs`,
  `s4-latecompile.mjs`, `s4-latesource.mjs`, `s4-latemutate.mjs`,
  `s4-lateobj.mjs`, `s4-latetrap.mjs`, `s4-latestack.mjs`, `s4-repre.mjs`,
  `s4-hitchtime.mjs`, `s4-bindtime.mjs`, `s4-warmclip.mjs`,
  `s4-confirm-link.mjs`, `s4-worker-audit.mjs`

## Source changes

- `src/scene/sceneEngine.ts` - prewarm covers hidden objects with exact restore;
  step-down gate 40 -> 58fps, repeatable and rate-limited, sample reset on step.
- `src/scene/pieces.ts` - clip warming paced to one bind per frame, single lane.
