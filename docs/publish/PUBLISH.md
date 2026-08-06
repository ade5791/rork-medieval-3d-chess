# S6 Publish Gate - King's Gambit: Medieval 3D Chess

Live URL: https://ade5791.github.io/kings-gambit-medieval-chess/
Landing page: https://ade5791.github.io/kings-gambit-medieval-chess/landing.html
Publish repo: https://github.com/ade5791/kings-gambit-medieval-chess (branch `main`, GitHub Pages)

## Deployed state (verified against the LIVE URL)

- Deployed commit: `cb4913f4404e5ac315a4b9d9bc2fa7e4fb6ffaf3` (merge; payload commit `9a9bfcb`)
- Rollback target: `cc970e8` (previous live deploy; `git revert -m 1 cb4913f` or reset + force-push)
- Dist tree hash: `c8a56f02b304df0a060206dc2fec876422cd551fcd4e86530ee0df81c48fa1f1`
- Bundle: `assets/index-DiAjxvlf.js` (1,427,080 bytes pre-gzip)

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
