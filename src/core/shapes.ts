/** Emission shape samplers. Write a local position and direction for a new particle. */

import { DEG2RAD } from './math';
import type { Rng } from './rng';
import type { ShapeJSON } from './types';

export type ShapeSampler = (rng: Rng, pos: number[], dir: number[]) => void;

function randomUnit(rng: Rng, out: number[]): void {
  // Marsaglia method
  let x = 0, y = 0, s = 2;
  while (s >= 1 || s === 0) {
    x = rng.range(-1, 1);
    y = rng.range(-1, 1);
    s = x * x + y * y;
  }
  const f = 2 * Math.sqrt(1 - s);
  out[0] = x * f;
  out[1] = y * f;
  out[2] = 1 - 2 * s;
}

export function compileShape(shape: ShapeJSON | undefined): ShapeSampler {
  const s = shape ?? { type: 'point' as const };
  switch (s.type) {
    case 'point':
      return (rng, pos, dir) => {
        pos[0] = pos[1] = pos[2] = 0;
        randomUnit(rng, dir);
      };

    case 'sphere': {
      const radius = s.radius ?? 0.5;
      const hemisphere = !!s.hemisphere;
      const shell = !!s.shell;
      return (rng, pos, dir) => {
        randomUnit(rng, dir);
        if (hemisphere && dir[1] < 0) dir[1] = -dir[1];
        const r = shell ? radius : radius * Math.cbrt(rng.next());
        pos[0] = dir[0] * r;
        pos[1] = dir[1] * r;
        pos[2] = dir[2] * r;
      };
    }

    case 'cone': {
      const angle = (s.angle ?? 25) * DEG2RAD;
      const radius = s.radius ?? 0.2;
      const length = s.length ?? 1;
      const fromVolume = s.emitFrom === 'volume';
      return (rng, pos, dir) => {
        const theta = rng.next() * Math.PI * 2;
        const radFrac = Math.sqrt(rng.next());
        const r = radius * radFrac;
        const ct = Math.cos(theta), st = Math.sin(theta);
        // Direction tilts outward proportionally to radial position
        const a = angle * radFrac;
        const sa = Math.sin(a), ca = Math.cos(a);
        dir[0] = sa * ct;
        dir[1] = ca;
        dir[2] = sa * st;
        pos[0] = ct * r;
        pos[1] = 0;
        pos[2] = st * r;
        if (fromVolume) {
          const d = rng.next() * length;
          pos[0] += dir[0] * d;
          pos[1] += dir[1] * d;
          pos[2] += dir[2] * d;
        }
      };
    }

    case 'circle': {
      const radius = s.radius ?? 0.5;
      const arc = ((s.arc ?? 360) * DEG2RAD);
      const shell = !!s.shell;
      return (rng, pos, dir) => {
        const theta = rng.next() * arc;
        const r = shell ? radius : radius * Math.sqrt(rng.next());
        const ct = Math.cos(theta), st = Math.sin(theta);
        pos[0] = ct * r;
        pos[1] = 0;
        pos[2] = st * r;
        dir[0] = ct;
        dir[1] = 0;
        dir[2] = st;
      };
    }

    case 'box': {
      const size = s.size ?? [1, 1, 1];
      const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
      const emitFrom = s.emitFrom ?? 'volume';
      return (rng, pos, dir) => {
        if (emitFrom === 'volume') {
          pos[0] = rng.range(-hx, hx);
          pos[1] = rng.range(-hy, hy);
          pos[2] = rng.range(-hz, hz);
        } else if (emitFrom === 'shell') {
          const face = (rng.next() * 6) | 0;
          pos[0] = rng.range(-hx, hx);
          pos[1] = rng.range(-hy, hy);
          pos[2] = rng.range(-hz, hz);
          if (face === 0) pos[0] = hx;
          else if (face === 1) pos[0] = -hx;
          else if (face === 2) pos[1] = hy;
          else if (face === 3) pos[1] = -hy;
          else if (face === 4) pos[2] = hz;
          else pos[2] = -hz;
        } else {
          // edge: one of the 12 box edges
          const e = (rng.next() * 12) | 0;
          const t = rng.next();
          const sx = e & 1 ? hx : -hx;
          const sy = e & 2 ? hy : -hy;
          const sz = e & 4 ? hz : -hz;
          const axis = e % 3;
          pos[0] = axis === 0 ? (t * 2 - 1) * hx : sx;
          pos[1] = axis === 1 ? (t * 2 - 1) * hy : sy;
          pos[2] = axis === 2 ? (t * 2 - 1) * hz : sz;
        }
        dir[0] = 0;
        dir[1] = 1;
        dir[2] = 0;
      };
    }

    case 'donut': {
      const radius = s.radius ?? 1;
      const tube = s.tube ?? 0.2;
      return (rng, pos, dir) => {
        const theta = rng.next() * Math.PI * 2;
        const phi = rng.next() * Math.PI * 2;
        const ct = Math.cos(theta), st = Math.sin(theta);
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const r = radius + tube * cp * Math.sqrt(rng.next());
        pos[0] = ct * r;
        pos[1] = tube * sp;
        pos[2] = st * r;
        dir[0] = ct * cp;
        dir[1] = sp;
        dir[2] = st * cp;
      };
    }

    case 'edge': {
      const half = (s.length ?? 1) / 2;
      return (rng, pos, dir) => {
        pos[0] = rng.range(-half, half);
        pos[1] = 0;
        pos[2] = 0;
        dir[0] = 0;
        dir[1] = 1;
        dir[2] = 0;
      };
    }
  }
}

export { randomUnit };
