# King's Gambit — Medieval 3D Chess

A cinematic 3D chess game in the browser. Two rival civilisations — a medieval European
**Ivory Kingdom** and a Mesoamerican **Sun Empire** — face each other as sculpted, rigged
characters that glide, strike, scream and burn away into dust on a marble-and-basalt board.

Built with **Vite + React 19 + TypeScript + three.js**, [chess.js](https://github.com/jhlywa/chess.js)
for the rules, and a **Web Worker** search engine for the computer opponent. No backend, no
account, no build-time asset pipeline — it is a static site.

```bash
cd web && bun install && bun run dev
```

---

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
- [Controls](#controls)
- [Game modes](#game-modes)
- [Battlegrounds](#battlegrounds)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [The computer opponent](#the-computer-opponent)
- [Graphics presets](#graphics-presets)
- [Character animation](#character-animation)
- [Swapping in your own models](#swapping-in-your-own-models)
- [Audio](#audio)
- [Scripts](#scripts)
- [Browser support](#browser-support)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Full chess rules** — castling, en passant, promotion, check, checkmate, stalemate,
  threefold repetition, the fifty-move rule and insufficient material, all via chess.js.
- **Rigged 3D characters, not chess pieces** — twelve sculpts (six per army), each with
  `idle`, `walk`, `attack` and `death` skeletal clips, plus weapons, shields and a floating
  rank crest.
- **Figures march, they do not slide** — a moved piece turns to face its destination, walks
  the distance on its own legs at the cadence of its rank, and squares up again on arrival.
  Knights keep the leap, running through the air and landing on both feet.
- **Synthesised footsteps on the stride clock** — every footfall is fired by the same clock
  that retimes the walk cycle, so sound, grit puff and foot all land together: scuffs for
  footsoldiers, leather for the clergy, plate for the tower guardians, a slow deliberate
  tread for the crown.
- **Cinematic captures** — the camera punches in, the attacker strikes on the hit frame,
  sparks fly, the screen shakes, and the defender **burns away from the soles upward**
  through a ragged edge of light, shedding motes that drift off (cold soul-light for the
  Kingdom, live embers for the Empire).
- **Casters kill at range** — the queen and the mage never close the distance. They level the
  staff from their own square, gather fire at the crystal, and throw a ball of it down the
  line: it lights the hall as it flies, breaks open on the body, and only once the corpse has
  burned away do they walk the whole distance and take the square (cold witchfire for the
  Kingdom, sunfire for the Empire).
- **Twelve death cries** — one recorded voice per rank per army, panned to where the body is
  on screen, ducking the music for a beat and pitch-jittered so no two deaths sound alike.
- **Four battlegrounds** that relight the whole world — sky, haze, stone colour, tile
  contrast, fires, birds, siege engines and the film grade.
- **2D tactical view** — one key lifts the camera straight overhead and flattens every figure
  into a stamped counter, so nothing can hide a square. Selection and drag keep working.
- **Three engine strengths** running off the main thread, so the render loop never blocks.
- **Showcase / attract mode** — let two engines duel on their own with pace control, pause,
  auto-rematch, and a clean capture view with the entire interface hidden.
- **Auto-detected graphics presets** (Low → Ultra) with an automatic step-down if the
  measured frame rate stays low, plus WebGL context-loss recovery.
- **Chess clocks**, undo, resign, flip board, copyable PGN, captured tray with material score.

## Quick start

Requires **Node 20+**. [Bun](https://bun.sh) is recommended; npm/pnpm work too.

```bash
git clone <your-fork-url>
cd <repo>/web

bun install
bun run dev        # http://localhost:5173
bun run build      # production bundle in web/dist/
bun run preview    # serve the built bundle
```

The build output in `web/dist/` is a plain static site — drop it on GitHub Pages, Netlify,
Cloudflare Pages or any static host. No environment variables are required to run the game.

## Controls

| Action | Input |
| --- | --- |
| Orbit / zoom | Drag, mouse wheel (one-finger drag and pinch on touch) |
| Select a figure | Click it — legal squares glow green, captures red |
| Move | Click a highlighted square, or drag the figure onto it |
| Promotion | Pick one of the four figures rotating on pedestals |
| Camera presets | Ivory / Obsidian / Overhead / Cinematic buttons in the HUD |
| Skip the intro | Click anywhere during the opening sweep |
| Settings | Gear icon — battleground, graphics preset, capture cinematics, board swing, sound |

Keyboard shortcuts (ignored while typing in a field):

| Key | Action |
| --- | --- |
| `F` | Flip the camera to the other side |
| `T` | Toggle the 2D tactical view |
| `C` | Toggle cinema mode (hide the entire interface) |
| `Space` | Pause / resume playback in showcase mode |
| `Esc` | Close the settings panel |

## Game modes

| Mode | What it is |
| --- | --- |
| **Player vs Computer** | Pick your colour, an engine strength and an optional clock |
| **Two players** | Hotseat on one screen; the camera swings round between turns (switchable) |
| **Showcase** | Two engines duel on their own — per-side strength, 0.5×–4× pace, auto-rematch |
| **Attract** | Leave the menu alone for 30 seconds and a showcase duel starts behind it |

Clocks: none, 5, 10 or 15 minutes, drawn as draining hourglasses.

## Battlegrounds

Switchable at any time from the camera menu or Settings; each one is a complete relight.

| Id | Name | Look |
| --- | --- | --- |
| `jungle` | **Sun Temple** (default) | Rainforest clearing, jade canopy, drifting pollen, two gold-crowned step pyramids |
| `dawn` | **Dawn Court** | Golden morning light, pale sky, warm stone — highest legibility |
| `frost` | **Frostfall** | Overcast snowfield, cold flat light, hardest contrast on the sculpts |
| `dusk` | **Siege at Dusk** | The original torch-lit siege — moodiest, heaviest bloom |

## Project structure

```
.
├── rork.json               workspace manifest (one app: web/)
├── scripts/
│   └── rewrite-commit-messages.sh
└── web/
    ├── index.html
    ├── public/             icon, favicon, robots.txt (drop local .glb models here)
    └── src/
        ├── core/           chess state — never imports three.js
        │   ├── gameController.ts   owns chess.js, clocks, undo, AI turns, snapshots
        │   ├── types.ts            MoveEvent, GameSnapshot, LedgerMove, …
        │   └── emitter.ts          tiny typed event emitter
        ├── ai/
        │   ├── engine.worker.ts    negamax + alpha-beta + quiescence + iterative deepening
        │   └── aiClient.ts         main-thread handle, cancels stale searches
        ├── scene/          three.js only
        │   ├── sceneEngine.ts      renderer, camera, interaction, move animation, cinematics
        │   ├── environment.ts      hall, lighting, torches, particles, PMREM environment
        │   ├── arena.ts            the four battleground looks and their ordering
        │   ├── battlefield.ts      siege props, camps, fires, birds
        │   ├── jungle.ts           canopy, palms, vines, pollen for the Sun Temple
        │   ├── board.ts            tiles, base, engraved labels, highlight pool
        │   ├── pieces.ts           rigged GLB loading, clips, faction materials, mixers
        │   ├── weapons.ts          procedural arms, shields and staves per rank
        │   ├── rankBadges.ts       floating heraldic crests
        │   ├── effects.ts          particle bursts, flashes, dissolve, camera shake
        │   ├── postfx.ts           EffectComposer pipeline (bloom, SSAO, DOF, grade, SMAA)
        │   ├── textures.ts         procedural marble, basalt, bronze, cloth
        │   ├── quality.ts          graphics presets + auto-detection
        │   └── tween.ts            promise-based tween engine
        ├── ui/             React + CSS overlay (menu, HUD, ledger, settings, game over)
        ├── audio/          Web Audio mixer with layered score stems
        ├── assets/         URLs of the generated models and audio
        └── components/ui/  shadcn/ui primitives
```

## Architecture

Rendering is fully decoupled from the rules: **the chess core emits events and the scene
subscribes to them.** Nothing in `src/core` imports three.js, so the game logic is testable
headlessly and the renderer is replaceable.

### Move flow

1. The player (or the worker) produces a move → `GameController.tryMove`.
2. chess.js validates it and the controller builds a `MoveEvent` — captures, the castling
   rook trip, the en passant square, promotion and check flags.
3. The controller **awaits the animator the scene registered**, so the engine never moves
   while a figure is still gliding.
4. React re-renders from the immutable `GameSnapshot` published after every change.

### State

There is exactly one source of truth (`GameController`). React reads it through the
`useGameSnapshot` hook, which subscribes to the emitter and returns the latest snapshot —
no global store, no prop drilling of game state into the scene.

## The computer opponent

| Difficulty | Search | Budget |
| --- | --- | --- |
| **Easy** — *Squire* | Random legal move, prefers captures, always takes a mate in one | instant |
| **Medium** — *Knight* | Depth 3 negamax + alpha-beta, material + piece-square tables | 0.7 s |
| **Hard** — *Warlord* | Depth 5 iterative deepening, MVV-LVA ordering, quiescence on captures | 3.2 s |

All searches run inside `engine.worker.ts`. `aiClient.ts` cancels a stale search whenever the
position changes, so undo and resign are instant.

## Graphics presets

| Preset | Post-processing | Shadow map | Particles |
| --- | --- | --- | --- |
| Low | none (direct render) | off | none |
| Medium | bloom, grade, SMAA | 1024 | light |
| High | + depth of field in cinematics | 2048 | full |
| Ultra | + SSAO | 4096 | dense |

The preset is auto-detected on first load from the GPU string, core count and device memory.
The engine steps down one level automatically if the measured frame rate stays under 40 FPS.
Pixel ratio is capped at 2 (1 on Low), and a lost WebGL context shows a reload prompt instead
of a black screen.

## Character animation

Every figure is a rigged (skinned) character with up to five skeletal clips, declared per rank
in `PIECE_ANIMATED_MODELS` (`src/assets/generated.ts`):

| Clip | When it plays |
| --- | --- |
| `idle` | Looping combat stance, desynced per figure so the army does not breathe in lockstep |
| `walk` | Looping in-place stride, retimed to the cadence of the move that is under way |
| `run` | Looping in-place run — the knight charging through its leap (knights only) |
| `attack` | One-shot strike the moment a capture lands — sparks, shake and clash are timed to the hit frame. For the queen and the mage the same clip is the incantation, and its hit frame is the moment the fireball is released |
| `death` | One-shot fall played by the captured figure before it dissolves into dust |

How it is wired (`src/scene/pieces.ts`):

- The **rigged** GLB is the visual — the plain GLB has no skeleton, so clips bound to it do
  nothing. Each animation GLB contributes one clip, renamed to `idle` / `walk` / `run` /
  `attack` / `death`.
- Every instance is cloned with `SkeletonUtils.clone` (never `Object3D.clone`) and gets its
  own `AnimationMixer`. One-shots use `LoopOnce` + `clampWhenFinished`, and the strike
  crossfades back to the stance on the mixer's `finished` event.
- Clip root motion is stripped on X/Z so a figure never walks off its square; the death clip
  keeps its motion so the fall reads properly. The locomotion clips are **in-place** cycles for
  the same reason — board travel is owned by the container tween, so a clip carrying root
  translation would double the distance.
- The **Low** preset freezes the stance on its first frame (no per-frame mixer cost) — strikes
  and deaths still play, and the figure slides instead of marching (footsteps still sound).

### Marching and footsteps

`SceneEngine.glide()` owns one stride clock per move (`src/scene/sceneEngine.ts`):

1. `GAITS[kind]` declares steps per square, cadence, boot timbre and loudness for the rank.
2. `steps = tiles × stepsPerTile`, and the move's duration is `steps / cadence` — a longer
   move takes **more steps**, not a faster slide.
3. `PieceView.startMarch(clip, stepRate)` retimes the walk cycle so one gait cycle equals two
   footfalls at exactly that rate, so the skeleton cannot drift out of the clock.
4. `strideEasing()` gives the move a push-off, a constant-speed cruise and a settle. A fully
   eased curve would leave the feet skating at both ends against a fixed cadence.
5. Each whole step crossing fires `audio.footstep()` (panned by screen position, alternating
   feet, pitch-jittered) plus a small grit puff at the contact point.

Footsteps are fully synthesised in `src/audio/audioManager.ts` — a low body thump for the
weight, a band-passed noise transient for the sole, and a metallic afterring for armour, one
voice per `FootstepTimbre` (`scuff` / `leather` / `plate` / `regal`). No asset, no latency.

### Ranged combat (queen and mage)

`RANGED_KINDS` in `src/scene/sceneEngine.ts` routes captures by the queen (`q`) and the mage
(`b`) to `playSpellCinematic()` instead of the melee beat, in this order:

1. Caster and target turn to face each other; the caster does not move off its square.
2. `gatherSpell()` grows a `SpellOrb` (`src/scene/spells.ts`) at the weapon's casting point
   for the length of the strike clip's wind-up, pulling embers inward over a rising charge.
3. `throwFireball()` flies the orb to the target's chest on a flat arc, shedding embers and
   smoke; flight time scales with the distance actually crossed.
4. `spellBurst()` lands it — flash, fire shell, ember cloud, square impact and camera kick.
5. `slay()` then `banish()` run to completion, so the target is **dead and gone** before the
   caster takes a step, and only then does `glide()` march it onto the cleared square.

The casting point is a marker parented at the head of the main weapon (`focus` in
`src/scene/weapons.ts`), read out of the live pose each frame, so the fire hangs off the
crystal wherever the casting arm swings it. `SPELL_LOOK` gives each army its own fire, and the
orb carries a real point light on presets with post-processing. The three spell voices (charge,
cast, impact) are synthesised alongside the footsteps — no assets.

The capture dissolve is a shader injection: a noise field eats the body from the soles up with
a glowing burn edge, while the whole mesh fades and sheds upward-drifting motes.

## Swapping in your own models

The sculpts are referenced by URL in `src/assets/generated.ts`:

```ts
export const PIECE_MODEL_URLS: Record<Faction, Roster<string>> = {
  w: { k: "…king.glb", q: "…queen.glb", /* … */ },
  b: { /* … */ },
};
```

Drop glTF/GLB characters into `web/public/models/` and point the entries at
`/models/your-king.glb`. Requirements:

- **Orientation** — Y-up, facing +Z, or edit `PIECE_MODEL_ORIENTATION` in the same file; the
  loader derives the correction quaternion from the declared front/up axes.
- **Scale** — any. `PieceFactory.normalize()` measures the model, rescales it to the height in
  `PIECE_HEIGHT` (`src/scene/pieces.ts`), centres it on X/Z and grounds it on Y.
- **Materials** are cloned per instance and tinted per faction in `applyFactionLook()`.

If a rigged model fails to download the loader falls back to the static sculpt, and if that
fails too, to a procedural primitive figure — **the game always stays playable**.

To animate your own characters, add a `PIECE_ANIMATED_MODELS` entry with a rigged GLB plus one
GLB per clip; any missing clip is simply skipped (no `walk` clip just means that rank slides).

For shipping, compress the GLBs instead of streaming them from a remote host:

```bash
bunx @gltf-transform/cli optimize king.glb public/models/king.glb \
  --compress draco --texture-compress webp --texture-size 1024
```

## Audio

MP3s are streamed once and decoded into Web Audio buffers: an ambience bed, a score bed and a
tension stem that crossfades in during check and the endgame, plus place, capture, check-horn
and fanfare one-shots. The twelve death cries in `DEATH_CRY_URLS` are lazily loaded after the
mixer unlocks, since they are only needed on a capture; each is a real one-second take, panned
by the dying figure's screen position and pitch-jittered per playback.

Footsteps, the wooden set-down knock, body falls and UI blips are synthesised with oscillators
and noise buffers — no files. Everything routes through one master gain
for the mute toggle, and playback only starts after the first user gesture (browser autoplay
policy).

> **Note on hosted assets.** Out of the box, the models and audio are streamed from remote
> URLs listed in `src/assets/generated.ts`. If you fork this for production, mirror them into
> `web/public/` and update those constants so your build does not depend on someone else's CDN.

## Scripts

Run from `web/`:

| Script | What it does |
| --- | --- |
| `bun run dev` | Vite dev server with HMR |
| `bun run build` | Type-checked production build into `dist/` |
| `bun run preview` | Serve the production build locally |
| `bun run lint` | ESLint over the whole project |
| `bun run test` | Node unit tests **and** the Playwright-backed browser tests |
| `bun run test:watch` | Vitest in watch mode |
| `bun run test:browser` | Browser-mode Vitest only |

## Browser support

Any browser with **WebGL 2** and **Web Audio**: current Chrome, Edge, Firefox and Safari 16+,
on desktop and tablet. Touch orbit, pinch zoom and drag-to-move are supported; on narrow
screens the move ledger folds into a corner button so the board keeps the whole viewport.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
workflow, coding conventions and the **English Conventional Commits** message format used in
this repository.

## License

[MIT](LICENSE) © the King's Gambit contributors.

Bundled dependencies keep their own licences: three.js (MIT), chess.js (BSD-2-Clause),
React (MIT), Tailwind CSS (MIT), Radix UI / shadcn/ui (MIT), lucide (ISC).

The 3D characters and audio shipped with the project were generated for it and may be reused
under the same terms; if you replace them, credit the new authors here.
