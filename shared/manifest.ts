/** Built-in preset catalog shared by the demo gallery and the editor. */

export interface PresetMeta {
  id: string;
  name: string;
  file: string;
  description: string;
  looping: boolean;
  /** Representative sprite for the card thumbnail */
  icon: string;
  /** Tint swatches to show off colorability (hue shift applied via tint) */
  tints: string[];
  /** Preferred camera distance for this effect */
  camera?: number;
  /** Spawn height offset */
  y?: number;
}

export const PRESETS: PresetMeta[] = [
  {
    id: 'explosion', name: 'Explosion', file: 'presets/explosion.json', looping: false,
    description: 'Flash, fireball, sparks, embers and rolling smoke.',
    icon: 'sprites/fire_01.png', tints: ['#ffffff', '#ff9a3d', '#5ad1ff', '#9dff57'], y: 1.2,
  },
  {
    id: 'fireworks', name: 'Fireworks', file: 'presets/fireworks.json', looping: false,
    description: 'Rockets with sub-emitter starbursts, rings and twinkles.',
    icon: 'sprites/spark_07.png', tints: ['#ffffff', '#ff6f91', '#ffd166', '#64dfdf'], camera: 16, y: 0,
  },
  {
    id: 'thruster', name: 'Rocket Thruster', file: 'presets/thruster.json', looping: true,
    description: 'Blue core jet, orange flame, sparks and drifting smoke.',
    icon: 'sprites/muzzle_02.png', tints: ['#ffffff', '#7fd1ff', '#ffb347', '#b6ff6e'], y: 2.6,
  },
  {
    id: 'campfire', name: 'Campfire', file: 'presets/campfire.json', looping: true,
    description: 'Licking flames, embers carried by turbulence, soft smoke.',
    icon: 'sprites/flame_05.png', tints: ['#ffffff', '#7fffb2', '#7fb8ff', '#ff7fd4'], camera: 5, y: 0,
  },
  {
    id: 'magic-teleport', name: 'Magic Teleport', file: 'presets/magic-teleport.json', looping: true,
    description: 'Spinning floor sigil, rising sparkles, glyphs and light shafts.',
    icon: 'sprites/twirl_01.png', tints: ['#ffffff', '#ffd24d', '#5dff9e', '#ff5d8f'], y: 0,
  },
  {
    id: 'dark-magic', name: 'Dark Magic', file: 'presets/dark-magic.json', looping: true,
    description: 'Subtractive void smoke devours the light around a sickly green core.',
    icon: 'sprites/magic_05.png', tints: ['#ffffff', '#8aff7a', '#ff6a5e', '#6ad9ff'], y: 0,
  },
  {
    id: 'portal', name: 'Portal', file: 'presets/portal.json', looping: true,
    description: 'Swirling rim, indrafted streaks and escaping wisps.',
    icon: 'sprites/twirl_03.png', tints: ['#ffffff', '#ffaa40', '#48ff96', '#5dc8ff'], y: 0,
  },
  {
    id: 'tornado', name: 'Tornado', file: 'presets/tornado.json', looping: true,
    description: 'Vortex funnel with debris and ground dust.',
    icon: 'sprites/smoke_08.png', tints: ['#ffffff', '#c9b28a', '#9adcff', '#a4ffb0'], camera: 12, y: 0,
  },
  {
    id: 'healing-aura', name: 'Healing Aura', file: 'presets/healing-aura.json', looping: true,
    description: 'Gentle ring sigil with rising motes of light.',
    icon: 'sprites/magic_04.png', tints: ['#ffffff', '#ffe066', '#66c2ff', '#ff8fa3'], y: 0,
  },
  {
    id: 'electric-arcs', name: 'Electric Arcs', file: 'presets/electric-arcs.json', looping: true,
    description: 'Crackling arcs, filaments and turbulent zaps.',
    icon: 'sprites/spark_06.png', tints: ['#ffffff', '#ffe44d', '#7dffb8', '#ff7d7d'], y: 0.4,
  },
  {
    id: 'muzzle-flash', name: 'Muzzle Flash', file: 'presets/muzzle-flash.json', looping: false,
    description: 'A single frame of violence: flash, sparks, smoke.',
    icon: 'sprites/muzzle_05.png', tints: ['#ffffff', '#ffc14d', '#7fd1ff', '#c0ff5e'], camera: 6, y: 0,
  },
  {
    id: 'snow', name: 'Snowfall', file: 'presets/snow.json', looping: true,
    description: 'Drifting flakes with curl-noise wander and glints.',
    icon: 'sprites/circle_03.png', tints: ['#ffffff', '#bcd9ff', '#ffe9f3', '#d2ffe9'], camera: 14, y: 0,
  },
  {
    id: 'rain', name: 'Rain', file: 'presets/rain.json', looping: true,
    description: 'Stretched droplets with splash sub-emitters on impact.',
    icon: 'sprites/trace_01.png', tints: ['#ffffff', '#9fc1ff', '#a8ffe2', '#e6d3ff'], camera: 14, y: 0,
  },
  {
    id: 'confetti', name: 'Confetti Burst', file: 'presets/confetti.json', looping: false,
    description: 'Tumbling multicolor confetti and streamers.',
    icon: 'sprites/window_01.png', tints: ['#ffffff', '#ffd166', '#74e0ff', '#ff8fab'], y: 0.4,
  },
  {
    id: 'fountain', name: 'Fountain', file: 'presets/fountain.json', looping: true,
    description: 'Gravity arcs of water with splash sub-emitters and mist.',
    icon: 'sprites/trace_02.png', tints: ['#ffffff', '#8fd0ff', '#a0ffd9', '#ffd9a0'], y: 0,
  },
  {
    id: 'smoke-plume', name: 'Smoke Plume', file: 'presets/smoke-plume.json', looping: true,
    description: 'Thick rising smoke column above a smoldering base.',
    icon: 'sprites/smoke_09.png', tints: ['#ffffff', '#ffb38a', '#9fc9ff', '#b8ffb8'], camera: 12, y: 0,
  },
  {
    id: 'galaxy', name: 'Galaxy Swirl', file: 'presets/galaxy.json', looping: true,
    description: 'An orbiting disk of stars, dust arms and shooting stars.',
    icon: 'sprites/star_01.png', tints: ['#ffffff', '#ffd9a0', '#9fffe0', '#ff9fcf'], camera: 11, y: 0,
  },
];
