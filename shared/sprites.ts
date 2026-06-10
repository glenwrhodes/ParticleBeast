/** Catalog of bundled sprites (paths relative to site root). */

const names = [
  'circle_01', 'circle_02', 'circle_03', 'circle_04', 'circle_05',
  'dirt_01', 'dirt_02', 'dirt_03',
  'fire_01', 'fire_02',
  'flame_01', 'flame_02', 'flame_03', 'flame_04', 'flame_05', 'flame_06',
  'flare_01',
  'light_01', 'light_02', 'light_03',
  'magic_01', 'magic_02', 'magic_03', 'magic_04', 'magic_05',
  'muzzle_01', 'muzzle_02', 'muzzle_03', 'muzzle_04', 'muzzle_05',
  'scorch_01', 'scorch_02', 'scorch_03',
  'scratch_01',
  'slash_01', 'slash_02', 'slash_03', 'slash_04',
  'smoke_01', 'smoke_02', 'smoke_03', 'smoke_04', 'smoke_05',
  'smoke_06', 'smoke_07', 'smoke_08', 'smoke_09', 'smoke_10',
  'spark_01', 'spark_02', 'spark_03', 'spark_04', 'spark_05', 'spark_06', 'spark_07',
  'star_01', 'star_02', 'star_03', 'star_04', 'star_05', 'star_06', 'star_07', 'star_08', 'star_09',
  'symbol_01', 'symbol_02',
  'trace_01', 'trace_02', 'trace_03', 'trace_04', 'trace_05', 'trace_06', 'trace_07',
  'twirl_01', 'twirl_02', 'twirl_03',
  'window_01', 'window_02', 'window_03', 'window_04',
];

const rotated = [
  'flame_05_rotated', 'flame_06_rotated',
  'muzzle_01_rotated', 'muzzle_02_rotated', 'muzzle_03_rotated', 'muzzle_04_rotated', 'muzzle_05_rotated',
  'spark_05_rotated', 'spark_06_rotated',
  'trace_01_rotated', 'trace_02_rotated', 'trace_03_rotated', 'trace_04_rotated',
  'trace_05_rotated', 'trace_06_rotated', 'trace_07_rotated',
];

export const SPRITES: string[] = [
  ...names.map((n) => `sprites/${n}.png`),
  ...rotated.map((n) => `sprites/Rotated/${n}.png`),
];
