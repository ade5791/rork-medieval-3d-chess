/**
 * Arena themes — the "maps" the board can be staged in.
 *
 * Every value here is read by the hall, the battlefield, the board and the
 * colour grade, so a theme is a complete relight of the scene rather than a
 * brightness slider: sky, fog, stone tints, fire strength, tile contrast and
 * the film grade all move together.
 */

export type ArenaTheme = "dawn" | "frost" | "dusk" | "jungle";

/**
 * Rainforest dressing. Only the jungle map stages it; every other theme carries
 * the same block with `enabled: false` so the overlay can stay a plain group
 * that is repainted and hidden in one call.
 */
export interface FloraLook {
  enabled: boolean;
  /** Crown / mid / shaded canopy greens, brightest at the top. */
  canopySun: number;
  canopy: number;
  canopyDeep: number;
  trunk: number;
  vine: number;
  frond: number;
  temple: { stone: number; moss: number; gold: number };
  /** Sunbeams punched through the canopy. */
  beam: { color: number; opacity: number };
  /** Drifting pollen caught in the light. */
  pollen: { color: number; opacity: number };
}

const NO_FLORA: FloraLook = {
  enabled: false,
  canopySun: 0x7fae3e,
  canopy: 0x4c8733,
  canopyDeep: 0x2c5c2b,
  trunk: 0x574430,
  vine: 0x4c7a35,
  frond: 0x5f9639,
  temple: { stone: 0xb1a583, moss: 0x6a7f4a, gold: 0xe0b34a },
  beam: { color: 0xffe6a6, opacity: 0 },
  pollen: { color: 0xffe9a8, opacity: 0 },
};

export interface ArenaLook {
  id: ArenaTheme;
  label: string;
  note: string;

  // ------------------------------------------------------------ renderer
  exposure: number;
  background: number;
  fog: { color: number; density: number };
  environment: {
    top: number;
    bottom: number;
    glow: number;
    warm: number;
    cool: number;
    intensity: number;
  };

  // ---------------------------------------------------------------- hall
  hemi: { sky: number; ground: number; intensity: number };
  keyLight: { color: number; intensity: number; position: [number, number, number] };
  fill: { color: number; intensity: number; position: [number, number, number] };
  /** Camera-mounted lamp so the near side of every figure stays readable. */
  lamp: { color: number; intensity: number };
  /** Scales the flickering torch point lights and their flame sprites. */
  torch: { intensity: number; flame: number };
  stone: { floor: number; dais: number; pillar: number; wall: number; rubble: number };
  window: { color: number; opacity: number };
  shaft: { color: number; opacity: number };
  dust: { color: number; opacity: number };

  // --------------------------------------------------------- battlefield
  sky: { zenith: number; horizon: number; ember: number };
  /** Multiplier over the ridges' baked vertex colours (may exceed 1). */
  ridge: [number, number, number];
  ground: number;
  /** Scales the camp pyre lights and their glow discs. */
  fire: number;
  smoke: { color: number; opacity: number };
  ash: { color: number; opacity: number };
  troops: { ivory: number; obsidian: number; emissive: number };
  /** Wheeling birds — carrion crows at dusk, scarlet macaws in the canopy. */
  birds: number;
  /** Trebuchet, siege tower, ram and catapult. Off where they make no sense. */
  siegeEngines: boolean;
  flora: FloraLook;

  // --------------------------------------------------------------- board
  board: { light: number; dark: number; base: number; border: number; trim: number };

  // --------------------------------------------------------------- grade
  /**
   * Bloom is what actually blows a daylight map out: the tone-mapped tiles sit
   * near the threshold, so every square starts glowing. Each theme carries its
   * own strength/threshold instead of one dusk-tuned setting for all three.
   */
  bloom: { strength: number; threshold: number; radius: number };
  grade: { vignette: number; grain: number; lift: number; strength: number };
  /** Screen-space CSS vignette strength (0–1). */
  screenVignette: number;
}

