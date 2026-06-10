# ParticleBeast

A zero-dependency **WebGL2 particle engine** for games, with a Unity/Unreal-grade feature set, a browser-based **visual editor**, and **JSON presets** you can load at game time.

**[Live site → particlebeast-a6d4fc5a70e4.herokuapp.com](https://particlebeast-a6d4fc5a70e4.herokuapp.com/)**

- **[Demos](https://particlebeast-a6d4fc5a70e4.herokuapp.com/)** — gallery of effects (explosion, fireworks, thruster, tornado, magic teleport, portal, rain, snow, …)
- **[Three.js demo](https://particlebeast-a6d4fc5a70e4.herokuapp.com/three.html)** — effects as `Object3D`s in a three.js scene
- **[Editor](https://particlebeast-a6d4fc5a70e4.herokuapp.com/editor.html)** — full inspector with curve & gradient editors, sprite picker, live preview, import/export JSON
- **[Downloads](https://particlebeast-a6d4fc5a70e4.herokuapp.com/downloads.html)** — library builds (vanilla + three.js addon), all presets, sprite pack

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

## Three.js addon

`particle-beast/three` wraps the engine for three.js apps (`three` is an optional peer dependency, never bundled). Effects are regular `Object3D`s: add them to the scene, parent them to meshes, move/rotate/scale them — the simulation follows the world transform, including inherit-velocity and rate-over-distance for moving emitters. Rendering happens in the renderer's own WebGL2 context and depth buffer, with all GL state saved/restored. Live demo: `/three.html`.

```js
import { ParticleBeastThree } from 'particle-beast/three';

const particles = new ParticleBeastThree(renderer);   // your THREE.WebGLRenderer
const explosion = await particles.loadEffect('presets/explosion.json');

// spawn as an Object3D — parent it to anything:
const fx = particles.spawn(explosion, { parent: ship, tint: '#ff8833' });
fx.position.set(0, 0, -2);

// each frame:
particles.update(clock.getDelta());
renderer.render(scene, camera);
particles.render(camera);     // after the scene, so particles depth-test against it
```

`ParticleEffect` proxies the full `EffectInstance` API (`play`, `pause`, `stop`, `restart`, `setTint`, `setHueShift`, `playbackSpeed`, `finished`, `particleCount`, `dispose`), and the raw instance is available as `fx.instance`. Finished one-shots are removed from the scene automatically. Spawn options are the same as the core engine (`tint`, `hueShift`, `seed`, `autoDispose`, plus `position`/`rotation`/`scale`, which set the Object3D's local transform).

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

## Deployment

`npm run build` produces a self-contained `dist/` (site + library + asset zips). Serve it with any static host, or run the included Express server with `node server.js` (honors `PORT`).

## Repo layout

```
src/        the library (zero dependencies)
  core/     simulation: emitters, modules, shapes, curves, noise
  render/   WebGL2 instanced renderer + texture cache
  three/    three.js addon (peer dep on three)
demo/       demo gallery app + three.js addon demo
editor/     visual editor app
shared/     orbit camera, grid floor, preset manifest
presets/    effect JSON presets
sprites/    particle sprite pack (white-on-transparent PNGs)
server.js   Express static server
```

## Sprite credits

Particle sprites based on the Kenney Particle Pack (CC0).
