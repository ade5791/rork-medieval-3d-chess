import * as THREE from "three";

/**
 * Surface detail maps.
 *
 * The material audit found 35 standard materials in the scene and ZERO
 * normal/roughness/AO maps: every stone, tile and metal surface was a flat
 * albedo with one scalar roughness. That reads as plastic at close camera
 * distance no matter how good the lighting is, and it is the missing AUTHORED
 * system - not something a bloom pass can stand in for.
 *
 * Everything here is painted procedurally into canvases at boot, matching the
 * existing zero-download texture policy in `textures.ts`.
 *
 * NOTE ON COLOUR SPACE: a normal map and a roughness map carry DATA, not
 * colour. They must stay in NoColorSpace or three.js will apply an sRGB decode
 * and the decoded normals will be wrong (visibly flattened, wrong tilt).
 */

interface Canvas2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function createCanvas(size: number): Canvas2D {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { canvas, ctx };
}

/** Deterministic value noise so a build always paints the identical texture. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Tileable fractal height field in [0,1]. */
function heightField(size: number, seed: number, octaves: number, gain: number): Float32Array {
  const out = new Float32Array(size * size);
  const rng = makeRng(seed);

  // Build each octave as a tileable lattice with bilinear interpolation.
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    const cells = 4 << o;
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();

    const scale = size / cells;
    for (let y = 0; y < size; y += 1) {
      const fy = y / scale;
      const y0 = Math.floor(fy) % cells;
      const y1 = (y0 + 1) % cells;
      const ty = fy - Math.floor(fy);
      const wy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x += 1) {
        const fx = x / scale;
        const x0 = Math.floor(fx) % cells;
        const x1 = (x0 + 1) % cells;
        const tx = fx - Math.floor(fx);
        const wx = tx * tx * (3 - 2 * tx);

        const a = lattice[y0 * cells + x0];
        const b = lattice[y0 * cells + x1];
        const c = lattice[y1 * cells + x0];
        const d = lattice[y1 * cells + x1];
        const top = a + (b - a) * wx;
        const bottom = c + (d - c) * wx;
        out[y * size + x] += (top + (bottom - top) * wy) * amplitude;
      }
    }
    total += amplitude;
    amplitude *= gain;
  }

  for (let i = 0; i < out.length; i += 1) out[i] /= total;
  return out;
}

/**
 * Sobel a height field into a tangent-space normal map.
 * `strength` is the perceived depth - too high and the surface reads as
 * embossed plastic, so the callers below stay conservative.
 */
function normalFromHeight(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const at = (x: number, y: number): number =>
    height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Sobel gradients.
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));

      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;

      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  // Data map - never sRGB.
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/**
 * Roughness variation from the same height field: crevices hold grime and read
 * rougher, raised faces are worn smoother by handling. A single scalar
 * roughness is what makes a surface look CG, so this breaks it up.
 */
function roughnessFromHeight(
  height: Float32Array,
  size: number,
  low: number,
  high: number,
  seed: number,
): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const rng = makeRng(seed);

  for (let i = 0; i < height.length; i += 1) {
    // Raised (bright) -> smoother/worn, recessed (dark) -> rougher/grimy.
    const worn = 1 - height[i];
    const speckle = (rng() - 0.5) * 0.06;
    const value = Math.max(0, Math.min(1, low + (high - low) * worn + speckle));
    const v = Math.round(value * 255);
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export interface SurfaceMaps {
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

function build(
  size: number,
  seed: number,
  octaves: number,
  gain: number,
  strength: number,
  roughLow: number,
  roughHigh: number,
): SurfaceMaps {
  const height = heightField(size, seed, octaves, gain);
  const normalMap = normalFromHeight(height, size, strength);
  const roughnessMap = roughnessFromHeight(height, size, roughLow, roughHigh, seed ^ 0x9e3779b9);
  return {
    normalMap,
    roughnessMap,
    dispose: () => {
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Cached shared maps. These are read-only data textures used by many materials,
 * so one instance is built per kind and reused - a per-material copy would cost
 * texture memory for no visual gain.
 */
const cache = new Map<string, SurfaceMaps>();

function cached(key: string, make: () => SurfaceMaps): SurfaceMaps {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = make();
  cache.set(key, made);
  return made;
}

/** Pitted, weathered castle stone: flagstone, pillars, curtain wall, rubble. */
export function stoneSurface(): SurfaceMaps {
  return cached("stone", () => build(512, 0x51a3f1, 5, 0.52, 2.6, 0.72, 0.99));
}

/** Polished marble / board tiles: shallow relief, mostly smooth with wear. */
export function marbleSurface(): SurfaceMaps {
  return cached("marble", () => build(512, 0x2bd7c4, 4, 0.45, 0.9, 0.18, 0.55));
}

/** Churned battlefield earth: deep, chaotic relief and uniformly rough. */
export function earthSurface(): SurfaceMaps {
  return cached("earth", () => build(512, 0x7f31ab, 5, 0.58, 3.4, 0.86, 1.0));
}

/** Forged metal: fine hammer texture, low relief, polished high points. */
export function metalSurface(): SurfaceMaps {
  return cached("metal", () => build(256, 0x1c9d55, 4, 0.5, 1.1, 0.22, 0.68));
}

/**
 * Piece edge wear and cavity grime. Fine, high-frequency breakup with a wide
 * roughness spread: high points buff smooth from handling, crevices stay dull
 * with grime. Low relief strength so it never fights the sculpted silhouette.
 */
export function wearSurface(): SurfaceMaps {
  return cached("wear", () => build(256, 0x6ab41d, 5, 0.62, 0.7, 0.26, 0.92));
}

/** Frees every shared map. Called from the engine teardown. */
export function disposeSurfaces(): void {
  for (const entry of cache.values()) entry.dispose();
  cache.clear();
}