export const ARENA_LOOKS: Record<ArenaTheme, ArenaLook> = {
  /**
   * Sun Temple in the rainforest: high tropical sun, jade canopy and gilded
   * limestone. The cool green surround is the complement of the Sun Empire's
   * crimson and gold, so the red army separates from the world instantly.
   */
  jungle: {
    id: "jungle",
    label: "Sun Temple",
    note: "Rainforest temple clearing — jade canopy and gold, the crimson army pops",
    exposure: 0.95,
    background: 0x7fb0c4,
    fog: { color: 0xa6c39b, density: 0.0105 },
    environment: {
      top: 0x4f93c4,
      bottom: 0x6d7a4a,
      glow: 0xe8c479,
      warm: 0xffeec2,
      cool: 0x8cc487,
      intensity: 0.88,
    },
    hemi: { sky: 0x9fd3e8, ground: 0x4c5a34, intensity: 0.95 },
    keyLight: { color: 0xfff2cf, intensity: 2.5, position: [-7, 18, 6] },
    fill: { color: 0x8fbf7a, intensity: 0.7, position: [9, 6, -8] },
    lamp: { color: 0xffeed0, intensity: 0.3 },
    torch: { intensity: 0.4, flame: 0.6 },
    stone: { floor: 0x8d8f76, dais: 0x9a9a7e, pillar: 0x8a8b70, wall: 0x5f6553, rubble: 0x6d7059 },
    window: { color: 0xfff0c0, opacity: 0.52 },
    shaft: { color: 0xffe9a8, opacity: 0.26 },
    dust: { color: 0xffeeb4, opacity: 0.3 },
    sky: { zenith: 0x2f74ad, horizon: 0xdcd6a0, ember: 0x9fc46a },
    ridge: [1.35, 2.5, 1.25],
    ground: 0x5d6a44,
    fire: 0.5,
    smoke: { color: 0x9aa88e, opacity: 0.22 },
    ash: { color: 0xffe8a6, opacity: 0.3 },
    troops: { ivory: 0x6b7a92, obsidian: 0x6a4a3e, emissive: 0.14 },
    birds: 0xd8532c,
    siegeEngines: false,
    flora: {
      enabled: true,
      canopySun: 0x86b842,
      canopy: 0x4f8c33,
      canopyDeep: 0x2d5f2d,
      trunk: 0x5b4732,
      vine: 0x4f7d36,
      frond: 0x63993a,
      temple: { stone: 0xb3a785, moss: 0x6d8149, gold: 0xe2b64c },
      beam: { color: 0xffe6a6, opacity: 0.3 },
      pollen: { color: 0xffe6a0, opacity: 0.42 },
    },
    board: { light: 0xdcd0a8, dark: 0x2f4a3b, base: 0x515a41, border: 0xc3a86a, trim: 0xd7a93f },
    bloom: { strength: 0.26, threshold: 0.92, radius: 0.6 },
    grade: { vignette: 0.55, grain: 0.02, lift: 0.012, strength: 0.68 },
    screenVignette: 0.24,
  },

  /** Golden morning over the courtyard — the clearest read of both armies. */
  dawn: {
    id: "dawn",
    label: "Dawn Court",
    note: "Golden morning light — every figure legible from any angle",
    exposure: 0.92,
    background: 0x8aa8c6,
    fog: { color: 0xaebfd0, density: 0.0085 },
    environment: {
      top: 0x6a90bd,
      bottom: 0xb5a68a,
      glow: 0xe0bb8a,
      warm: 0xe6d8bc,
      cool: 0x91aecd,
      intensity: 0.82,
    },
    hemi: { sky: 0xa8c2e0, ground: 0x7d6e55, intensity: 0.85 },
    keyLight: { color: 0xffeecb, intensity: 2.35, position: [-9, 16, 8] },
    fill: { color: 0x9ab2d2, intensity: 0.62, position: [8, 7, -9] },
    lamp: { color: 0xffefd8, intensity: 0.3 },
    torch: { intensity: 0.45, flame: 0.65 },
    stone: { floor: 0x8d8471, dais: 0x998e78, pillar: 0x8a806d, wall: 0x6b645a, rubble: 0x746d61 },
    window: { color: 0xffeecd, opacity: 0.5 },
    shaft: { color: 0xffe0b4, opacity: 0.16 },
    dust: { color: 0xffeccc, opacity: 0.18 },
    sky: { zenith: 0x3d6ea8, horizon: 0xcaa87f, ember: 0xd08f52 },
    ridge: [1.25, 1.32, 1.5],
    ground: 0x7d7462,
    fire: 0.6,
    smoke: { color: 0x8f8a83, opacity: 0.2 },
    ash: { color: 0xe3bd8b, opacity: 0.24 },
    troops: { ivory: 0x6c7994, obsidian: 0x5e4a44, emissive: 0.16 },
    birds: 0x141317,
    siegeEngines: true,
    flora: NO_FLORA,
    board: { light: 0xd9cfb8, dark: 0x3c4351, base: 0x554d40, border: 0xb2a17c, trim: 0x957336 },
    bloom: { strength: 0.24, threshold: 0.94, radius: 0.6 },
    grade: { vignette: 0.62, grain: 0.022, lift: 0.01, strength: 0.72 },
    screenVignette: 0.28,
  },

  /** Overcast snowfield — cold, flat, maximum contrast on the sculpts. */
  frost: {
    id: "frost",
    label: "Frostfall",
    note: "Snowlit overcast field — cold light, highest contrast",
    exposure: 0.98,
    background: 0xaebccb,
    fog: { color: 0xbcc7d4, density: 0.012 },
    environment: {
      top: 0x8ea3bc,
      bottom: 0xc3ccd6,
      glow: 0x93a5b6,
      warm: 0xdde5ee,
      cool: 0xacbdd0,
      intensity: 0.95,
    },
    hemi: { sky: 0xc3d4e8, ground: 0x969fa9, intensity: 1.2 },
    keyLight: { color: 0xeef4ff, intensity: 2.15, position: [7, 16, -6] },
    fill: { color: 0xb6c3d3, intensity: 0.75, position: [-8, 7, 9] },
    lamp: { color: 0xe6eeff, intensity: 0.28 },
    torch: { intensity: 0.7, flame: 0.9 },
    stone: { floor: 0xa3aab3, dais: 0xadb3bb, pillar: 0x9aa1aa, wall: 0x7c858e, rubble: 0x8b9299 },
    window: { color: 0xf2f7ff, opacity: 0.5 },
    shaft: { color: 0xcfdcee, opacity: 0.14 },
    dust: { color: 0xf2f8ff, opacity: 0.4 },
    sky: { zenith: 0x74889f, horizon: 0xc0c9d3, ember: 0x7c8c9d },
    ridge: [1.55, 1.65, 1.85],
    ground: 0xb0b7c0,
    fire: 0.85,
    smoke: { color: 0xa5abb3, opacity: 0.24 },
    ash: { color: 0xd7e2f0, opacity: 0.38 },
    troops: { ivory: 0x62708a, obsidian: 0x554644, emissive: 0.13 },
    birds: 0x1b1d24,
    siegeEngines: true,
    flora: NO_FLORA,
    board: { light: 0xdae2ec, dark: 0x2f3644, base: 0x4b5260, border: 0xb3bdc8, trim: 0x77869a },
    bloom: { strength: 0.28, threshold: 0.9, radius: 0.62 },
    grade: { vignette: 0.52, grain: 0.018, lift: 0.008, strength: 0.66 },
    screenVignette: 0.22,
  },

  /** The original siege at dusk — dramatic, dark, torch-lit. */
  dusk: {
    id: "dusk",
    label: "Siege at Dusk",
    note: "The original torch-lit hall — moody and dark",
    exposure: 1.05,
    background: 0x07080c,
    fog: { color: 0x171310, density: 0.019 },
    environment: {
      top: 0x141c2c,
      bottom: 0x140d08,
      glow: 0x8a4a1e,
      warm: 0xffb066,
      cool: 0x2e4a8a,
      intensity: 0.75,
    },
    hemi: { sky: 0x4a5f8a, ground: 0x140f0b, intensity: 0.6 },
    keyLight: { color: 0xffd7a1, intensity: 2.7, position: [-9, 15, 7] },
    fill: { color: 0x5f7fbf, intensity: 0.55, position: [8, 6, -9] },
    lamp: { color: 0xffe6c4, intensity: 0.3 },
    torch: { intensity: 1, flame: 1 },
    stone: { floor: 0x6a6155, dais: 0x5b5449, pillar: 0x554e44, wall: 0x2e2a26, rubble: 0x3b352d },
    window: { color: 0xffd9a6, opacity: 0.55 },
    shaft: { color: 0xffffff, opacity: 0.7 },
    dust: { color: 0xffe6bd, opacity: 0.5 },
    sky: { zenith: 0x0a0d1a, horizon: 0x2a1c16, ember: 0xa8481a },
    ridge: [1, 1, 1],
    ground: 0x6b6055,
    fire: 1,
    smoke: { color: 0x6b6560, opacity: 0.3 },
    ash: { color: 0xffb066, opacity: 0.55 },
    troops: { ivory: 0x3a4055, obsidian: 0x342a28, emissive: 0.5 },
    birds: 0x0d0c0f,
    siegeEngines: true,
    flora: NO_FLORA,
    board: { light: 0xf6efe0, dark: 0x2b2f38, base: 0x3b342b, border: 0xbfae8e, trim: 0x8a6a33 },
    bloom: { strength: 0.62, threshold: 0.72, radius: 0.75 },
    grade: { vignette: 1.05, grain: 0.045, lift: 0.02, strength: 1 },
    screenVignette: 0.55,
  },
};

export const ARENA_ORDER: ArenaTheme[] = ["jungle", "dawn", "frost", "dusk"];

export const DEFAULT_ARENA: ArenaTheme = "jungle";
