/** Small DOM field builders for the inspector. */

import type { CurveKey, GradientJSON, ScalarValueJSON, Vec3JSON } from '../src/index';
import { CurveEditor } from './curveEditor';
import { GradientEditor } from './gradientEditor';
import { openModal } from './modal';
import { SPRITES } from '../shared/sprites';

export function row(label: string, ...inputs: HTMLElement[]): HTMLElement {
  const r = document.createElement('div');
  r.className = 'field-row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const wrap = document.createElement('div');
  wrap.className = 'field-input';
  wrap.append(...inputs);
  r.append(lab, wrap);
  return r;
}

export function numberInput(value: number, onChange: (v: number) => void, opts: { step?: number; min?: number; max?: number; label?: string } = {}): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'num-input';
  input.value = String(Math.round(value * 10000) / 10000);
  if (opts.step !== undefined) input.step = String(opts.step);
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  input.setAttribute('aria-label', opts.label ?? 'number value');
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!isNaN(v)) onChange(v);
  });
  return input;
}

export function textInput(value: string, onChange: (v: string) => void, label: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'text-input';
  input.value = value;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

export function checkbox(value: boolean, onChange: (v: boolean) => void, label: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

export function selectInput<T extends string>(value: T, options: readonly T[] | readonly { value: T; label: string }[], onChange: (v: T) => void, label: string): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'select-input';
  sel.setAttribute('aria-label', label);
  for (const o of options) {
    const opt = document.createElement('option');
    if (typeof o === 'string') {
      opt.value = o;
      opt.textContent = o;
    } else {
      opt.value = o.value;
      opt.textContent = o.label;
    }
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

export function vec3Input(value: Vec3JSON | undefined, fallback: Vec3JSON, onChange: (v: Vec3JSON) => void, label: string): HTMLElement {
  const v: Vec3JSON = [...(value ?? fallback)] as Vec3JSON;
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = '4px';
  (['X', 'Y', 'Z'] as const).forEach((axis, i) => {
    const input = numberInput(v[i], (n) => {
      v[i] = n;
      onChange([...v] as Vec3JSON);
    }, { step: 0.1, label: `${label} ${axis}` });
    input.style.width = '56px';
    wrap.appendChild(input);
  });
  return wrap;
}

// ---- ScalarValue editor ----

type SVKind = 'constant' | 'random' | 'curve' | 'randomCurves';

function kindOf(v: ScalarValueJSON | undefined): SVKind {
  if (v === undefined || typeof v === 'number') return 'constant';
  return v.type;
}

function constOf(v: ScalarValueJSON | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === 'number') return v;
  if (v.type === 'constant') return v.value;
  if (v.type === 'random') return (v.min + v.max) / 2;
  return fallback;
}

const DEFAULT_KEYS: CurveKey[] = [{ t: 0, v: 1 }, { t: 1, v: 1 }];

/**
 * Full Unity-style MinMaxCurve editor: a type dropdown plus the matching inputs.
 */
export function scalarValueField(
  label: string,
  value: ScalarValueJSON | undefined,
  fallback: number,
  onChange: (v: ScalarValueJSON) => void
): HTMLElement {
  const container = document.createElement('div');

  const render = (v: ScalarValueJSON | undefined): void => {
    container.innerHTML = '';
    const kind = kindOf(v);

    const typeSel = selectInput<SVKind>(kind, [
      { value: 'constant', label: 'Constant' },
      { value: 'random', label: 'Random range' },
      { value: 'curve', label: 'Curve' },
      { value: 'randomCurves', label: 'Random between curves' },
    ], (k) => {
      let next: ScalarValueJSON;
      const base = constOf(v, fallback);
      if (k === 'constant') next = base;
      else if (k === 'random') next = { type: 'random', min: base * 0.5, max: base };
      else if (k === 'curve') next = { type: 'curve', keys: DEFAULT_KEYS.map((kk) => ({ ...kk })), scale: base || 1 };
      else next = {
        type: 'randomCurves',
        min: [{ t: 0, v: 0.5 }, { t: 1, v: 0.5 }],
        max: DEFAULT_KEYS.map((kk) => ({ ...kk })),
        scale: base || 1,
      };
      onChange(next);
      render(next);
    }, `${label} value type`);
    typeSel.style.maxWidth = '170px';

    const headerInputs: HTMLElement[] = [typeSel];

    if (kind === 'constant') {
      headerInputs.push(numberInput(constOf(v, fallback), (n) => onChange(n), { step: 0.1, label }));
    } else if (kind === 'random' && typeof v === 'object' && v !== null && 'min' in v && v.type === 'random') {
      const state = { min: v.min, max: v.max };
      headerInputs.push(
        numberInput(state.min, (n) => { state.min = n; onChange({ type: 'random', ...state }); }, { step: 0.1, label: `${label} min` }),
        numberInput(state.max, (n) => { state.max = n; onChange({ type: 'random', ...state }); }, { step: 0.1, label: `${label} max` })
      );
    }

    container.appendChild(row(label, ...headerInputs));

    if (kind === 'curve' && typeof v === 'object' && v !== null && v.type === 'curve') {
      const state = { keys: v.keys, scale: v.scale ?? 1 };
      container.appendChild(row('Scale', numberInput(state.scale, (n) => {
        state.scale = n;
        onChange({ type: 'curve', keys: state.keys, scale: state.scale });
      }, { step: 0.1, label: `${label} curve scale` })));
      const ed = new CurveEditor(state.keys, (keys) => {
        state.keys = keys;
        onChange({ type: 'curve', keys, scale: state.scale });
      });
      container.appendChild(ed.el);
    }

    if (kind === 'randomCurves' && typeof v === 'object' && v !== null && v.type === 'randomCurves') {
      const state = { min: v.min, max: v.max, scale: v.scale ?? 1 };
      container.appendChild(row('Scale', numberInput(state.scale, (n) => {
        state.scale = n;
        onChange({ type: 'randomCurves', min: state.min, max: state.max, scale: state.scale });
      }, { step: 0.1, label: `${label} curves scale` })));
      const labMax = document.createElement('p');
      labMax.className = 'editor-hint';
      labMax.textContent = 'Max curve';
      container.appendChild(labMax);
      const edMax = new CurveEditor(state.max, (keys) => {
        state.max = keys;
        onChange({ type: 'randomCurves', min: state.min, max: state.max, scale: state.scale });
      });
      container.appendChild(edMax.el);
      const labMin = document.createElement('p');
      labMin.className = 'editor-hint';
      labMin.textContent = 'Min curve';
      container.appendChild(labMin);
      const edMin = new CurveEditor(state.min, (keys) => {
        state.min = keys;
        onChange({ type: 'randomCurves', min: state.min, max: state.max, scale: state.scale });
      });
      container.appendChild(edMin.el);
    }
  };

  render(value);
  return container;
}

export function gradientField(label: string, value: GradientJSON, onChange: (g: GradientJSON) => void): HTMLElement {
  const container = document.createElement('div');
  const lab = document.createElement('p');
  lab.className = 'editor-hint';
  lab.textContent = label;
  container.appendChild(lab);
  const ed = new GradientEditor(value, onChange);
  container.appendChild(ed.el);
  return container;
}

// ---- Sprite picker ----

export function spriteField(value: string | undefined, onChange: (path: string) => void): HTMLElement {
  // sprite paths in presets are relative like "../sprites/foo.png"
  const current = (value ?? '').replace(/^(\.\.\/)+/, '');
  const btn = document.createElement('button');
  btn.className = 'sprite-btn';
  btn.setAttribute('aria-label', 'Choose sprite texture');
  const img = document.createElement('img');
  img.src = current ? `/${current}` : '/sprites/circle_01.png';
  img.alt = '';
  const span = document.createElement('span');
  span.textContent = current ? current.split('/').pop()! : '(none)';
  btn.append(img, span);

  btn.addEventListener('click', () => {
    openModal('Choose sprite', (body, close) => {
      const grid = document.createElement('div');
      grid.className = 'sprite-grid';
      for (const path of SPRITES) {
        const cell = document.createElement('button');
        cell.className = 'sprite-cell' + (path === current ? ' selected' : '');
        cell.setAttribute('aria-label', `Use sprite ${path}`);
        const ci = document.createElement('img');
        ci.src = `/${path}`;
        ci.alt = '';
        ci.loading = 'lazy';
        const cs = document.createElement('span');
        cs.textContent = path.split('/').pop()!;
        cell.append(ci, cs);
        cell.addEventListener('click', () => {
          onChange(`../${path}`);
          img.src = `/${path}`;
          span.textContent = path.split('/').pop()!;
          close();
        });
        grid.appendChild(cell);
      }
      body.appendChild(grid);
    });
  });

  return btn;
}
