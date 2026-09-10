/**
 * Local persistence via localStorage.
 * Best-run records: ski_bestDist, ski_bestGates, ski_bestSpeed
 * Lifetime totals (used to gate skin unlocks): ski_totalDist, ski_totalGates, ski_runs
 */
const KEYS = {
  dist: 'ski_bestDist',
  gates: 'ski_bestGates',
  speed: 'ski_bestSpeed',
  totalDist: 'ski_totalDist',
  totalGates: 'ski_totalGates',
  runs: 'ski_runs',
} as const;

export type BestScores = {
  dist: number;
  gates: number;
  speed: number;
  totalDist: number;
  totalGates: number;
  runs: number;
};

function num(key: string): number {
  const v = Number(localStorage.getItem(key) ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function load(): BestScores {
  try {
    return {
      dist: num(KEYS.dist),
      gates: num(KEYS.gates),
      speed: num(KEYS.speed),
      totalDist: num(KEYS.totalDist),
      totalGates: num(KEYS.totalGates),
      runs: num(KEYS.runs),
    };
  } catch {
    return { dist: 0, gates: 0, speed: 0, totalDist: 0, totalGates: 0, runs: 0 };
  }
}

function save(k: keyof typeof KEYS, v: number): void {
  try { localStorage.setItem(KEYS[k], String(v)); } catch {}
}

export const Score = {
  data: load(),

  get dist(): number { return this.data.dist; },
  get gates(): number { return this.data.gates; },
  get speed(): number { return this.data.speed; },
  get totalDist(): number { return this.data.totalDist; },
  get totalGates(): number { return this.data.totalGates; },
  get runs(): number { return this.data.runs; },

  /** Call after each run. Returns true if any best-run record was broken. */
  submit(dist: number, gates: number, topSpeed: number): boolean {
    let isNew = false;
    if (dist > this.data.dist)   { this.data.dist = dist;   save('dist', dist);   isNew = true; }
    if (gates > this.data.gates) { this.data.gates = gates; save('gates', gates); isNew = true; }
    if (topSpeed > this.data.speed) { this.data.speed = topSpeed; save('speed', topSpeed); isNew = true; }

    // Lifetime totals always accumulate.
    this.data.totalDist += Math.max(0, dist);
    this.data.totalGates += Math.max(0, gates);
    this.data.runs += 1;
    save('totalDist', this.data.totalDist);
    save('totalGates', this.data.totalGates);
    save('runs', this.data.runs);

    return isNew;
  },

  /** Test/QA helper — wipe all persisted progress. */
  reset(): void {
    this.data = { dist: 0, gates: 0, speed: 0, totalDist: 0, totalGates: 0, runs: 0 };
    for (const k of Object.keys(KEYS) as (keyof typeof KEYS)[]) save(k, 0);
  },
};
