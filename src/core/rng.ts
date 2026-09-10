/** Deterministic seeded RNG (mulberry32). All gameplay randomness must route through this. */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/** Random float in [min, max) */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Random int in [min, max] inclusive */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}
