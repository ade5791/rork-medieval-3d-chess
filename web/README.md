# King's Gambit — the app

This folder holds the game itself. For the project overview, features, architecture notes and
contribution guide, read the [root README](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

A cinematic 3D chess game: sculpted medieval and Mesoamerican figures fighting on a
marble-and-basalt board. Built with Vite + React + TypeScript + three.js, with chess.js for
the rules and a Web Worker search engine for the computer opponent.

## Setup

```bash
bun install   # or npm install
bun run dev   # or npm run dev  → http://localhost:5173
bun run build # production bundle in dist/
bun run preview
```

## Controls

| Action | Input |
| --- | --- |
| Orbit / zoom | Drag, mouse wheel (pinch on touch) |
| Select a figure | Click it (legal squares glow green, captures red) |
| Move | Click a highlighted square (click the figure again to deselect) |
| Promotion | Pick one of the four rotating figures on pedestals |
| Camera presets | Ivory / Obsidian / Overhead / Cinematic buttons |
| Skip the intro | Click anywhere during the opening sweep |
| Settings | Gear icon (graphics preset, capture cinematics, board swing, sound) |

## Architecture

Rendering is fully decoupled from the rules: the chess core emits events and the scene
subscribes to them. Nothing in `src/core` imports three.js.

```
src/
  core/            chess state, no rendering
    gameController.ts  owns chess.js, clocks, undo, AI turns, snapshots
    types.ts           shared game types (MoveEvent, GameSnapshot, …)
    emitter.ts         tiny typed event emitter
  ai/
    engine.worker.ts   negamax + alpha-beta + quiescence + iterative deepening
    aiClient.ts        main-thread handle, cancels stale searches
  scene/             three.js only
    sceneEngine.ts     renderer, camera, interaction, move animation, cinematics
    environment.ts     hall, lighting, torches, particles, PMREM environment
    board.ts           tiles, base, engraved labels, highlight pool
    pieces.ts          rigged GLB loading, skeletal clips, faction materials, mixers
    effects.ts         particle bursts, flashes, camera shake
    postfx.ts          EffectComposer pipeline (bloom, SSAO, DOF, grade, SMAA)
    quality.ts         graphics presets + auto-detection
    tween.ts           promise-based tween engine
  ui/                plain React + CSS overlay (menu, HUD, settings, game over)
  audio/             Web Audio mixer with layered score stems
  assets/generated.ts  URLs of the generated models and audio
```

### Move flow

1. The player (or the worker) produces a move → `GameController.tryMove`.
2. chess.js validates it and the controller builds a `MoveEvent` (captures, castling
   rook trip, en passant square, promotion, check flags).
3. The controller awaits the animator the scene registered, so the AI never moves while
   a figure is still gliding.
4. React re-renders from the immutable snapshot published after every change.

### The computer opponent

- **Easy** — random legal move, prefers captures, always takes a mate in one.
- **Medium** — depth 3 negamax with alpha-beta, material + piece-square tables, 0.7s budget.
- **Hard** — depth 5 iterative deepening with alpha-beta, MVV-LVA ordering and quiescence
  on captures, 3.2s budget.

All searches run in `engine.worker.ts`, so the render loop never blocks.

## Graphics presets

| Preset | Post-processing | Shadows | Particles |
| --- | --- | --- | --- |
| Low | none (direct render) | off | none |
| Medium | bloom, grade, SMAA | 1024 | light |
| High | + depth of field in cinematics | 2048 | full |
| Ultra | + SSAO | 4096 | dense |

The preset is auto-detected on first load from the GPU string, core count and memory, and
the engine steps down once automatically if the measured frame rate stays under 40 FPS.
Pixel ratio is capped at 2 (1 on Low), and WebGL context loss shows a reload prompt.

## Character animation

Every figure is a rigged (skinned) character with three skeletal clips, listed per kind in
`PIECE_ANIMATED_MODELS` (`src/assets/generated.ts`):

| Clip | When it plays |
| --- | --- |
| `idle` | Looping combat stance, desynced per figure so the army does not breathe in lockstep |
| `attack` | One-shot strike the moment the attacker lands a capture (sparks, shake and clash sound are timed to the hit frame) |
| `death` | One-shot fall played by the captured figure before it dissolves into dust |

How it is wired (`src/scene/pieces.ts`):

- The **rigged** GLB is the visual — the plain GLB has no skeleton, so clips bound to it do
  nothing. Each animation GLB contributes one clip, renamed to `idle` / `attack` / `death`.
- Every instance is cloned with `SkeletonUtils.clone` (never `Object3D.clone`) and gets its
  own `AnimationMixer`; one-shots use `LoopOnce` + `clampWhenFinished`, and the strike
  crossfades back to the stance on the mixer's `finished` event.
- Clip root motion is stripped on X/Z so a figure never walks off its square; the death clip
  keeps its motion so the fall reads properly.
- The **Low** preset freezes the stance on its first frame (no per-frame mixer cost); strikes
  and deaths still play.

## Swapping in different character models

The static fallback sculpts are referenced by URL in `src/assets/generated.ts`:

```ts
export const PIECE_MODEL_URLS: Record<PieceKind, string> = {
  k: "…king.glb",
  q: "…queen.glb",
  /* … */
};
```

Drop higher-quality glTF/GLB characters into `public/models/` and point the entries at
`/models/your-king.glb`. Requirements:

- Y-up, facing +Z (or edit `PIECE_MODEL_ORIENTATION` in the same file — the loader derives
  the correction quaternion from the declared front/up axes).
- Any scale: `PieceFactory.normalize()` measures the model and rescales it to the height in
  `PIECE_HEIGHT` (`src/scene/pieces.ts`), then centres it on X/Z and grounds it on Y.
- Materials are cloned per instance and tinted per faction in `applyFactionLook()`.

If a rigged model fails to download the loader falls back to the static sculpt, and if that
fails too, to a procedural primitive figure — the game always stays playable.

To animate your own characters, add a `PIECE_ANIMATED_MODELS` entry with a rigged GLB plus a
GLB per clip; any missing clip is simply skipped.

For shipping, compress the GLBs instead of streaming them from a remote host:

```bash
bunx @gltf-transform/cli optimize king.glb public/models/king.glb \
  --compress draco --texture-compress webp --texture-size 1024
```

## Audio

Generated MP3s are streamed once and decoded into Web Audio buffers: an ambience bed, a
score bed and a tension stem that crossfades in during check and the endgame, plus piece,
clash, horn and fanfare one-shots. UI blips are synthesised with oscillators. Everything
routes through one master gain for the mute toggle, and playback only starts after the
first user gesture (browser autoplay policy).
