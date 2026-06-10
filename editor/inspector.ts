/** Builds the emitter inspector panel from EmitterJSON. Mutates the JSON in place. */

import type {
  BurstJSON, EffectJSON, EmitterJSON, GradientJSON, ShapeJSON, StartColorJSON, Vec3JSON,
} from '../src/index';
import {
  checkbox, gradientField, numberInput, row, scalarValueField, selectInput, spriteField, textInput, vec3Input,
} from './fields';

const FADE_GRADIENT: GradientJSON = {
  colorKeys: [{ t: 0, color: [1, 1, 1] }],
  alphaKeys: [{ t: 0, alpha: 1 }, { t: 1, alpha: 0 }],
};

function section(title: string, open: boolean, build: (body: HTMLElement) => void): HTMLDetailsElement {
  const det = document.createElement('details');
  det.className = 'insp-module';
  det.open = open;
  const sum = document.createElement('summary');
  sum.textContent = title;
  det.appendChild(sum);
  const body = document.createElement('div');
  body.className = 'module-body';
  det.appendChild(body);
  build(body);
  return det;
}

/** A module section with an enable checkbox in its header. */
function moduleSection(
  title: string,
  isEnabled: boolean,
  onToggle: (enabled: boolean) => void,
  build: (body: HTMLElement) => void
): HTMLDetailsElement {
  const det = document.createElement('details');
  det.className = 'insp-module' + (isEnabled ? '' : ' disabled');
  det.open = false;
  const sum = document.createElement('summary');
  const cb = checkbox(isEnabled, (v) => {
    onToggle(v);
    det.classList.toggle('disabled', !v);
    if (v) det.open = true;
    body.innerHTML = '';
    if (v) build(body);
  }, `Enable ${title}`);
  cb.addEventListener('click', (e) => e.stopPropagation());
  const span = document.createElement('span');
  span.textContent = title;
  sum.append(cb, span);
  det.appendChild(sum);
  const body = document.createElement('div');
  body.className = 'module-body';
  det.appendChild(body);
  if (isEnabled) build(body);
  return det;
}

