/** Small fast seedable PRNG (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** Uniform [0, 1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

let globalSeedCounter = 1;

/** A reasonably-unique seed for effect instances spawned without an explicit seed. */
export function autoSeed(): number {
  globalSeedCounter = (globalSeedCounter * 1103515245 + 12345) >>> 0;
  return (globalSeedCounter ^ (Date.now() & 0xffffffff)) >>> 0;
}
