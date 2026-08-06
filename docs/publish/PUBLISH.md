# S6 Publish Gate - King's Gambit: Medieval 3D Chess

Live URL: https://ade5791.github.io/kings-gambit-medieval-chess/
Landing page: https://ade5791.github.io/kings-gambit-medieval-chess/landing.html
Publish repo: https://github.com/ade5791/kings-gambit-medieval-chess (branch `main`, GitHub Pages)

## Deployed state (verified against the LIVE URL)

- Deployed commit: `2aa13b8` (publish repo main)
- Rollback target: `cb4913f` (previous live deploy; `git revert 2aa13b8` or reset + force-push)
- Dist tree hash: `aa9ca301a2befd9d247e27fbce264a654bb3d268522049a89f3358f6aaed37aa`
- Bundle: `assets/index-CY7243Ka.js` (1,427,643 bytes pre-gzip)

## The reported "error 400" - diagnosis and fix

The user report "the production url returns error code 400 page" was NOT the
page itself: the live index, landing page, every asset, and every model served
200 with byte-identical content (verified below). The real failure, reproduced
in a scripted browser run, was the ONLINE lobby: clicking OPEN A HALL opened a
WebSocket to `wss://ade5791.github.io/ws`. GitHub Pages is a static host with
no relay, so the handshake was refused (HTTP 404 on this deploy) and the lobby
sat on "OPENING THE HALL..." forever with the failure visible only in the
console. Repro artifact: `web/tools/out/s6-online-repro2.json`.

Fix shipped in this deploy (source: `web/src/net/onlineClient.ts`,
`web/src/ui/OnlineLobby.tsx`):

1. `relayAvailable()` guard - on `*.github.io` hosts (and any host without
   `VITE_MULTIPLAYER_URL`), host/join refuse upfront with a clear message
   instead of opening a doomed socket.
2. A first-connection failure on hosts that COULD have a relay now emits an
   actionable "Could not reach the relay" error instead of a silent spinner.
3. The lobby shows an upfront notice on relay-less deployments: Computer and
   2 Players work fully; online play needs the repo run locally with its relay.

Verified live: notice visible, honest error in 1.3s, spinner cleared
(`web/tools/out/s6run2-norelay.json`, 3/3 pass on the live URL; 3/3 pass on
staged bytes for the localhost outage path).

## Gate results (this deploy)

| Gate | Target | Result |
|---|---|---|
| vitest | source repo | 99/99 pass |
| tsc --noEmit | source repo | clean |
| vite build (PUBLIC_BASE=/kings-gambit-medieval-chess/) | source repo | green, 2.30s |
| S5 QA journey matrix (4 surfaces) | staged dist at Pages subpath | 130/130 pass, 0 console errors |
| No-relay behaviour | staged dist | 3/3 pass (unreachable path) |
| Live byte identity | live URL | 100/100 files identical, 198,323,469 bytes verified, sha256 per file |
| S5 QA journey matrix | LIVE URL | 130/130 pass, 0 console errors |
| No-relay behaviour | LIVE URL | 3/3 pass (guard + notice path) |
| Live perf spot-check | LIVE URL | p50 16.7ms / p95 18.1ms / p99 19.0ms / max 76.5ms, 0 console errors |

Perf note: headless ANGLE Chromium - a regression tripwire, not a handset or
bare-metal GPU number. The S4 matrix on the RTX 3090 desktop remains the
representative measurement.

## Byte-fidelity guards

- `core.autocrlf false` in both the source repo and the publish repo.
- `.gitattributes` with `* -text` in the publish repo (no text conversion).
- Sync tool preserves `.git/`, `.gitattributes`, `README.md` and mirrors
  payload only (`web/tools/s6r-sync.mjs`); tree hash asserted identical
  before commit.

## Landing page claims

`landing.html` states only controls and features verified by the QA gate and
by reading the input code, and its "Honest limits" section now matches the
shipped behaviour: online play is declared unavailable on this static deploy.

## Artifacts

- `web/tools/out/s6run2-qa.json` - staged QA (130/130)
- `web/tools/out/s6run2-qa-live.json` - live QA (130/130)
- `web/tools/out/s6run2-manifest.json` - 100-file sha256 manifest
- `web/tools/out/s6run2-live-bytes.json` - live byte identity (100/100)
- `web/tools/out/s6run2-norelay.json` - no-relay behaviour checks
- `web/tools/out/s6-perf-live.json` - live frame-time distribution
- `web/tools/out/s6-online-repro2.json` - original defect reproduction

## Local readiness vs deployed state

- DEPLOYED: everything in the table above is verified against
  https://ade5791.github.io/kings-gambit-medieval-chess/ after the Pages build.
- LOCAL: source repo carries the fix, harnesses, and this document; committed
  as the S6 follow-up commit in `rork-medieval-3d-chess`.

## Follow-up: "unable to open on this browser, need graphic acceleration"

