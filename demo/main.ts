/** ParticleBeast demo gallery. */

import { ParticleBeast, type EffectDefinition, type EffectInstance } from '../src/index';
import { OrbitCamera } from '../shared/orbit';
import { GridFloor } from '../shared/grid';
import { Stats, fitCanvas } from '../shared/stats';
import { PRESETS, type PresetMeta } from '../shared/manifest';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const cardsEl = document.getElementById('cards')!;
const nameEl = document.getElementById('fx-name')!;
const descEl = document.getElementById('fx-desc')!;
const tintsEl = document.getElementById('tints')!;
const statsEl = document.getElementById('stats')!;
const replayBtn = document.getElementById('replay') as HTMLButtonElement;
const openEditorLink = document.getElementById('open-editor') as HTMLAnchorElement;

const beast = new ParticleBeast(canvas);
const gl = beast.gl;
const camera = new OrbitCamera(canvas);
camera.autoRotate = 0.08;
const grid = new GridFloor(gl);
const stats = new Stats();

const defCache = new Map<string, Promise<EffectDefinition>>();
let current: PresetMeta | null = null;
let currentInstance: EffectInstance | null = null;
let currentTint = '#ffffff';

function loadDef(meta: PresetMeta): Promise<EffectDefinition> {
  let p = defCache.get(meta.id);
  if (!p) {
    p = beast.loadEffect('/' + meta.file);
    defCache.set(meta.id, p);
  }
  return p;
}

async function selectPreset(meta: PresetMeta, tint?: string): Promise<void> {
  current = meta;
  currentTint = tint ?? meta.tints[0];
  nameEl.textContent = meta.name;
  descEl.textContent = meta.description;
  replayBtn.textContent = meta.looping ? 'Restart' : 'Replay';
  openEditorLink.href = `/editor.html?preset=${encodeURIComponent(meta.id)}`;
  camera.distance = meta.camera ?? 9;
  renderTints(meta);
  highlightCard(meta.id);

  const def = await loadDef(meta);
  if (current !== meta) return; // user clicked away while loading
  beast.clear();
  currentInstance = beast.spawn(def, {
    position: [0, meta.y ?? 0, 0],
    tint: currentTint,
    autoDispose: false,
  });
}

function retrigger(): void {
  if (!current || !currentInstance) return;
  currentInstance.restart();
}

function renderTints(meta: PresetMeta): void {
  tintsEl.innerHTML = '';
  for (const tint of meta.tints) {
    const b = document.createElement('button');
    b.className = 'tint-swatch';
    b.style.background = tint;
    b.setAttribute('aria-label', `Tint effect ${tint}`);
    b.setAttribute('aria-pressed', tint === currentTint ? 'true' : 'false');
    b.addEventListener('click', () => {
      currentTint = tint;
      currentInstance?.setTint(tint);
      for (const el of tintsEl.children) el.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
    });
    tintsEl.appendChild(b);
  }
}

function highlightCard(id: string): void {
  for (const el of cardsEl.querySelectorAll('.card')) {
    el.setAttribute('aria-pressed', el.getAttribute('data-id') === id ? 'true' : 'false');
  }
}

function buildCards(): void {
  for (const meta of PRESETS) {
    const card = document.createElement('button');
    card.className = 'card';
    card.setAttribute('data-id', meta.id);
    card.setAttribute('aria-pressed', 'false');
    card.setAttribute('aria-label', `Play ${meta.name} effect`);
    card.innerHTML = `
      <div class="card-top">
        <img class="card-icon" src="/${meta.icon}" alt="" />
        <span class="card-name">${meta.name}</span>
        <span class="card-badge ${meta.looping ? '' : 'oneshot'}">${meta.looping ? 'loop' : 'one-shot'}</span>
      </div>
      <p class="card-desc">${meta.description}</p>
    `;
    card.addEventListener('click', () => void selectPreset(meta));
    cardsEl.appendChild(card);
  }
}

// Click the viewport to re-trigger one-shots (but not while dragging)
let downAt = 0;
let downX = 0;
let downY = 0;
canvas.addEventListener('pointerdown', (e) => {
  downAt = performance.now();
  downX = e.clientX;
  downY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (performance.now() - downAt < 250 && dist < 6 && current && !current.looping) {
    retrigger();
  }
});

replayBtn.addEventListener('click', retrigger);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  fitCanvas(canvas);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.043, 0.063, 0.078, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  camera.update(dt);
  beast.update(dt);
  grid.render(camera.view, camera.proj);
  beast.render(camera.view, camera.proj);

  stats.tick();
  statsEl.textContent = `${stats.fps} fps · ${beast.particleCount.toLocaleString()} particles`;
  requestAnimationFrame(frame);
}

buildCards();
const initial = new URLSearchParams(location.search).get('preset');
void selectPreset(PRESETS.find((p) => p.id === initial) ?? PRESETS[0]);
requestAnimationFrame(frame);
