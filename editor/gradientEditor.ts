/** Gradient editor: color stops on top row, alpha stops on bottom row. */

import type { GradientJSON } from '../src/index';

const W = 300;
const BAR_H = 26;
const STOP_H = 14;
const H = BAR_H + STOP_H * 2 + 6;

type StopRef = { row: 'color' | 'alpha'; index: number } | null;

function rgbToHex(c: [number, number, number]): string {
  const h = (v: number): string => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [
    parseInt(m.slice(0, 2), 16) / 255,
    parseInt(m.slice(2, 4), 16) / 255,
    parseInt(m.slice(4, 6), 16) / 255,
  ];
}

export class GradientEditor {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private g: GradientJSON;
  private selected: StopRef = null;
  private dragging = false;
  private detail: HTMLElement;

  constructor(gradient: GradientJSON, private onChange: (g: GradientJSON) => void) {
    this.g = {
      colorKeys: (gradient.colorKeys?.length ? gradient.colorKeys : [{ t: 0, color: [1, 1, 1] as [number, number, number] }]).map((k) => ({ t: k.t, color: [...k.color] as [number, number, number] })),
      alphaKeys: (gradient.alphaKeys?.length ? gradient.alphaKeys : [{ t: 0, alpha: 1 }]).map((k) => ({ ...k })),
    };
    this.el = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gradient-canvas';
    this.canvas.width = W * 2;
    this.canvas.height = H * 2;
    this.canvas.style.height = `${H}px`;
    this.canvas.setAttribute('aria-label', 'Gradient editor. Top stops are color, bottom stops are alpha. Drag to move, double-click a row to add, right-click to remove.');
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(2, 2);
    this.el.appendChild(this.canvas);
    this.detail = document.createElement('div');
    this.el.appendChild(this.detail);
    const hint = document.createElement('p');
    hint.className = 'editor-hint';
    hint.textContent = 'top: color stops · bottom: alpha stops · double-click row to add · right-click to remove';
    this.el.appendChild(hint);

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('dblclick', this.onDbl);
    this.canvas.addEventListener('contextmenu', this.onCtx);
    this.draw();
    this.renderDetail();
  }

  private emit(): void {
    this.g.colorKeys.sort((a, b) => a.t - b.t);
    this.g.alphaKeys.sort((a, b) => a.t - b.t);
    this.onChange({
      colorKeys: this.g.colorKeys.map((k) => ({ t: k.t, color: [...k.color] as [number, number, number] })),
      alphaKeys: this.g.alphaKeys.map((k) => ({ ...k })),
    });
  }

  private toX(t: number): number {
    return 6 + t * (W - 12);
  }

  private fromX(x: number): number {
    return Math.min(1, Math.max(0, (x - 6) / (W - 12)));
  }

  private localPos(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  private rowAt(y: number): 'color' | 'alpha' | 'bar' {
    if (y < STOP_H + 2) return 'color';
    if (y > STOP_H + BAR_H + 2) return 'alpha';
    return 'bar';
  }

  private hitStop(x: number, y: number): StopRef {
    const row = this.rowAt(y);
    if (row === 'bar') return null;
    const keys = row === 'color' ? this.g.colorKeys : this.g.alphaKeys;
    for (let i = 0; i < keys.length; i++) {
      if (Math.abs(this.toX(keys[i].t) - x) < 7) return { row, index: i };
    }
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const [x, y] = this.localPos(e);
    const hit = this.hitStop(x, y);
    this.selected = hit;
    if (hit) {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
    }
    this.draw();
    this.renderDetail();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging || !this.selected) return;
    const [x] = this.localPos(e);
    const keys = this.selected.row === 'color' ? this.g.colorKeys : this.g.alphaKeys;
    keys[this.selected.index].t = Math.round(this.fromX(x) * 1000) / 1000;
    this.draw();
    this.emit();
  };

  private onUp = (): void => {
    this.dragging = false;
  };

  private onDbl = (e: MouseEvent): void => {
    const [x, y] = this.localPos(e);
    const row = this.rowAt(y);
    const t = this.fromX(x);
    if (row === 'color') {
      this.g.colorKeys.push({ t, color: this.sampleColor(t) });
      this.g.colorKeys.sort((a, b) => a.t - b.t);
      this.selected = { row: 'color', index: this.g.colorKeys.findIndex((k) => k.t === t) };
    } else if (row === 'alpha') {
      this.g.alphaKeys.push({ t, alpha: this.sampleAlpha(t) });
      this.g.alphaKeys.sort((a, b) => a.t - b.t);
      this.selected = { row: 'alpha', index: this.g.alphaKeys.findIndex((k) => k.t === t) };
    }
    this.draw();
    this.renderDetail();
    this.emit();
  };