Reported 2026-08-06. Diagnosis: this is the app's OWN capability gate
(`web/src/ui/GameShell.tsx` ~line 101), which fires only when the browser
cannot create ANY WebGL context (`getContext("webgl2") ?? getContext("webgl")`
returns null). It is not a server error and not a defect in the deploy.

Verified NOT reproducible on the desktop machine (RTX 3090):

- Headless Chromium (ANGLE D3D11): WebGL 2.0 context created, renderer
  "ANGLE (NVIDIA GeForce RTX 3090 Direct3D11)", unsupported gate NOT shown,
  menu reached, 0 console errors, 0 failed requests.
  Artifact: `web/tools/out/s6-live-webgl-check.png`,
  harness: `web/tools/s6-live-webgl-check.mjs`.
- User's real local Chrome: intro renders, menu reached with all four
  civilisations and game modes visible (screenshots captured in-session).
- Live byte identity re-confirmed same run: index.html (1,400 B),
  landing.html (9,553 B), assets/index-DiAjxvlf.js (1,427,082 B),
  assets/index-9KC3YKMT.css (78,378 B) all byte-size and hash-consistent
  with publish repo HEAD `cb4913f`.

Cause on the reporting browser is environmental - one of: hardware
acceleration disabled in the browser settings, a remote/preview/embedded
surface with WebGL blocked, or GPU-blocklisted drivers. Remedies to give a
user hitting the gate: enable "Use graphics acceleration when available"
(chrome://settings/system) and relaunch; check chrome://gpu shows WebGL
"Hardware accelerated"; or open the URL in Edge/Chrome/Firefox on a desktop
or tablet. No code change shipped: the gate's message already states the
correct remedy and only fires when no 3D context is possible.

## Follow-up deploy 2aa13b8: era switch tripped the WebGL-unsupported gate

Reported 2026-08-06: "this error occurs when I try to choose a different era".

Root cause, reproduced headless against the previous staged bytes
(`web/tools/out/era-repro.log`): the boot effect in `GameShell.tsx` depends
on the chosen era, so picking a new era disposes the running engine.
`SceneEngine.dispose()` deliberately calls `renderer.forceContextLoss()` to
hand the GPU context back (browsers cap live WebGL contexts). The rebooted
engine was then constructed on the SAME `<canvas>` element - whose context
had just been force-lost - so `WebGLRenderer` threw
`Cannot read properties of null (reading 'precision')`, the catch path set
`unsupported=true`, and the player saw the "needs graphic acceleration"
panel on a perfectly capable GPU. The Firefox report earlier the same day is
consistent with the same panel (see below for the browser-setting variant).

Fix (source commit `14a2a06`): the canvas is keyed on the era
(`<canvas key={eraAtBoot} ...>`), so React mounts a fresh canvas element
before every engine reboot. `forceContextLoss()` stays - still required to
avoid context exhaustion across repeated swaps. The unsupported-gate copy now
also lists concrete remedies (Firefox Performance setting, `webgl.disabled`,
Chrome graphics acceleration, RDP/VM note, driver update).

### Gates for this deploy (dist tree `aa9ca301...`)

| Gate | Target | Result |
|---|---|---|
| Era-switch repro (pre-fix) | staged bytes | gate SHOWN, null-precision error - defect confirmed |
| Era-switch verify (post-fix) | staged bytes | gate NOT shown, 0 console errors |
| Era soak rome/sengoku/egypt/classic | staged bytes | 4/4 clean, allOk=true |
| vitest | source repo | 99/99 pass |
| tsc --noEmit | source repo | clean |
| S5 QA journey matrix (4 surfaces) | staged bytes | 130/130 pass, 0 defects |
| Live byte identity | live URL | 100/100 files identical, 198,324,030 bytes |
| Era soak | LIVE URL | 4/4 clean, allOk=true, 0 console errors |
| S5 QA journey matrix | LIVE URL | 130/130 pass, 0 defects |
| Headed perf/QA spot-check (RTX 3090) | LIVE URL | 24/25; sole fail is the pre-existing "4 late shader compiles" baseline item, unchanged by this fix |

Artifacts: `web/tools/out/era-repro.log`, `era-fix-verify.log`,
`era-multi.log`, `era-multi-live.log`, `s6b-s5qa-staged.json`,
`s6b-s5qa-live.json`, `s6b-live-bytes.json`, `s6b-qa-livebaseline.log`.

### The Firefox "graphic acceleration" report

Real Firefox 153.0.1 on this machine creates WebGL2 on ANGLE D3D11
(`web/tools/ff-real-probe/result.json`) and renders the live game (visual
proof: `web/tools/out/ff-live-render-proof.png`). Playwright Firefox with
acceleration forced off ALSO still gets WebGL; only `webgl.disabled=true`
reproduces the gate. So a Firefox sighting of this panel is either (a) the
era-switch defect fixed by this deploy, or (b) that browser profile having
acceleration/WebGL disabled - which the new gate copy now walks the player
through fixing.
