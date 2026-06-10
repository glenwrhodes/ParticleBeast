# ParticleBeast

A zero-dependency **WebGL2 particle engine** for games, with a Unity/Unreal-grade feature set, a browser-based **visual editor**, and **JSON presets** you can load at game time.

- **Demos** — gallery of effects (explosion, fireworks, thruster, tornado, magic teleport, portal, rain, snow, …)
- **Editor** — `/editor.html`: full inspector with curve & gradient editors, sprite picker, live preview, import/export JSON
- **Downloads** — `/downloads.html`: library builds, all presets, sprite pack

## Quick start (embedding in your game)

```js
import { ParticleBeast } from 'particle-beast';

// Own canvas (ParticleBeast creates the WebGL2 context):
const beast = new ParticleBeast(document.querySelector('canvas'));

// ...or share your game's existing context — ParticleBeast saves/restores
// every piece of GL state it touches:
const beast = new ParticleBeast(myGl);

const explosion = await beast.loadEffect('presets/explosion.json');

// When something blows up:
const fx = beast.spawn(explosion, {
  position: [0, 1, 0],
  tint: '#ff8833',     // recolor the whole effect
  hueShift: 0,         // or rotate hues (degrees)
  scale: 1,
});

// In your game loop:
beast.update(deltaSeconds);
beast.render(viewMatrix, projMatrix);   // column-major Float32Array(16)
```

One-shot effects auto-dispose when finished (`autoDispose: false` to keep them). Looping instances run until you call `fx.stop()` (stops emitting, particles finish) or `fx.dispose()`.

### EffectInstance API

| Method | Description |
| --- | --- |
| `setPosition(x, y, z)` | Move the effect (moving emitters work with rate-over-distance & inherit velocity) |
| `setRotation(x, y, z)` | Euler degrees |
| `setScale(s)` / `setTint(color)` / `setHueShift(deg)` | Live transform/recolor |
| `play()` / `pause()` / `restart()` | Playback control |
| `stop(clear?)` | Stop emitting; `true` also clears live particles |
| `dispose()` | Remove and free GPU buffers |
| `playbackSpeed` | Simulation speed multiplier |
| `finished` / `particleCount` | State queries |

### Loading presets

`loadEffect(url)` fetches JSON and pre-warms textures. Sprite paths inside presets resolve **relative to the preset file**, so keep `presets/` and `sprites/` siblings (like this repo) and everything just works. You can also pass a parsed object: `beast.compileEffect(json)`.

## Preset JSON format (v1)

```jsonc
{
  "version": 1,
  "name": "My Effect",
  "looping": true,
  "emitters": [ /* EmitterJSON[] — every emitter is a subsystem */ ]
}
```

Each **emitter** has its own transform, timing, sprite and modules. Scalar values everywhere accept four forms (Unity-style MinMaxCurve):

```jsonc
5                                                 // constant
{ "type": "random", "min": 1, "max": 3 }          // random between two
{ "type": "curve", "keys": [{ "t": 0, "v": 0 }, { "t": 1, "v": 1 }], "scale": 2 }
{ "type": "randomCurves", "min": [...], "max": [...] }
```

Gradients have separate color and alpha stops:

```jsonc
{ "colorKeys": [{ "t": 0, "color": [1, 0.5, 0] }], "alphaKeys": [{ "t": 0, "alpha": 1 }, { "t": 1, "alpha": 0 }] }
```

### Emitter reference

| Field | Default | Description |
| --- | --- | --- |
| `name` | — | Unique within the effect (sub-emitter targets reference it) |
| `isSubEmitter` | `false` | Only spawns via triggers, not on its own timeline |
| `position` / `rotation` | 0 | Local transform within the effect |
| `delay`, `duration`, `looping` | 0 / 5 / true | Timeline |
| `maxParticles` | 1000 | Pool size |
| `simulationSpace` | `local` | `world` particles are left behind when the effect moves |
| `gravity` | 0 | Multiplier of (0, −9.81, 0) |
| `inheritVelocity` | 0 | Fraction of effect velocity given to new particles |
| `emission.rateOverTime` | 10 | Particles/second (scalar value) |
| `emission.rateOverDistance` | 0 | Particles per unit moved |
| `emission.bursts[]` | — | `{ time, count, cycles, interval, probability }` |
| `shape` | point | `point, sphere, cone, circle, box, donut, edge` (+ shell/arc/emitFrom options) |
| `randomizeDirection` | 0 | 0..1 blend toward a random direction |
| `lifetime, speed, size, sizeY, startRotation, angularVelocity` | — | Initial values (scalar values) |
| `startColor` | white | RGBA, `randomColor` (lerp two), or `gradient` (random sample) |
| `subEmitters[]` | — | `{ target, trigger: birth\|death, count, inheritVelocity, probability }` |
| `render` | — | `sprite`, `blend` (additive/alpha/multiply), `mode` (billboard/stretched/horizontal/vertical), `stretchFactor`, `lengthScale`, `applyTint`, `flipbook {rows, cols, mode}` |

### Modules (`modules.*`, each with `enabled`)

| Module | Description |
| --- | --- |
| `sizeOverLife` | Size multiplier curve |
| `colorOverLife` | Gradient multiplied with start color |
| `rotationOverLife` | Extra angular velocity (deg/s) over life |
| `velocityOverLife` | Additive velocity (x/y/z scalar values, local or world) |
| `forceOverLife` | Acceleration (x/y/z) |
| `drag` | Velocity damping |
| `limitVelocity` | Speed clamp with dampen factor |
| `turbulence` | Curl-noise force field: `strength`, `frequency`, `scrollSpeed`, `positional` |
| `vortex` | Swirl around an axis (deg/s) with optional `radialPull` (tornados, portals) |
| `attractor` | Point force field: attract (+) or repel (−), falloff `radius`, `killRadius` |
| `orbit` | Rotate particle positions around an axis (galaxies, orbiting sparks) |

### Colorability

Every spawn accepts `tint` and `hueShift`; both are applied per-emitter in the shader (free at runtime — no re-simulation). Emitters opt out with `render.applyTint: false` (useful for smoke that should stay gray).

## Editor

Open `/editor.html`:

- **Left**: built-in presets, your browser-saved presets, and the emitter list (add / duplicate / mute / delete)
- **Center**: live preview — orbit camera, play/pause/restart, speed, tint and background controls, fps + particle count
- **Right**: full inspector — every module above, with canvas curve editors (drag keys, double-click to add, right-click to remove) and gradient editors (color stops top, alpha stops bottom)
- **Top bar**: New / Import (paste or file) / Export (copy or download .json) / Save (localStorage)

Exported JSON is exactly what `beast.loadEffect()` consumes.

## Development

```bash
npm install
npm run dev      # vite dev server: / (demos), /editor.html, /downloads.html
npm run lint     # eslint + tsc
npm run build    # site + library + zips into dist/
```

## Deployment (Heroku)

Pushing to the GitHub repo auto-deploys. Heroku runs `heroku-postbuild` (full Vite build + asset zips) and starts `node server.js` (Express static server, `Procfile`). Nothing needs to be built locally or committed from `dist/`.

## Repo layout

```
src/        the library (zero dependencies)
  core/     simulation: emitters, modules, shapes, curves, noise
  render/   WebGL2 instanced renderer + texture cache
demo/       demo gallery app
editor/     visual editor app
shared/     orbit camera, grid floor, preset manifest
presets/    effect JSON presets
sprites/    particle sprite pack (white-on-transparent PNGs)
server.js   Heroku static server
```

## Sprite credits

Particle sprites based on the Kenney Particle Pack (CC0).
