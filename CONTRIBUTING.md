# Contributing

Thanks for taking an interest in King's Gambit. This document covers the workflow, the coding
conventions and — importantly for this repository — the **commit message format**.

## Getting set up

```bash
cd web
bun install
bun run dev
```

Before opening a pull request:

```bash
bun run lint
bun run build     # type-checks as part of the build
bun run test
```

All three must pass. The project is strict TypeScript — no `any`, no `@ts-ignore` without a
one-line justification.

## Commit messages

**All commit messages in this repository are written in English**, using
[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short imperative summary>

<optional body explaining the why, wrapped at 72 columns>
```

Types in use:

| Type | For |
| --- | --- |
| `feat` | A new capability the player can see or use |
| `fix` | A bug fix |
| `perf` | Frame rate, load time, memory |
| `refactor` | Internal change with no behavioural difference |
| `style` | Visual/CSS-only or formatting changes |
| `docs` | README and other documentation |
| `test` | Tests only |
| `chore` | Tooling, dependencies, housekeeping |

Common scopes: `scene`, `pieces`, `board`, `audio`, `ai`, `ui`, `hud`, `assets`, `build`.

Examples:

```
feat(scene): burn-away dissolve for captured figures
fix(ui): clamp the settings panel to the viewport and add a scrollbar
perf(pieces): freeze idle mixers on the Low preset
docs: english README for the open-source release
```

Rules of thumb:

- Imperative mood — "add", not "added" or "adds".
- Summary line ≤ 72 characters, no trailing period.
- One logical change per commit; keep generated-asset URL updates in their own commit.

### Translating existing history

Commits made before the open-source release were written in Vietnamese. If you are preparing
a fresh public repository, run the helper script from the repository root to rewrite every
message into English:

```bash
./scripts/rewrite-commit-messages.sh
```

Read the script's warning first — it rewrites history and therefore changes every commit hash.
Only run it on a repository you have not shared yet, or coordinate a force-push with everyone
who has a clone.

## Coding conventions

- **Keep the rules and the renderer apart.** Nothing in `src/core` may import three.js. The
  scene subscribes to `GameController` events; it never reaches into chess state directly.
- **One responsibility per scene module.** New visual systems get their own file in
  `src/scene/` rather than growing `sceneEngine.ts`.
- **Respect the quality presets.** Any new effect must declare what it does on Low — ideally
  nothing at all. Check `src/scene/quality.ts` before adding per-frame work.
- **Dispose what you create.** Geometries, materials, textures and render targets are released
  in the owning module's `dispose()`; leaks show up fast when battlegrounds are switched.
- **No blocking work on the main thread.** Search and other heavy computation belong in a
  worker.
- **Explicit types.** `useState<Thing[]>([])`, not `useState([])`. Literal style values are
  typed with `as const`.
- **React optimisation is manual** — this project does not use the React Compiler. Use
  `memo`, `useMemo` and `useCallback` with honest dependency arrays.
- **Icons** come from `lucide-react`; shared primitives from `src/components/ui`.
- Comment the non-obvious (a shader trick, a browser quirk) and nothing else.

## Assets

Models and audio are referenced by URL in `src/assets/generated.ts`. When contributing new
assets:

- Add them under `web/public/models/` or `web/public/audio/` and reference them with a
  root-relative path.
- Compress GLBs (`@gltf-transform/cli optimize … --compress draco --texture-compress webp`).
- State the licence and the author of anything you did not make yourself in the pull request.

## Pull requests

- Branch from `main`, one topic per branch.
- Describe what changed and, for anything visual, attach a short screen capture — this is a
  graphics project and a clip says more than a paragraph.
- Note the presets you tested on (at minimum Low and your own auto-detected preset).

## Reporting bugs

Include your browser and OS, the graphics preset, the battleground, and — for rendering
issues — the output of `chrome://gpu` or the equivalent. A FEN or the copied PGN from the
game-over panel makes chess-logic bugs reproducible in seconds.
