/** ParticleBeast editor app. */

import { ParticleBeast, type EffectInstance, type EffectJSON, type EmitterJSON } from '../src/index';
import { OrbitCamera } from '../shared/orbit';
import { GridFloor } from '../shared/grid';
import { Stats, fitCanvas } from '../shared/stats';
import { PRESETS } from '../shared/manifest';
import { buildInspector } from './inspector';
import { confirmModal, noticeModal, openModal, promptModal } from './modal';

const STORAGE_KEY = 'particlebeast.savedPresets';

// ---- DOM ----
const canvas = document.getElementById('preview') as HTMLCanvasElement;
const presetListEl = document.getElementById('preset-list')!;
const emitterListEl = document.getElementById('emitter-list')!;
const inspectorEl = document.getElementById('inspector')!;
const nameInput = document.getElementById('effect-name') as HTMLInputElement;
const playBtn = document.getElementById('btn-play') as HTMLButtonElement;
const restartBtn = document.getElementById('btn-restart') as HTMLButtonElement;
const speedInput = document.getElementById('speed') as HTMLInputElement;
const speedVal = document.getElementById('speed-val')!;
const tintInput = document.getElementById('tint') as HTMLInputElement;
const bgInput = document.getElementById('bg') as HTMLInputElement;
const statsEl = document.getElementById('ed-stats')!;

// ---- Preview ----
const beast = new ParticleBeast(canvas);
const gl = beast.gl;
const camera = new OrbitCamera(canvas);
const grid = new GridFloor(gl);
const stats = new Stats();
let bg: [number, number, number] = [0.043, 0.063, 0.078];
let paused = false;

// ---- State ----
let effect: EffectJSON = defaultEffect();
let selectedEmitter = 0;
let instance: EffectInstance | null = null;

function defaultEffect(): EffectJSON {
  return {
    version: 1,
    name: 'Untitled Effect',
    looping: true,
    emitters: [defaultEmitter('emitter 1')],
  };
}

function defaultEmitter(name: string): EmitterJSON {
  return {
    name,
    duration: 2,
    looping: true,
    maxParticles: 500,
    emission: { rateOverTime: 20 },
    shape: { type: 'cone', angle: 25, radius: 0.2 },
    lifetime: { type: 'random', min: 0.8, max: 1.4 },
    speed: { type: 'random', min: 1.5, max: 3 },
    size: { type: 'random', min: 0.1, max: 0.25 },
    startColor: [1, 1, 1, 1],
    modules: {
      sizeOverLife: { enabled: true, curve: { type: 'curve', keys: [{ t: 0, v: 0 }, { t: 0.2, v: 1 }, { t: 1, v: 0 }] } },
    },
    render: { sprite: '../sprites/circle_05.png', blend: 'additive', mode: 'billboard' },
  };
}

/** Recompile the effect and respawn the preview instance. */
function rebuild(): void {
  try {
    const def = beast.compileEffect(structuredClone(effect));
    const old = instance;
    instance = beast.spawn(def, { tint: tintInput.value, autoDispose: false });
    instance.playbackSpeed = parseFloat(speedInput.value);
    if (paused) instance.pause();
    old?.dispose();
  } catch (err) {
    console.error('ParticleBeast: compile failed', err);
  }
}

function refreshAll(): void {
  nameInput.value = effect.name;
  renderEmitterList();
  renderInspector();
  rebuild();
}

