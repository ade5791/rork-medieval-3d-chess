/** Graphics presets. Each one genuinely changes cost, not just a label. */

export type QualityPreset = "low" | "medium" | "high" | "ultra";

export interface QualitySettings {
  postFx: boolean;
  bloom: boolean;
  ssao: boolean;
  /** Depth of field is only ever enabled during cinematic moments. */
  dof: boolean;
  grade: boolean;
  smaa: boolean;
  msaaSamples: number;
  shadows: boolean;
  shadowMapSize: number;
  contactShadows: boolean;
  lightShafts: boolean;
  dustCount: number;
  emberCount: number;
  maxPixelRatio: number;
  captureParticles: number;
  /** Looping skeletal idle on every figure (one-shots always play). */
  characterAnimations: boolean;
  /** Instanced silhouette soldiers drawn up per distant army. */
  troopCount: number;
  /** Lit camp pyres outside the walls (each one is a real point light). */
  campfires: number;
  ashCount: number;
  smokeCount: number;
  /** Siege engines, banners, battlefield debris and circling crows. */
  battleProps: boolean;
}

export const QUALITY_SETTINGS: Record<QualityPreset, QualitySettings> = {
  low: {
    postFx: false,
    bloom: false,
    ssao: false,
    dof: false,
    grade: false,
    smaa: false,
    msaaSamples: 0,
    shadows: false,
    shadowMapSize: 512,
    contactShadows: true,
    lightShafts: false,
    dustCount: 0,
    emberCount: 0,
    maxPixelRatio: 1,
    captureParticles: 18,
    characterAnimations: false,
    troopCount: 60,
    campfires: 0,
    ashCount: 0,
    smokeCount: 24,
    battleProps: false,
  },
  medium: {
    postFx: true,
    bloom: true,
    ssao: false,
    dof: false,
    grade: true,
    smaa: true,
    msaaSamples: 0,
    shadows: true,
    shadowMapSize: 1024,
    contactShadows: true,
    lightShafts: true,
    dustCount: 220,
    emberCount: 60,
    maxPixelRatio: 1.5,
    captureParticles: 34,
    characterAnimations: true,
    troopCount: 140,
    campfires: 2,
    ashCount: 70,
    smokeCount: 45,
    battleProps: true,
  },
  high: {
    postFx: true,
    bloom: true,
    ssao: false,
    dof: true,
    grade: true,
    smaa: true,
    msaaSamples: 4,
    shadows: true,
    shadowMapSize: 2048,
    contactShadows: true,
    lightShafts: true,
    dustCount: 520,
    emberCount: 120,
    maxPixelRatio: 2,
    captureParticles: 60,
    characterAnimations: true,
    troopCount: 240,
    campfires: 3,
    ashCount: 130,
    smokeCount: 65,
    battleProps: true,
  },
  ultra: {
    postFx: true,
    bloom: true,
    ssao: true,
    dof: true,
    grade: true,
    smaa: true,
    msaaSamples: 4,
    shadows: true,
    shadowMapSize: 4096,
    contactShadows: true,
    lightShafts: true,
    dustCount: 900,
    emberCount: 190,
    maxPixelRatio: 2,
    captureParticles: 90,
    characterAnimations: true,
    troopCount: 320,
    campfires: 4,
    ashCount: 220,
    smokeCount: 90,
    battleProps: true,
  },
};

export const QUALITY_ORDER: QualityPreset[] = ["low", "medium", "high", "ultra"];

/**
 * First-run guess from the GPU string, core count and memory. The engine then
 * measures real frame times for a few seconds and steps down if needed.
 */
export function detectQualityPreset(): QualityPreset {
  if (typeof window === "undefined") return "high";
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

  let renderer = "";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)).toLowerCase();
    }
  } catch {
    renderer = "";
  }

  const weakGpu = /(swiftshader|llvmpipe|software|mali-4|adreno \(tm\) [345]|intel.*hd graphics [2-4])/.test(renderer);
  const strongGpu = /(rtx|radeon rx|apple m[1-9]|geforce gtx 1[06-9]|arc a)/.test(renderer);

  if (weakGpu || cores <= 2 || memory <= 2) return "low";
  if (isTouch) return cores >= 8 && memory >= 6 ? "medium" : "low";
  if (strongGpu && cores >= 8 && memory >= 8) return "ultra";
  if (cores >= 6 && memory >= 4) return "high";
  return "medium";
}