export function buildInspector(
  root: HTMLElement,
  effect: EffectJSON,
  emitter: EmitterJSON,
  onChange: () => void,
  onRename: () => void
): void {
  root.innerHTML = '';
  const em = emitter;
  em.modules = em.modules ?? {};
  const mods = em.modules;

  // ======== Main ========
  root.appendChild(section('Main', true, (b) => {
    b.appendChild(row('Name', textInput(em.name, (v) => { em.name = v; onChange(); onRename(); }, 'Emitter name')));
    b.appendChild(row('Enabled', checkbox(em.enabled !== false, (v) => { em.enabled = v; onChange(); }, 'Emitter enabled')));
    b.appendChild(row('Sub-emitter only', checkbox(!!em.isSubEmitter, (v) => { em.isSubEmitter = v || undefined; onChange(); onRename(); }, 'Emitter is a sub-emitter')));
    b.appendChild(row('Position', vec3Input(em.position, [0, 0, 0], (v) => { em.position = v; onChange(); }, 'Emitter position')));
    b.appendChild(row('Rotation °', vec3Input(em.rotation, [0, 0, 0], (v) => { em.rotation = v; onChange(); }, 'Emitter rotation degrees')));
    b.appendChild(row('Delay s', numberInput(em.delay ?? 0, (v) => { em.delay = v; onChange(); }, { step: 0.1, min: 0, label: 'Start delay seconds' })));
    b.appendChild(row('Duration s', numberInput(em.duration ?? 5, (v) => { em.duration = v; onChange(); }, { step: 0.1, min: 0.01, label: 'Emitter duration seconds' })));
    b.appendChild(row('Looping', checkbox(em.looping !== false, (v) => { em.looping = v; onChange(); }, 'Emitter looping')));
    b.appendChild(row('Max particles', numberInput(em.maxParticles ?? 1000, (v) => { em.maxParticles = Math.max(1, Math.round(v)); onChange(); }, { step: 50, min: 1, label: 'Max particles' })));
    b.appendChild(row('Sim space', selectInput(em.simulationSpace ?? 'local', ['local', 'world'], (v) => { em.simulationSpace = v; onChange(); }, 'Simulation space')));
    b.appendChild(row('Gravity ×', numberInput(em.gravity ?? 0, (v) => { em.gravity = v; onChange(); }, { step: 0.1, label: 'Gravity multiplier' })));
    b.appendChild(row('Inherit velocity', numberInput(em.inheritVelocity ?? 0, (v) => { em.inheritVelocity = v; onChange(); }, { step: 0.1, label: 'Inherit velocity fraction' })));
  }));

  // ======== Emission ========
  root.appendChild(section('Emission', true, (b) => {
    em.emission = em.emission ?? {};
    const emi = em.emission;
    b.appendChild(scalarValueField('Rate / second', emi.rateOverTime, 10, (v) => { emi.rateOverTime = v; onChange(); }));
    b.appendChild(row('Rate / distance', numberInput(emi.rateOverDistance ?? 0, (v) => { emi.rateOverDistance = v; onChange(); }, { step: 1, min: 0, label: 'Emission rate per unit distance' })));

    const burstsWrap = document.createElement('div');
    const renderBursts = (): void => {
      burstsWrap.innerHTML = '';
      const bursts = emi.bursts ?? [];
      bursts.forEach((burst, i) => {
        const div = document.createElement('div');
        div.className = 'burst-row';
        div.appendChild(row('Time s', numberInput(burst.time, (v) => { burst.time = v; onChange(); }, { step: 0.05, min: 0, label: `Burst ${i + 1} time` })));
        div.appendChild(scalarValueField('Count', burst.count, 10, (v) => { burst.count = v; onChange(); }));
        div.appendChild(row('Cycles (0=∞)', numberInput(burst.cycles ?? 1, (v) => { burst.cycles = Math.max(0, Math.round(v)); onChange(); }, { step: 1, min: 0, label: `Burst ${i + 1} cycles` })));
        div.appendChild(row('Interval s', numberInput(burst.interval ?? 1, (v) => { burst.interval = v; onChange(); }, { step: 0.1, min: 0.01, label: `Burst ${i + 1} interval` })));
        div.appendChild(row('Probability', numberInput(burst.probability ?? 1, (v) => { burst.probability = v; onChange(); }, { step: 0.05, min: 0, max: 1, label: `Burst ${i + 1} probability` })));
        const del = document.createElement('button');
        del.className = 'mini-btn danger';
        del.textContent = 'Remove burst';
        del.setAttribute('aria-label', `Remove burst ${i + 1}`);
        del.addEventListener('click', () => {
          bursts.splice(i, 1);
          emi.bursts = bursts;
          onChange();
          renderBursts();
        });
        div.appendChild(del);
        burstsWrap.appendChild(div);
      });
    };
    renderBursts();
    b.appendChild(burstsWrap);
    const add = document.createElement('button');
    add.className = 'mini-btn';
    add.textContent = '+ Add burst';
    add.setAttribute('aria-label', 'Add burst');
    add.addEventListener('click', () => {
      emi.bursts = emi.bursts ?? [];
      emi.bursts.push({ time: 0, count: 10 } as BurstJSON);
      onChange();
      renderBursts();
    });
    b.appendChild(add);
  }));

  // ======== Shape ========
  root.appendChild(section('Shape', false, (b) => {
    const renderShape = (): void => {
      b.innerHTML = '';
      const shape: ShapeJSON = em.shape ?? { type: 'point' };
      em.shape = shape;
      b.appendChild(row('Type', selectInput(shape.type, ['point', 'sphere', 'cone', 'circle', 'box', 'donut', 'edge'], (v) => {
        em.shape = defaultShape(v);
        onChange();
        renderShape();
      }, 'Shape type')));

      const s = em.shape as any;
      switch (shape.type) {
        case 'sphere':
          b.appendChild(row('Radius', numberInput(s.radius ?? 0.5, (v) => { s.radius = v; onChange(); }, { step: 0.05, min: 0, label: 'Sphere radius' })));
          b.appendChild(row('Hemisphere', checkbox(!!s.hemisphere, (v) => { s.hemisphere = v; onChange(); }, 'Hemisphere')));
          b.appendChild(row('Shell only', checkbox(!!s.shell, (v) => { s.shell = v; onChange(); }, 'Emit from shell only')));
          break;
        case 'cone':
          b.appendChild(row('Angle °', numberInput(s.angle ?? 25, (v) => { s.angle = v; onChange(); }, { step: 1, min: 0, max: 89, label: 'Cone angle' })));
          b.appendChild(row('Radius', numberInput(s.radius ?? 0.2, (v) => { s.radius = v; onChange(); }, { step: 0.05, min: 0, label: 'Cone base radius' })));
          b.appendChild(row('Emit from', selectInput(s.emitFrom ?? 'base', ['base', 'volume'], (v) => { s.emitFrom = v; onChange(); }, 'Cone emit from')));
          b.appendChild(row('Length', numberInput(s.length ?? 1, (v) => { s.length = v; onChange(); }, { step: 0.1, min: 0, label: 'Cone volume length' })));
          break;
        case 'circle':
          b.appendChild(row('Radius', numberInput(s.radius ?? 0.5, (v) => { s.radius = v; onChange(); }, { step: 0.05, min: 0, label: 'Circle radius' })));
          b.appendChild(row('Arc °', numberInput(s.arc ?? 360, (v) => { s.arc = v; onChange(); }, { step: 5, min: 0, max: 360, label: 'Circle arc degrees' })));
          b.appendChild(row('Edge only', checkbox(!!s.shell, (v) => { s.shell = v; onChange(); }, 'Emit from circle edge only')));
          break;
        case 'box':
          b.appendChild(row('Size', vec3Input(s.size, [1, 1, 1], (v) => { s.size = v; onChange(); }, 'Box size')));
          b.appendChild(row('Emit from', selectInput(s.emitFrom ?? 'volume', ['volume', 'shell', 'edge'], (v) => { s.emitFrom = v; onChange(); }, 'Box emit from')));
          break;
        case 'donut':
          b.appendChild(row('Radius', numberInput(s.radius ?? 1, (v) => { s.radius = v; onChange(); }, { step: 0.05, min: 0, label: 'Donut radius' })));
          b.appendChild(row('Tube', numberInput(s.tube ?? 0.2, (v) => { s.tube = v; onChange(); }, { step: 0.02, min: 0, label: 'Donut tube radius' })));
          break;
        case 'edge':
          b.appendChild(row('Length', numberInput(s.length ?? 1, (v) => { s.length = v; onChange(); }, { step: 0.1, min: 0, label: 'Edge length' })));
          break;
      }
      b.appendChild(row('Randomize dir', numberInput(em.randomizeDirection ?? 0, (v) => { em.randomizeDirection = v; onChange(); }, { step: 0.05, min: 0, max: 1, label: 'Randomize direction amount' })));
    };
    renderShape();
  }));

  // ======== Initial values ========
  root.appendChild(section('Initial', true, (b) => {
    b.appendChild(scalarValueField('Lifetime s', em.lifetime, 1, (v) => { em.lifetime = v; onChange(); }));
    b.appendChild(scalarValueField('Speed', em.speed, 1, (v) => { em.speed = v; onChange(); }));
    b.appendChild(scalarValueField('Size', em.size, 0.25, (v) => { em.size = v; onChange(); }));

    const sizeYWrap = document.createElement('div');
    const renderSizeY = (): void => {
      sizeYWrap.innerHTML = '';
      sizeYWrap.appendChild(row('Separate Y size', checkbox(em.sizeY !== undefined, (v) => {
        em.sizeY = v ? 0.25 : undefined;
        onChange();
        renderSizeY();
      }, 'Use separate Y size')));
      if (em.sizeY !== undefined) {
        sizeYWrap.appendChild(scalarValueField('Size Y', em.sizeY, 0.25, (v) => { em.sizeY = v; onChange(); }));
      }
    };
    renderSizeY();
    b.appendChild(sizeYWrap);

    b.appendChild(scalarValueField('Rotation °', em.startRotation, 0, (v) => { em.startRotation = v; onChange(); }));
    b.appendChild(scalarValueField('Angular vel °/s', em.angularVelocity, 0, (v) => { em.angularVelocity = v; onChange(); }));

    // Start color
    const colorWrap = document.createElement('div');
    const renderColor = (): void => {
      colorWrap.innerHTML = '';
      const sc: StartColorJSON = em.startColor ?? [1, 1, 1, 1];
      const kind = Array.isArray(sc) ? 'solid' : sc.type === 'randomColor' ? 'randomColor' : 'gradient';
      colorWrap.appendChild(row('Start color', selectInput(kind, [
        { value: 'solid', label: 'Solid' },
        { value: 'randomColor', label: 'Random between two' },
        { value: 'gradient', label: 'Random from gradient' },
      ], (v) => {
        if (v === 'solid') em.startColor = [1, 1, 1, 1];
        else if (v === 'randomColor') em.startColor = { type: 'randomColor', a: [1, 1, 1, 1], b: [1, 0.5, 0.2, 1] };
        else em.startColor = { type: 'gradient', gradient: structuredClone(FADE_GRADIENT) };
        onChange();
        renderColor();
      }, 'Start color mode')));

      if (Array.isArray(sc)) {
        colorWrap.appendChild(row('Color', colorAlphaInput(sc, (v) => { em.startColor = v; onChange(); }, 'Start color')));
      } else if (sc.type === 'randomColor') {
        colorWrap.appendChild(row('Color A', colorAlphaInput(sc.a, (v) => { sc.a = v; onChange(); }, 'Start color A')));
        colorWrap.appendChild(row('Color B', colorAlphaInput(sc.b, (v) => { sc.b = v; onChange(); }, 'Start color B')));
      } else {
        colorWrap.appendChild(gradientField('Start color gradient (sampled randomly per particle)', sc.gradient, (g) => {
          sc.gradient = g;
          onChange();
        }));
      }
    };
    renderColor();
    b.appendChild(colorWrap);
  }));

  // ======== Over-lifetime modules ========
  root.appendChild(moduleSection('Size over Life', isOn(mods.sizeOverLife), (v) => {
    mods.sizeOverLife = v
      ? mods.sizeOverLife
        ? { ...mods.sizeOverLife, enabled: true }
        : { enabled: true, curve: { type: 'curve', keys: [{ t: 0, v: 0 }, { t: 0.2, v: 1 }, { t: 1, v: 0 }] } }
      : mods.sizeOverLife && { ...mods.sizeOverLife, enabled: false };
    onChange();
  }, (b) => {
    b.appendChild(scalarValueField('Multiplier', mods.sizeOverLife!.curve, 1, (v) => { mods.sizeOverLife!.curve = v; onChange(); }));
  }));

  root.appendChild(moduleSection('Color over Life', isOn(mods.colorOverLife), (v) => {
    mods.colorOverLife = v
      ? mods.colorOverLife
        ? { ...mods.colorOverLife, enabled: true }
        : { enabled: true, gradient: structuredClone(FADE_GRADIENT) }
      : mods.colorOverLife && { ...mods.colorOverLife, enabled: false };
    onChange();
  }, (b) => {
    b.appendChild(gradientField('Tint over lifetime', mods.colorOverLife!.gradient, (g) => { mods.colorOverLife!.gradient = g; onChange(); }));
  }));

  root.appendChild(moduleSection('Rotation over Life', isOn(mods.rotationOverLife), (v) => {
    mods.rotationOverLife = v
      ? mods.rotationOverLife
        ? { ...mods.rotationOverLife, enabled: true }
        : { enabled: true, curve: 90 }
      : mods.rotationOverLife && { ...mods.rotationOverLife, enabled: false };
    onChange();
  }, (b) => {
    b.appendChild(scalarValueField('Angular vel °/s', mods.rotationOverLife!.curve, 0, (v) => { mods.rotationOverLife!.curve = v; onChange(); }));
  }));

  root.appendChild(moduleSection('Velocity over Life', isOn(mods.velocityOverLife), (v) => {
    mods.velocityOverLife = v
      ? mods.velocityOverLife
        ? { ...mods.velocityOverLife, enabled: true }
        : { enabled: true, x: 0, y: 1, z: 0 }
      : mods.velocityOverLife && { ...mods.velocityOverLife, enabled: false };
    onChange();
  }, (b) => {
    const m = mods.velocityOverLife!;
    b.appendChild(scalarValueField('X', m.x, 0, (v) => { m.x = v; onChange(); }));
    b.appendChild(scalarValueField('Y', m.y, 0, (v) => { m.y = v; onChange(); }));
    b.appendChild(scalarValueField('Z', m.z, 0, (v) => { m.z = v; onChange(); }));
    b.appendChild(row('Space', selectInput(m.space ?? 'local', ['local', 'world'], (v) => { m.space = v; onChange(); }, 'Velocity space')));
  }));

  root.appendChild(moduleSection('Force over Life', isOn(mods.forceOverLife), (v) => {
    mods.forceOverLife = v
      ? mods.forceOverLife
        ? { ...mods.forceOverLife, enabled: true }
        : { enabled: true, x: 0, y: 2, z: 0 }
      : mods.forceOverLife && { ...mods.forceOverLife, enabled: false };
    onChange();
  }, (b) => {
    const m = mods.forceOverLife!;
    b.appendChild(scalarValueField('X', m.x, 0, (v) => { m.x = v; onChange(); }));
    b.appendChild(scalarValueField('Y', m.y, 0, (v) => { m.y = v; onChange(); }));
    b.appendChild(scalarValueField('Z', m.z, 0, (v) => { m.z = v; onChange(); }));
  }));

  root.appendChild(moduleSection('Drag', isOn(mods.drag), (v) => {
    mods.drag = v
      ? mods.drag ? { ...mods.drag, enabled: true } : { enabled: true, coefficient: 1 }
      : mods.drag && { ...mods.drag, enabled: false };
    onChange();
  }, (b) => {
    b.appendChild(scalarValueField('Coefficient', mods.drag!.coefficient, 1, (v) => { mods.drag!.coefficient = v; onChange(); }));
  }));

  root.appendChild(moduleSection('Limit Velocity', isOn(mods.limitVelocity), (v) => {
    mods.limitVelocity = v
      ? mods.limitVelocity ? { ...mods.limitVelocity, enabled: true } : { enabled: true, speed: 1, dampen: 0.5 }
      : mods.limitVelocity && { ...mods.limitVelocity, enabled: false };
    onChange();
  }, (b) => {
    const m = mods.limitVelocity!;
    b.appendChild(scalarValueField('Max speed', m.speed, 1, (v) => { m.speed = v; onChange(); }));
    b.appendChild(row('Dampen', numberInput(m.dampen ?? 1, (v) => { m.dampen = v; onChange(); }, { step: 0.05, min: 0, max: 1, label: 'Limit velocity dampen' })));
  }));

  root.appendChild(moduleSection('Turbulence', isOn(mods.turbulence), (v) => {
    mods.turbulence = v
      ? mods.turbulence ? { ...mods.turbulence, enabled: true } : { enabled: true, strength: 1, frequency: 1, scrollSpeed: 0.5 }
      : mods.turbulence && { ...mods.turbulence, enabled: false };
    onChange();
  }, (b) => {
    const m = mods.turbulence!;
    b.appendChild(scalarValueField('Strength', m.strength, 1, (v) => { m.strength = v; onChange(); }));
    b.appendChild(row('Frequency', numberInput(m.frequency ?? 1, (v) => { m.frequency = v; onChange(); }, { step: 0.1, min: 0, label: 'Turbulence frequency' })));
    b.appendChild(row('Scroll speed', numberInput(m.scrollSpeed ?? 0.5, (v) => { m.scrollSpeed = v; onChange(); }, { step: 0.1, label: 'Turbulence scroll speed' })));
    b.appendChild(row('Positional', checkbox(!!m.positional, (v) => { m.positional = v; onChange(); }, 'Turbulence moves positions directly')));
  }));

  root.appendChild(moduleSection('Vortex', isOn(mods.vortex), (v) => {
    mods.vortex = v
      ? mods.vortex ? { ...mods.vortex, enabled: true } : { enabled: true, strength: 180, axis: [0, 1, 0] as Vec3JSON }
      : mods.vortex && { ...mods.vortex, enabled: false };
    onChange();
  }, (b) => {
    const m = mods.vortex!;
    b.appendChild(scalarValueField('Swirl °/s', m.strength, 90, (v) => { m.strength = v; onChange(); }));
    b.appendChild(row('Axis', vec3Input(m.axis, [0, 1, 0], (v) => { m.axis = v; onChange(); }, 'Vortex axis')));
    b.appendChild(row('Center', vec3Input(m.center, [0, 0, 0], (v) => { m.center = v; onChange(); }, 'Vortex center')));
    b.appendChild(row('Radial pull', numberInput(m.radialPull ?? 0, (v) => { m.radialPull = v; onChange(); }, { step: 0.05, label: 'Vortex radial pull (negative = inward)' })));
  }));

  root.appendChild(moduleSection('Attractor', isOn(mods.attractor), (v) => {
    mods.attractor = v
      ? mods.attractor ? { ...mods.attractor, enabled: true } : { enabled: true, strength: 5, position: [0, 1, 0] as Vec3JSON }
      : mods.attractor && { ...mods.attractor, enabled: false };
    onChange();
  }, (b) => {
    const m = mods.attractor!;
    b.appendChild(scalarValueField('Strength', m.strength, 5, (v) => { m.strength = v; onChange(); }));
    b.appendChild(row('Position', vec3Input(m.position, [0, 0, 0], (v) => { m.position = v; onChange(); }, 'Attractor position')));
    b.appendChild(row('Radius (0=∞)', numberInput(m.radius ?? 0, (v) => { m.radius = v; onChange(); }, { step: 0.1, min: 0, label: 'Attractor falloff radius' })));
    b.appendChild(row('Kill radius', numberInput(m.killRadius ?? 0, (v) => { m.killRadius = v; onChange(); }, { step: 0.05, min: 0, label: 'Attractor kill radius' })));
  }));

  root.appendChild(moduleSection('Orbit', isOn(mods.orbit), (v) => {
    mods.orbit = v
      ? mods.orbit ? { ...mods.orbit, enabled: true } : { enabled: true, speed: 90, axis: [0, 1, 0] as Vec3JSON }
      : mods.orbit && { ...mods.orbit, enabled: false };
    onChange();
  }, (b) => {
    const m = mods.orbit!;
    b.appendChild(scalarValueField('Speed °/s', m.speed, 90, (v) => { m.speed = v; onChange(); }));
    b.appendChild(row('Axis', vec3Input(m.axis, [0, 1, 0], (v) => { m.axis = v; onChange(); }, 'Orbit axis')));
    b.appendChild(row('Center', vec3Input(m.center, [0, 0, 0], (v) => { m.center = v; onChange(); }, 'Orbit center')));
  }));

  // ======== Sub-emitters ========
  root.appendChild(section('Sub-emitters', false, (b) => {
    const renderSubs = (): void => {
      b.innerHTML = '';
      const subs = em.subEmitters ?? [];
      const targets = effect.emitters.filter((e) => e !== em).map((e) => e.name);
      subs.forEach((sub, i) => {
        const div = document.createElement('div');
        div.className = 'burst-row';
        div.appendChild(row('Target', selectInput(sub.target, targets.length ? targets : [sub.target], (v) => { sub.target = v; onChange(); }, `Sub-emitter ${i + 1} target`)));
        div.appendChild(row('Trigger', selectInput(sub.trigger, ['birth', 'death'], (v) => { sub.trigger = v; onChange(); }, `Sub-emitter ${i + 1} trigger`)));
        div.appendChild(row('Count', numberInput(sub.count ?? 1, (v) => { sub.count = Math.max(0, Math.round(v)); onChange(); }, { step: 1, min: 0, label: `Sub-emitter ${i + 1} count` })));
        div.appendChild(row('Inherit vel', numberInput(sub.inheritVelocity ?? 0, (v) => { sub.inheritVelocity = v; onChange(); }, { step: 0.05, label: `Sub-emitter ${i + 1} inherit velocity` })));
        div.appendChild(row('Probability', numberInput(sub.probability ?? 1, (v) => { sub.probability = v; onChange(); }, { step: 0.05, min: 0, max: 1, label: `Sub-emitter ${i + 1} probability` })));
        const del = document.createElement('button');
        del.className = 'mini-btn danger';
        del.textContent = 'Remove';
        del.setAttribute('aria-label', `Remove sub-emitter ${i + 1}`);
        del.addEventListener('click', () => {
          subs.splice(i, 1);
          em.subEmitters = subs;
          onChange();
          renderSubs();
        });
        div.appendChild(del);
        b.appendChild(div);
      });
      const add = document.createElement('button');
      add.className = 'mini-btn';
      add.textContent = '+ Add sub-emitter trigger';
      add.setAttribute('aria-label', 'Add sub-emitter trigger');
      add.addEventListener('click', () => {
        em.subEmitters = em.subEmitters ?? [];
        em.subEmitters.push({ target: targets[0] ?? '', trigger: 'death', count: 5 });
        onChange();
        renderSubs();
      });
      b.appendChild(add);
      const hint = document.createElement('p');
      hint.className = 'editor-hint';
      hint.textContent = 'Targets should be emitters marked "Sub-emitter only".';
      b.appendChild(hint);
    };
    renderSubs();
  }));

  // ======== Renderer ========
  root.appendChild(section('Renderer', true, (b) => {
    em.render = em.render ?? {};
    const r = em.render;
    b.appendChild(row('Sprite', spriteField(r.sprite, (p) => { r.sprite = p; onChange(); })));
    b.appendChild(row('Blend', selectInput(r.blend ?? 'additive', ['additive', 'alpha', 'multiply', 'screen', 'subtractive'], (v) => { r.blend = v; onChange(); }, 'Blend mode')));
    b.appendChild(row('Mode', selectInput(r.mode ?? 'billboard', ['billboard', 'stretched', 'horizontal', 'vertical'], (v) => { r.mode = v; onChange(); }, 'Render mode')));
    b.appendChild(row('Stretch factor', numberInput(r.stretchFactor ?? 0.1, (v) => { r.stretchFactor = v; onChange(); }, { step: 0.01, label: 'Stretch factor (stretched mode)' })));
    b.appendChild(row('Length scale', numberInput(r.lengthScale ?? 1, (v) => { r.lengthScale = v; onChange(); }, { step: 0.1, label: 'Length scale (stretched mode)' })));
    b.appendChild(row('Apply tint', checkbox(r.applyTint !== false, (v) => { r.applyTint = v; onChange(); }, 'Apply effect tint to this emitter')));

    const fbWrap = document.createElement('div');
    const renderFb = (): void => {
      fbWrap.innerHTML = '';
      fbWrap.appendChild(row('Flipbook', checkbox(!!r.flipbook, (v) => {
        r.flipbook = v ? { rows: 2, cols: 2, mode: 'overLife' } : undefined;
        onChange();
        renderFb();
      }, 'Use flipbook sprite sheet')));
      if (r.flipbook) {
        fbWrap.appendChild(row('Rows', numberInput(r.flipbook.rows, (v) => { r.flipbook!.rows = Math.max(1, Math.round(v)); onChange(); }, { step: 1, min: 1, label: 'Flipbook rows' })));
        fbWrap.appendChild(row('Cols', numberInput(r.flipbook.cols, (v) => { r.flipbook!.cols = Math.max(1, Math.round(v)); onChange(); }, { step: 1, min: 1, label: 'Flipbook columns' })));
        fbWrap.appendChild(row('Frame mode', selectInput(r.flipbook.mode ?? 'overLife', ['overLife', 'random'], (v) => { r.flipbook!.mode = v; onChange(); }, 'Flipbook frame mode')));
      }
    };
    renderFb();
    b.appendChild(fbWrap);
  }));
}

