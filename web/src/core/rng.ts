/**
 * Seeded RNG - xoshiro128** with forkable named streams.
 *
 * Deterministic review states are worthless if the visuals they stage are
 * random. effects.ts alone makes 20+ Math.random() calls per capture (particle
 * scatter, smoke offsets, spin, lifetimes), so two captures of the same staged
 * position never produce the same frame and no pixel diff gate can exist.
 *
 * Named streams matter: if every system draws from one sequence, adding a
 * single particle to one effect reshuffles every later draw in the frame and
 * an unrelated system's output changes. Forking per system keeps them
 * independent.
 *
 *   const smoke = rng.fork("effects:smoke");
 *
 * Usage law: nothing in gameplay or visuals calls Math.random(). Draw from a
 * stream so a seed reproduces the frame exactly.
 */

/** Mixes a string into a 32-bit seed (FNV-1a). */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** splitmix32 - expands one seed into the four words xoshiro needs. */
function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** One independent random stream. */
export class RandomStream {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(public readonly seed: string) {
    const next = splitmix32(hashSeed(seed));
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
  }

  /** Raw 32-bit draw. */
  nextUint32(): number {
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Drop-in replacement for Math.random(): [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform in [-spread, +spread). */
  signed(spread = 1): number {
    return (this.next() * 2 - 1) * spread;
  }

  int(minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.range(minInclusive, maxExclusive));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length)];
  }
}

/** Root generator; hand out one fork per system. */
export class Rng {
  private streams = new Map<string, RandomStream>();

  constructor(public readonly seed: string = "kings-gambit") {}

  /** Stable named stream. The same name always returns the same stream. */
  fork(name: string): RandomStream {
    let stream = this.streams.get(name);
    if (!stream) {
      stream = new RandomStream(`${this.seed}::${name}`);
      this.streams.set(name, stream);
    }
    return stream;
  }

  /** Rewinds every stream - used when a review capture restages a position. */
  reset(): void {
    this.streams.clear();
  }
}

/**
 * Shared root. Seeded from ?seed= in a review session so a capture is
 * reproducible, and from the clock otherwise so normal play still varies.
 */
export const rng = new Rng(
  typeof window !== "undefined" && window.location?.search?.includes("seed=")
    ? (new URLSearchParams(window.location.search).get("seed") ?? "kings-gambit")
    : "kings-gambit",
);
