/**
 * Deterministic review states.
 *
 * Query parameters that put the game into a fixed, repeatable visual state so a
 * capture can be diffed pixel-for-pixel between two builds. Nothing here changes
 * how the game renders in normal play: with no query string every field is
 * null/false and the caller keeps its own defaults.
 *
 *   ?era=rome          stage a specific historical era (game mode)
 *   ?arena=dusk        stage a specific battleground
 *   ?quality=ultra     pin a graphics preset (also disables the auto step-down)
 *   ?nopost=1          NO-POST BASELINE GATE - forces a plain forward render
 *   ?cam=white         fix the camera to a named shot
 *   ?review=1          skip the intro, hide the menu, freeze the clock
 *   ?freeze=1          hold animation time at t=0 so captures are reproducible
 *   ?probe=1           expose window.__kg for the capture harness
 *   ?seed=abc          seed the RNG so particle scatter repeats exactly
 *
 * Combat review states - every capture path testable without playing a game:
 *   ?fen=<FEN>         stage an arbitrary position
 *   ?scenario=capture  queen takes a defended pawn (the queen-freeze repro)
 *   ?scenario=mate     back-rank checkmate, one move away
 *   ?scenario=promote  pawn one step from promoting with capture available
 *   ?scenario=castle   both castles legal for white
 *   ?scenario=enpassant  en passant available (capture square != target square)
 */

import type { ArenaTheme } from "./arena";
import { ARENA_ORDER } from "./arena";
import type { EraId } from "./eras";
import { isEraId } from "./eras";
import type { QualityPreset } from "./quality";
import { QUALITY_ORDER } from "./quality";

/**
 * Named positions covering every distinct combat path. Each is one move away
 * from the behaviour it exercises, so a test drives a single move rather than
 * grinding a whole game to reach the interesting state.
 */
export const SCENARIOS: Record<string, { fen: string; play?: [string, string]; note: string }> = {
  // White queen can take the pawn on d7 - the heaviest capture beat, and the
  // exact shape that produced the original queen freeze.
  capture: {
    fen: "rnb1kbnr/ppppqppp/8/8/8/8/PPPQPPPP/RNB1KBNR w KQkq - 0 1",
    play: ["d2", "d7"],
    note: "queen captures - longest authored beat",
  },
  // Back-rank mate in one: Ra8#.
  mate: {
    fen: "6k1/5ppp/8/8/8/8/8/R3K3 w Q - 0 1",
    play: ["a1", "a8"],
    note: "checkmate resolves during the animation",
  },
  // White pawn on b7 may promote, with a capture on a8 also legal.
  promote: {
    fen: "r3k3/1P6/8/8/8/8/8/4K3 w q - 0 1",
    play: ["b7", "a8"],
    note: "promotion by capture - piece swap mid-beat",
  },
  castle: {
    fen: "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1",
    play: ["e1", "g1"],
    note: "castling - two figures move in one event",
  },
  // Black has just played f7-f5; white e5 pawn may take en passant on f6,
  // removing a pawn from f5 - the capture square differs from the target.
  enpassant: {
    fen: "rnbqkbnr/pppp1ppp/8/4Pp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",
    play: ["e5", "f6"],
    note: "en passant - victim square != destination square",
  },
};

export type ScenarioName = keyof typeof SCENARIOS;

export interface ReviewState {
  /** Historical era / game mode to stage. */
  era: EraId | null;
  arena: ArenaTheme | null;
  quality: QualityPreset | null;
  /** Post-processing forced off for the no-post baseline gate. */
  noPost: boolean;
  camera: string | null;
  /** Skip intro and drop straight into a staged board. */
  review: boolean;
  /** Freeze animated time so every capture of a build is identical. */
  freeze: boolean;
  /** Expose the engine on window for the capture harness. */
  probe: boolean;
  /** Hold the quality preset - never step down mid-capture. */
  pinQuality: boolean;
  /** Staged position, from ?fen= or the named scenario. */
  fen: string | null;
  /** Named combat scenario from SCENARIOS. */
  scenario: string | null;
  /** The move that scenario is built to exercise. */
  play: [string, string] | null;
  /** RNG seed so particle scatter is reproducible. */
  seed: string | null;
}

const EMPTY: ReviewState = {
  era: null,
  arena: null,
  quality: null,
  noPost: false,
  camera: null,
  review: false,
  freeze: false,
  probe: false,
  pinQuality: false,
  fen: null,
  scenario: null,
  play: null,
  seed: null,
};

function flag(params: URLSearchParams, key: string): boolean {
  const value = params.get(key);
  if (value === null) return false;
  return value !== "0" && value !== "false";
}

let cached: ReviewState | null = null;

export function readReviewState(): ReviewState {
  if (cached) return cached;
  if (typeof window === "undefined") {
    cached = EMPTY;
    return cached;
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    cached = EMPTY;
    return cached;
  }

  const arenaRaw = params.get("arena");
  const qualityRaw = params.get("quality");

  const arena = arenaRaw && (ARENA_ORDER as string[]).includes(arenaRaw) ? (arenaRaw as ArenaTheme) : null;
  const quality =
    qualityRaw && (QUALITY_ORDER as string[]).includes(qualityRaw) ? (qualityRaw as QualityPreset) : null;

  const scenarioRaw = params.get("scenario");
  const scenario = scenarioRaw && scenarioRaw in SCENARIOS ? scenarioRaw : null;
  const staged = scenario ? SCENARIOS[scenario] : null;

  const eraRaw = params.get("era");

  cached = {
    era: isEraId(eraRaw) ? eraRaw : null,
    fen: params.get("fen") ?? staged?.fen ?? null,
    scenario,
    play: staged?.play ?? null,
    seed: params.get("seed"),
    arena,
    quality,
    noPost: flag(params, "nopost"),
    camera: params.get("cam"),
    review: flag(params, "review"),
    freeze: flag(params, "freeze"),
    probe: flag(params, "probe"),
    // Pinning a preset implies holding it: a step-down mid-capture would
    // silently recompile materials and invalidate the pixel diff.
    pinQuality: quality !== null || flag(params, "pinquality"),
  };
  return cached;
}

/** True when any review parameter is present - used to suppress attract mode. */
export function isReviewSession(): boolean {
  const state = readReviewState();
  return (
    state.review ||
    state.probe ||
    state.noPost ||
    state.freeze ||
    state.fen !== null ||
    state.scenario !== null ||
    state.era !== null
  );
}