  private onCtx = (e: MouseEvent): void => {
    e.preventDefault();
    const [x, y] = this.localPos(e);
    const hit = this.hitStop(x, y);
    if (!hit) return;
    const keys = hit.row === 'color' ? this.g.colorKeys : this.g.alphaKeys;
    if (keys.length > 1) {
      keys.splice(hit.index, 1);
      this.selected = null;
      this.draw();
      this.renderDetail();
      this.emit();
    }
  };

  private sampleColor(t: number): [number, number, number] {
    const keys = [...this.g.colorKeys].sort((a, b) => a.t - b.t);
    if (t <= keys[0].t) return [...keys[0].color];
    const last = keys[keys.length - 1];
    if (t >= last.t) return [...last.color];
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) {
        const u = (t - keys[i].t) / (keys[i + 1].t - keys[i].t || 1e-6);
        return [0, 1, 2].map((c) => keys[i].color[c] + (keys[i + 1].color[c] - keys[i].color[c]) * u) as [number, number, number];
      }
    }
    return [...last.color];
  }

  private sampleAlpha(t: number): number {
    const keys = [...this.g.alphaKeys].sort((a, b) => a.t - b.t);
    if (t <= keys[0].t) return keys[0].alpha;
    const last = keys[keys.length - 1];
    if (t >= last.t) return last.alpha;
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) {
        const u = (t - keys[i].t) / (keys[i + 1].t - keys[i].t || 1e-6);
        return keys[i].alpha + (keys[i + 1].alpha - keys[i].alpha) * u;
      }
    }
    return last.alpha;
  }

  private draw(): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const barY = STOP_H + 3;

    // checkerboard
    c.fillStyle = '#202a35';
    c.fillRect(6, barY, W - 12, BAR_H);
    c.fillStyle = '#2c3946';
    for (let x = 6; x < W - 6; x += 12) {
      c.fillRect(x, barY, 6, BAR_H / 2);
      c.fillRect(x + 6, barY + BAR_H / 2, 6, BAR_H / 2);
    }

    // gradient bar
    for (let i = 0; i < W - 12; i++) {
      const t = i / (W - 13);
      const col = this.sampleColor(t);
      const a = this.sampleAlpha(t);
      c.fillStyle = `rgba(${col.map((v) => Math.round(v * 255)).join(',')},${a})`;
      c.fillRect(6 + i, barY, 1, BAR_H);
    }

    // color stops (top)
    for (let i = 0; i < this.g.colorKeys.length; i++) {
      const k = this.g.colorKeys[i];
      this.drawStop(this.toX(k.t), STOP_H / 2 + 1, rgbToHex(k.color), this.isSel('color', i));
    }
    // alpha stops (bottom)
    for (let i = 0; i < this.g.alphaKeys.length; i++) {
      const k = this.g.alphaKeys[i];
      const v = Math.round(k.alpha * 255);
      this.drawStop(this.toX(k.t), barY + BAR_H + STOP_H / 2 + 2, `rgb(${v},${v},${v})`, this.isSel('alpha', i));
    }
  }

  private isSel(row: 'color' | 'alpha', i: number): boolean {
    return !!this.selected && this.selected.row === row && this.selected.index === i;
  }

  private drawStop(x: number, y: number, fill: string, selected: boolean): void {
    const c = this.ctx;
    c.fillStyle = fill;
    c.strokeStyle = selected ? '#2dd4bf' : '#7d92a6';
    c.lineWidth = selected ? 2 : 1;
    c.beginPath();
    c.arc(x, y, 5, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }

  private renderDetail(): void {
    this.detail.innerHTML = '';
    if (!this.selected) return;
    const row = document.createElement('div');
    row.className = 'field-row';
    if (this.selected.row === 'color') {
      const k = this.g.colorKeys[this.selected.index];
      const lab = document.createElement('label');
      lab.textContent = 'Stop color';
      const wrap = document.createElement('div');
      wrap.className = 'field-input';
      const input = document.createElement('input');
      input.type = 'color';
      input.value = rgbToHex(k.color);
      input.setAttribute('aria-label', 'Selected gradient stop color');
      input.addEventListener('input', () => {
        k.color = hexToRgb(input.value);
        this.draw();
        this.emit();
      });
      wrap.appendChild(input);
      row.append(lab, wrap);
    } else {
      const k = this.g.alphaKeys[this.selected.index];
      const lab = document.createElement('label');
      lab.textContent = 'Stop alpha';
      const wrap = document.createElement('div');
      wrap.className = 'field-input';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.value = String(k.alpha);
      input.setAttribute('aria-label', 'Selected gradient stop alpha');
      input.addEventListener('input', () => {
        k.alpha = parseFloat(input.value);
        this.draw();
        this.emit();
      });
      wrap.appendChild(input);
      row.append(lab, wrap);
    }
    this.detail.appendChild(row);
  }

  dispose(): void {
    window.removeEventListener('pointerup', this.onUp);
  }
}