function isOn(mod: { enabled?: boolean } | undefined): boolean {
  return !!mod && mod.enabled !== false;
}

function defaultShape(type: ShapeJSON['type']): ShapeJSON {
  switch (type) {
    case 'point': return { type: 'point' };
    case 'sphere': return { type: 'sphere', radius: 0.5 };
    case 'cone': return { type: 'cone', angle: 25, radius: 0.2 };
    case 'circle': return { type: 'circle', radius: 0.5 };
    case 'box': return { type: 'box', size: [1, 1, 1] };
    case 'donut': return { type: 'donut', radius: 1, tube: 0.2 };
    case 'edge': return { type: 'edge', length: 1 };
  }
}

function colorAlphaInput(value: [number, number, number, number], onChange: (v: [number, number, number, number]) => void, label: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = '6px';
  wrap.style.alignItems = 'center';
  const v: [number, number, number, number] = [...value];
  const hex = document.createElement('input');
  hex.type = 'color';
  hex.setAttribute('aria-label', label);
  const toHex = (n: number): string => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0');
  hex.value = `#${toHex(v[0])}${toHex(v[1])}${toHex(v[2])}`;
  hex.addEventListener('input', () => {
    const m = hex.value.replace('#', '');
    v[0] = parseInt(m.slice(0, 2), 16) / 255;
    v[1] = parseInt(m.slice(2, 4), 16) / 255;
    v[2] = parseInt(m.slice(4, 6), 16) / 255;
    onChange([...v]);
  });
  const alpha = numberInput(v[3], (n) => {
    v[3] = n;
    onChange([...v]);
  }, { step: 0.05, min: 0, max: 1, label: `${label} alpha` });
  alpha.style.width = '56px';
  const aLab = document.createElement('span');
  aLab.textContent = 'α';
  aLab.style.color = 'var(--text-dim)';
  wrap.append(hex, aLab, alpha);
  return wrap;
}
