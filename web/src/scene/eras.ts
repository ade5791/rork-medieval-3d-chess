/**
 * Historical eras - the game modes.
 *
 * An era is a complete period dressing, not a skin: it names the two armies,
 * chooses which battleground (ArenaTheme) stages them, and points at the piece
 * roster that army fields. The existing medieval/Sun-Empire content is era
 * "classic" so nothing about the shipped game changes by default; new eras add
 * their own rosters under `public/models/<era>/`.
 *
 * The roster contract is deliberately identical to `PIECE_ANIMATED_MODELS`, so
 * an era roster is loaded by exactly the same `PieceFactory` path as the
 * built-in armies - no second loader, no second code path to keep in sync.
 *
 * Assets are LOCAL (`/models/...`) rather than vendor URLs on purpose: the
 * generator's URLs are signed and expiring, and an expiring URL must never
 * become the project's asset reference.
 */

import type { PieceKind } from "../core/types";
import type { ArenaTheme } from "./arena";
import type { PieceAnimationSet } from "../assets/generated";

export type EraId = "classic" | "rome";

/** Per-kind roster. A missing kind falls back to the classic army's sculpt. */
export type EraRoster = Partial<Record<PieceKind, PieceAnimationSet>>;

export interface EraDefinition {
  id: EraId;
  /** Shown on the era selector. */
  label: string;
  /** Period sub-title. */
  period: string;
  /** One-line pitch, used as the selector tooltip. */
  note: string;
  /** Battleground this era is staged in by default. */
  arena: ArenaTheme;
  /** Army names, light side then dark side. */
  armies: { w: string; b: string };
  /**
   * Piece roster. `null` means "use the game's built-in per-faction rosters"
   * (the classic era), so the original two civilisations are untouched.
   */
  roster: EraRoster | null;
  /**
   * Display names per kind, so the HUD can call a pawn a "Legionary". Falls
   * back to PIECE_LABEL when a kind is missing.
   */
  titles: Partial<Record<PieceKind, string>>;
}

const ROME_BASE = "/models/rome";

/**
 * Imperial Rome. One sculpted roster fields both armies - the loader's livery
 * pass tints the two sides apart (ivory/steel vs blackened bronze), which is the
 * same mechanism the shipped game already uses when a faction borrows a sculpt.
 *
 * Every entry below was gated before it was written here: structural rig check
 * (single skin, joint count, non-zero clip duration) plus a runtime bind proof
 * with a real AnimationMixer asserting 100% track resolution and measurable
 * joint drift. See `tools/out/bind-report.json`.
 */
const ROME_ROSTER: EraRoster = {
  k: {
    rigged: `${ROME_BASE}/k-rigged.glb`,
    idle: `${ROME_BASE}/k-idle.glb`,
    attack: `${ROME_BASE}/k-attack.glb`,
    death: `${ROME_BASE}/k-death.glb`,
    walk: `${ROME_BASE}/k-walk.glb`,
  },
  q: {
    rigged: `${ROME_BASE}/q-rigged.glb`,
    idle: `${ROME_BASE}/q-idle.glb`,
    attack: `${ROME_BASE}/q-attack.glb`,
    death: `${ROME_BASE}/q-death.glb`,
    walk: `${ROME_BASE}/q-walk.glb`,
  },
  b: {
    rigged: `${ROME_BASE}/b-rigged.glb`,
    idle: `${ROME_BASE}/b-idle.glb`,
    attack: `${ROME_BASE}/b-attack.glb`,
    death: `${ROME_BASE}/b-death.glb`,
    walk: `${ROME_BASE}/b-walk.glb`,
  },
  r: {
    rigged: `${ROME_BASE}/r-rigged.glb`,
    idle: `${ROME_BASE}/r-idle.glb`,
    attack: `${ROME_BASE}/r-attack.glb`,
    death: `${ROME_BASE}/r-death.glb`,
    walk: `${ROME_BASE}/r-walk.glb`,
  },
  p: {
    rigged: `${ROME_BASE}/p-rigged.glb`,
    idle: `${ROME_BASE}/p-idle.glb`,
    attack: `${ROME_BASE}/p-attack.glb`,
    death: `${ROME_BASE}/p-death.glb`,
    walk: `${ROME_BASE}/p-walk.glb`,
  },
};

export const ERAS: Record<EraId, EraDefinition> = {
  classic: {
    id: "classic",
    label: "Age of Kings",
    period: "Medieval - 12th century",
    note: "The original two civilisations: the Ivory Kingdom against the Sun Empire",
    arena: "jungle",
    armies: { w: "Ivory Kingdom", b: "Sun Empire" },
    roster: null,
    titles: {},
  },
  rome: {
    id: "rome",
    label: "Imperial Rome",
    period: "Antiquity - 1st century",
    note: "Legion against legion on the frozen frontier - lorica, laurel and the eagle",
    // Frost stages the frontier campaign: cold grey daylight separates bronze
    // and crimson far better than the jungle's green surround.
    arena: "frost",
    armies: { w: "Legio I Aquila", b: "Legio X Corvus" },
    roster: ROME_ROSTER,
    titles: {
      p: "Legionary",
      n: "Eques",
      b: "Augur",
      r: "Praetorian",
      q: "Vestal Oracle",
      k: "Imperator",
    },
  },
};

export const ERA_ORDER: EraId[] = ["classic", "rome"];

export const DEFAULT_ERA: EraId = "classic";

export function isEraId(value: unknown): value is EraId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERAS, value);
}
