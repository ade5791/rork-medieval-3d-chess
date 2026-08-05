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
 *
 * ROSTER COVERAGE IS DELIBERATE, NOT ACCIDENTAL. A missing kind silently falls
 * back to the classic sculpt, which is how a "new era" ships looking half
 * medieval. `rosterCoverage()` below makes that measurable, and the era gate
 * asserts every figure on the board is a real skinned rig - so a gap is caught
 * by a failing check rather than noticed later in a screenshot.
 */

import type { PieceKind } from "../core/types";
import type { ArenaTheme } from "./arena";
import type { PieceAnimationSet } from "../assets/generated";

export type EraId = "classic" | "rome" | "sengoku" | "egypt";

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

/** Every kind a full roster must sculpt. */
export const ROSTER_KINDS: PieceKind[] = ["k", "q", "b", "n", "r", "p"];

/** The four clips the opening needs from every sculpt. */
const CLIP_NAMES = ["idle", "attack", "death", "walk"] as const;

/**
 * Builds a roster from a flat kind list, so adding an era is one line rather
 * than sixty of copy-pasted paths. Every entry resolves to
 * `/models/<era>/<kind>-<clip>.glb`, which is exactly what
 * `tools/build-era-roster.mjs` writes after it has gated the bytes.
 */
/**
 * Public asset root. `/` in dev and on a domain-root deploy, `/<repo>/` when
 * the site is published to a GitHub Pages project subpath. Always ends in a
 * slash, so callers concatenate directly.
 */
export function assetBase(): string {
  const base = import.meta.env?.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}
function roster(era: string, kinds: PieceKind[]): EraRoster {
  const out: EraRoster = {};
  for (const kind of kinds) {
    const base = `${assetBase()}models/${era}/${kind}`;
    const set = { rigged: `${base}-rigged.glb` } as PieceAnimationSet;
    for (const clip of CLIP_NAMES) set[clip] = `${base}-${clip}.glb`;
    out[kind] = set;
  }
  return out;
}

/**
 * Imperial Rome. One sculpted roster fields both armies - the loader's livery
 * pass tints the two sides apart (ivory/steel vs blackened bronze), which is the
 * same mechanism the shipped game already uses when a faction borrows a sculpt.
 *
 * Rome originally shipped WITHOUT a knight, so every Roman cavalry square
 * silently fielded a medieval figure through the classic fallback. The Eques
 * closes that gap, and the provenance gate now fails if any such gap returns.
 *
 * Every entry below was gated before it was written here: structural rig check
 * (single skin, joint count, non-zero clip duration) plus a runtime bind proof
 * with a real AnimationMixer asserting 100% track resolution and measurable
 * joint drift. See `tools/out/bind-report.json`.
 */
const ROME_ROSTER: EraRoster = roster("rome", ROSTER_KINDS);

/**
 * Sengoku Japan. A COMPLETE six-kind roster - including the mounted kind that
 * Rome lacks - so no figure on the board falls back to a medieval sculpt.
 *
 * Staged at dusk: the torch-lit hall is the one map whose warm key light and
 * deep shadow read lacquered armour the way the period's own screens do, and
 * it separates a red-lacquer army from a black-lacquer one far better than
 * flat daylight.
 */
const SENGOKU_ROSTER: EraRoster = roster("sengoku", ROSTER_KINDS);

/**
 * New Kingdom Egypt. Also a complete six-kind roster.
 *
 * Staged at dawn: low golden light is what makes gold leaf, lapis and white
 * pleated linen legible, and it is the only map whose horizon tint matches
 * the period's own palette without fighting the crimson/gold armies.
 */
const EGYPT_ROSTER: EraRoster = roster("egypt", ROSTER_KINDS);

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
  sengoku: {
    id: "sengoku",
    label: "Sengoku Japan",
    period: "Feudal - 16th century",
    note: "Two warring clans by torchlight - lacquered armour, naginata and the daisho",
    arena: "dusk",
    armies: { w: "Shirahata Clan", b: "Kurogane Clan" },
    roster: SENGOKU_ROSTER,
    titles: {
      p: "Ashigaru",
      n: "Samurai Cavalry",
      b: "Sohei Monk",
      r: "Castle Guard",
      q: "Onna-bugeisha",
      k: "Daimyo",
    },
  },
  egypt: {
    id: "egypt",
    label: "New Kingdom Egypt",
    period: "Bronze Age - 14th century BC",
    note: "Two dynasties at sunrise - gold, lapis and linen under the Aten",
    arena: "dawn",
    armies: { w: "House of Ra", b: "House of Set" },
    roster: EGYPT_ROSTER,
    titles: {
      p: "Medjay",
      n: "Charioteer",
      b: "High Priest",
      r: "Temple Guardian",
      q: "Great Royal Wife",
      k: "Pharaoh",
    },
  },
};

export const ERA_ORDER: EraId[] = ["classic", "rome", "sengoku", "egypt"];

export const DEFAULT_ERA: EraId = "classic";

export function isEraId(value: unknown): value is EraId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERAS, value);
}

/**
 * Which kinds an era actually sculpts, and which fall back to a classic
 * figure. Consumed by the era gate so a half-dressed roster fails a check
 * instead of shipping as a visual surprise.
 */
export function rosterCoverage(era: EraId): {
  era: EraId;
  sculpted: PieceKind[];
  missing: PieceKind[];
  complete: boolean;
} {
  const roster = ERAS[era]?.roster;
  if (!roster) {
    // Classic uses the built-in per-faction rosters, which are complete by
    // definition - it is the content every other era falls back TO.
    return { era, sculpted: [...ROSTER_KINDS], missing: [], complete: true };
  }
  const sculpted = ROSTER_KINDS.filter((kind) => Boolean(roster[kind]));
  const missing = ROSTER_KINDS.filter((kind) => !roster[kind]);
  return { era, sculpted, missing, complete: missing.length === 0 };
}