// ---- Emitter list ----
function renderEmitterList(): void {
  emitterListEl.innerHTML = '';
  effect.emitters.forEach((em, i) => {
    const item = document.createElement('div');
    item.className = 'emitter-item' + (i === selectedEmitter ? ' selected' : '');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Select emitter ${em.name}`);

    const mute = document.createElement('button');
    mute.className = 'icon-btn' + (em.enabled === false ? ' muted' : '');
    mute.textContent = em.enabled === false ? '◌' : '●';
    mute.title = 'Toggle emitter';
    mute.setAttribute('aria-label', `Toggle emitter ${em.name} ${em.enabled === false ? 'on' : 'off'}`);
    mute.addEventListener('click', (e) => {
      e.stopPropagation();
      em.enabled = em.enabled === false ? true : false;
      rebuild();
      renderEmitterList();
      if (i === selectedEmitter) renderInspector();
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'em-name';
    nameSpan.textContent = em.name;

    item.append(mute, nameSpan);
    if (em.isSubEmitter) {
      const sub = document.createElement('span');
      sub.className = 'em-sub';
      sub.textContent = 'SUB';
      item.appendChild(sub);
    }

    const dup = document.createElement('button');
    dup.className = 'icon-btn';
    dup.textContent = '⧉';
    dup.title = 'Duplicate';
    dup.setAttribute('aria-label', `Duplicate emitter ${em.name}`);
    dup.addEventListener('click', (e) => {
      e.stopPropagation();
      const copy = structuredClone(em);
      copy.name = uniqueName(copy.name);
      effect.emitters.splice(i + 1, 0, copy);
      selectedEmitter = i + 1;
      refreshAll();
    });

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '✕';
    del.title = 'Delete';
    del.setAttribute('aria-label', `Delete emitter ${em.name}`);
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (effect.emitters.length <= 1) {
        noticeModal('Cannot delete', 'An effect needs at least one emitter.');
        return;
      }
      if (await confirmModal('Delete emitter', `Delete emitter "${em.name}"?`, 'Delete')) {
        effect.emitters.splice(i, 1);
        selectedEmitter = Math.min(selectedEmitter, effect.emitters.length - 1);
        refreshAll();
      }
    });

    item.append(dup, del);
    const select = (): void => {
      selectedEmitter = i;
      renderEmitterList();
      renderInspector();
    };
    item.addEventListener('click', select);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
    emitterListEl.appendChild(item);
  });
}

function uniqueName(base: string): string {
  const names = new Set(effect.emitters.map((e) => e.name));
  let name = base;
  let n = 2;
  while (names.has(name)) name = `${base} ${n++}`;
  return name;
}

// ---- Inspector ----
function renderInspector(): void {
  const em = effect.emitters[selectedEmitter];
  if (!em) {
    inspectorEl.innerHTML = '';
    return;
  }
  buildInspector(inspectorEl, effect, em, () => rebuild(), () => renderEmitterList());
}

// ---- Preset browser ----
interface SavedPresets {
  [name: string]: EffectJSON;
}

function loadSaved(): SavedPresets {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as SavedPresets;
  } catch {
    return {};
  }
}

function storeSaved(saved: SavedPresets): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

function renderPresetList(): void {
  presetListEl.innerHTML = '';

  for (const meta of PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset-item';
    b.setAttribute('aria-label', `Load built-in preset ${meta.name}`);
    b.innerHTML = `<img src="/${meta.icon}" alt="" /><span>${meta.name}</span>`;
    b.addEventListener('click', () => void loadBuiltin(meta.file, meta.name));
    presetListEl.appendChild(b);
  }

  const saved = loadSaved();
  const names = Object.keys(saved);
  if (names.length) {
    const h = document.createElement('p');
    h.className = 'editor-hint';
    h.textContent = 'Saved in browser';
    presetListEl.appendChild(h);
    for (const name of names) {
      const wrap = document.createElement('button');
      wrap.className = 'preset-item';
      wrap.setAttribute('aria-label', `Load saved preset ${name}`);
      wrap.innerHTML = `<img src="/sprites/star_09.png" alt="" /><span>${name}</span>`;
      const del = document.createElement('span');
      del.className = 'icon-btn del';
      del.textContent = '✕';
      del.setAttribute('role', 'button');
      del.setAttribute('aria-label', `Delete saved preset ${name}`);
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await confirmModal('Delete preset', `Delete saved preset "${name}"?`, 'Delete')) {
          const s = loadSaved();
          delete s[name];
          storeSaved(s);
          renderPresetList();
        }
      });
      wrap.appendChild(del);
      wrap.addEventListener('click', () => {
        effect = structuredClone(saved[name]);
        selectedEmitter = 0;
        refreshAll();
      });
      presetListEl.appendChild(wrap);
    }
  }
}

async function loadBuiltin(file: string, name: string): Promise<void> {
  try {
    const res = await fetch('/' + file);
    const json = (await res.json()) as EffectJSON;
    // Re-anchor sprite paths: presets use "../sprites/..." relative to /presets/
    effect = json;
    selectedEmitter = 0;
    refreshAll();
  } catch {
    noticeModal('Load failed', `Could not load preset "${name}".`);
  }
}

// ---- Topbar actions ----
nameInput.addEventListener('change', () => {
  effect.name = nameInput.value || 'Untitled Effect';
});

document.getElementById('btn-new')!.addEventListener('click', async () => {
  if (await confirmModal('New effect', 'Start a new effect? Unsaved changes are lost.', 'New effect')) {
    effect = defaultEffect();
    selectedEmitter = 0;
    refreshAll();
  }
});

document.getElementById('btn-add-emitter')!.addEventListener('click', () => {
  effect.emitters.push(defaultEmitter(uniqueName(`emitter ${effect.emitters.length + 1}`)));
  selectedEmitter = effect.emitters.length - 1;
  refreshAll();
});

document.getElementById('btn-save')!.addEventListener('click', async () => {
  const name = await promptModal('Save preset', 'Preset name', effect.name);
  if (!name) return;
  effect.name = name;
  nameInput.value = name;
  const saved = loadSaved();
  saved[name] = structuredClone(effect);
  storeSaved(saved);
  renderPresetList();
});

document.getElementById('btn-export')!.addEventListener('click', () => {
  const json = JSON.stringify(effect, null, 2);
  openModal('Export effect JSON', (body, close) => {
    const ta = document.createElement('textarea');
    ta.value = json;
    ta.setAttribute('aria-label', 'Effect JSON');
    ta.readOnly = true;
    body.appendChild(ta);
    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const copy = document.createElement('button');
    copy.className = 'tbtn';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', 'Copy JSON to clipboard');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(json);
      copy.textContent = 'Copied!';
    });

    const dl = document.createElement('button');
    dl.className = 'tbtn tbtn-accent';
    dl.textContent = 'Download .json';
    dl.setAttribute('aria-label', 'Download JSON file');
    dl.addEventListener('click', () => {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${effect.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      close();
    });

    actions.append(copy, dl);
    body.appendChild(actions);
  });
});

document.getElementById('btn-import')!.addEventListener('click', () => {
  openModal('Import effect JSON', (body, close) => {
    const ta = document.createElement('textarea');
    ta.placeholder = 'Paste effect JSON here…';
    ta.setAttribute('aria-label', 'Paste effect JSON');
    body.appendChild(ta);

    const fileLab = document.createElement('p');
    fileLab.className = 'editor-hint';
    fileLab.textContent = 'or choose a .json file:';
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.setAttribute('aria-label', 'Choose effect JSON file');
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void f.text().then((t) => {
        ta.value = t;
      });
    });
    body.append(fileLab, file);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const ok = document.createElement('button');
    ok.className = 'tbtn tbtn-accent';
    ok.textContent = 'Import';
    ok.setAttribute('aria-label', 'Import JSON');
    ok.addEventListener('click', () => {
      try {
        const json = JSON.parse(ta.value) as EffectJSON;
        if (!json.emitters?.length) throw new Error('no emitters');
        effect = json;
        selectedEmitter = 0;
        refreshAll();
        close();
      } catch {
        noticeModal('Import failed', 'That does not look like a valid ParticleBeast effect JSON.');
      }
    });
    actions.appendChild(ok);
    body.appendChild(actions);
  });
});

// ---- Transport ----
playBtn.addEventListener('click', () => {
  paused = !paused;
  playBtn.textContent = paused ? 'Play' : 'Pause';
  if (instance) {
    if (paused) instance.pause();
    else instance.play();
  }
});

restartBtn.addEventListener('click', () => {
  instance?.restart();
});

speedInput.addEventListener('input', () => {
  const v = parseFloat(speedInput.value);
  speedVal.textContent = `${v.toFixed(1)}x`;
  if (instance) instance.playbackSpeed = v;
});

tintInput.addEventListener('input', () => {
  instance?.setTint(tintInput.value);
});

bgInput.addEventListener('input', () => {
  const m = bgInput.value.replace('#', '');
  bg = [
    parseInt(m.slice(0, 2), 16) / 255,
    parseInt(m.slice(2, 4), 16) / 255,
    parseInt(m.slice(4, 6), 16) / 255,
  ];
});

// ---- Render loop ----
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  fitCanvas(canvas);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(bg[0], bg[1], bg[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  camera.update(dt);
  beast.update(dt);
  grid.render(camera.view, camera.proj);
  beast.render(camera.view, camera.proj);

  stats.tick();
  statsEl.textContent = `${stats.fps} fps · ${beast.particleCount.toLocaleString()} particles`;
  requestAnimationFrame(frame);
}

// ---- Boot ----
renderPresetList();
const presetParam = new URLSearchParams(location.search).get('preset');
const builtin = PRESETS.find((p) => p.id === presetParam);
if (builtin) {
  void loadBuiltin(builtin.file, builtin.name).then(() => refreshAll());
} else {
  refreshAll();
}
requestAnimationFrame(frame);
