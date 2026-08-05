# S6 Publish - King's Gambit, Medieval 3D Chess

Live URL: https://ade5791.github.io/kings-gambit-medieval-chess/
Landing page: https://ade5791.github.io/kings-gambit-medieval-chess/landing.html
Publish repo: https://github.com/ade5791/kings-gambit-medieval-chess (branch `main`, GitHub Pages)
Source repo (local): `C:\Users\Tks_Toledo\clawd\projects\rork-medieval-3d-chess`

## Deployed state (verified this run, 2026-08-05)

| Item | Value |
| --- | --- |
| Deployed commit | `cc970e89031482d1b92e32e619d67f1eb0f405dd` |
| Rollback target | `aae44a1762c36132d81a54de6cbbb3e4aa149ce8` |
| Dist tree hash (payload, 100 files) | `4ddc9aca375e6186f6e176aea6cdbcbca7df462a2402cfd36d44a74c7a0bdea2` |
| Payload | 198,322,238 bytes (100 files) |
| Repo tree incl. `.gitattributes`, `README.md`, `COMMITMSG.txt` | 103 files, 198,325,337 bytes |
| Pages subpath | `/kings-gambit-medieval-chess/` |
| `.nojekyll` | present in deployed tree |
| Entry bundle | `assets/index-CB_HvDwC.js` (1,426,061 bytes) |

Rollback: in the publish checkout (`C:\Users\Tks_Toledo\clawd\projects\kg-publish` or a fresh clone),
`git reset --hard aae44a1 && git push --force origin main`. That commit is the
previously verified deployment and differs from the current one only by the S6
re-gate content refresh.

## Reproducibility proven this run

A FRESH `vite build` (PUBLIC_BASE=/kings-gambit-medieval-chess/) from current
source at local commit `51722a2` produced a dist whose 100-file manifest is
**byte-identical** (0 hash mismatches, 0 missing, 0 extra) to the deployed
payload. The deployed tree adds only `.gitattributes`, `README.md`, and
`COMMITMSG.txt` - repo plumbing, not payload. Manifest diff:
`web/tools/out/s6run-diff.mjs` over `s6run-manifest-staged.json` vs
`s6run-manifest-deployed.json`.

## Byte fidelity

Git cannot rewrite the gated bytes:

- `core.autocrlf = false` in BOTH the source repo and the publish repo (verified this run)
- `.gitattributes` containing `* -text` in both repos (disables all text conversion)

The gate hashes dist, commits it, then re-hashes what Pages actually serves.
Any line-ending normalisation between those points would change the hash of
every text asset. Note: `robocopy /MIR` deletes files not in the source tree
and once removed `.gitattributes` on sync; any future sync must re-check it.

## Gate results (all re-run this run against the exact bytes)

### 1. Staged-bytes QA gate (local server at the SAME subpath)

`tools/s6-serve.mjs` served the freshly built dist at
`http://127.0.0.1:8155/kings-gambit-medieval-chess/` (root returns 404, so
root-absolute URL bugs cannot hide). `tools/s5-qa.mjs` against it:

- **130/130 checks passed, 0 defects** across four surfaces
  (desktop 1280x800, touch portrait 393x852, touch landscape 852x393,
  reduced motion). Report: `web/tools/out/s6run-qa-staged.json`.

### 2. Staged perf spot-check

`tools/s6-perf-live.mjs` vs staged bytes, RTX 3090 via headless ANGLE,
camera moving in attract mode, 400 frames:

- p50 16.7ms / p95 18.1ms / p99 18.9ms / max 78ms; p50 60fps; 0 console errors.
- Report: `web/tools/out/s6run-perf-staged.json`.

### 3. Live byte identity

`tools/s6-http-check.mjs` fetched every manifest file from
`https://ade5791.github.io/kings-gambit-medieval-chess/`:

- **100/100 files byte-identical** to the staged manifest (sha256 + length).
- Subpath isolation confirmed: site root returns 404.
- Report: `web/tools/out/s6run-http-live.json`.

### 4. QA gate vs LIVE deployed site

`tools/s5-qa.mjs` with `S5_BASE=https://ade5791.github.io/kings-gambit-medieval-chess`:

- **130/130 checks passed, 0 defects**, including tap-to-move with FEN
  spot-checks against chess.js, 44px touch targets, orientation change without
  state reset, background-return frame cap, checkmate/stalemate/promotion/
  en passant/castling terminal states, and **zero console errors** across the
  whole journey. Report: `web/tools/out/s6run-qa-live.json`.

### 5. Live perf spot-check

Same harness vs the deployed URL: p50 16.8ms / p95 18.6ms / p99 21.1ms /
max 314.3ms (one network-load hitch during attract); p50 60fps; 0 console
errors. Report: `web/tools/out/s6run-perf-live.json`.

### 6. Landing-page claims verified empirically

`tools/s6r-controls-verify.mjs` against the staged publish bytes - every
control the landing page claims was confirmed by an observed state change,
not source inspection: **10/10 verified** (tap-tap move changes FEN, drag
orbits azimuth, wheel zooms 10.51 -> 4.5, F flips azimuth, T toggles tactical,
C hides HUD controls 11 -> 2, H toggles chronicle, Esc closes panels,
0 console errors). Cross-checked against the actual key handlers in
`GameShell.tsx:448-455` and `Hud.tsx:122-156`; Space is correctly scoped
"demo mode only" on the landing page, matching `GameShell.tsx:455`.
Report: `web/tools/out/s6run-controls-staged.log`.

### 7. Deep-asset spot check

`models/egypt/k-rigged.glb` HEAD 200 with Content-Length 11,040,708 -
matching the manifest byte count for the largest per-era rigged asset.

## Local readiness vs deployed state

- DEPLOYED: commit `cc970e8` on ade5791/kings-gambit-medieval-chess, all
  seven gates above passed against the live origin. This is the shipped state.
- LOCAL: source repo working tree at `51722a2` plus S4/S5/S6 harness and
  instrumentation; typecheck clean; production build reproduces the deployed
  payload byte-for-byte. Multiplayer relay (`server/`) is NOT part of the
  Pages deploy - online play requires a separately hosted relay; the deployed
  build's lobby is present but needs a relay origin to connect.
- NOT verified: real-handset performance (headless ANGLE numbers are a
  regression tripwire, not device numbers); relay-backed online play on the
  live origin.
