/** Canvas curve editor: drag keys, double-click to add, alt/right-click to delete. */

import { sampleCurveKeys, type CurveKey } from '../src/index';

const W = 300;
const H = 120;
const PAD = 10;

export class CurveEditor {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private keys: CurveKey[];
  private dragIndex = -1;
  private vMin = 0;
  private vMax = 1;

  constructor(keys: CurveKey[], private onChange: (keys: CurveKey[]) => void) {
    this.keys = keys.map((k) => ({ ...k })).sort((a, b) => a.t - b.t);
    this.el = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'curve-canvas';
    this.canvas.width = W * 2;
    this.canvas.height = H * 2;
    this.canvas.style.height = `${H}px`;
    this.canvas.setAttribute('aria-label', 'Curve editor. Drag points to edit, double-click to add, right-click a point to remove.');
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(2, 2);
    this.el.appendChild(this.canvas);
    const hint = document.createElement('p');
    hint.className = 'editor-hint';
    hint.textContent = 'drag points · double-click to add · right-click to remove';
    this.el.appendChild(hint);

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('dblclick', this.onDbl);
    this.canvas.addEventListener('contextmenu', this.onCtx);
    this.updateRange();
    this.draw();
  }

  private updateRange(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of this.keys) {
      lo = Math.min(lo, k.v);
      hi = Math.max(hi, k.v);
    }
    // include sampled extremes (catmull-rom can overshoot)
    for (let i = 0; i <= 24; i++) {
      const v = sampleCurveKeys(this.keys, i / 24);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 0.5) {
      const mid = (hi + lo) / 2;
      lo = mid - 0.25;
      hi = mid + 0.25;
    }
    const span = hi - lo;
    this.vMin = Math.min(0, lo - span * 0.12);
    this.vMax = hi + span * 0.12;
  }

  private toPx(t: number, v: number): [number, number] {
    const x = PAD + t * (W - PAD * 2);
    const y = H - PAD - ((v - this.vMin) / (this.vMax - this.vMin)) * (H - PAD * 2);
    return [x, y];
  }

  private fromPx(x: number, y: number): [number, number] {
    const t = Math.min(1, Math.max(0, (x - PAD) / (W - PAD * 2)));
    const v = this.vMin + ((H - PAD - y) / (H - PAD * 2)) * (this.vMax - this.vMin);
    return [t, v];
  }

  private localPos(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  private hitTest(x: number, y: number): number {
    for (let i = 0; i < this.keys.length; i++) {
      const [kx, ky] = this.toPx(this.keys[i].t, this.keys[i].v);
      if (Math.hypot(kx - x, ky - y) < 9) return i;
    }
    return -1;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const [x, y] = this.localPos(e);
    this.dragIndex = this.hitTest(x, y);
    if (this.dragIndex >= 0) this.canvas.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.dragIndex < 0) return;
    const [x, y] = this.localPos(e);
    const [t, v] = this.fromPx(x, y);
    const k = this.keys[this.dragIndex];
    k.v = Math.round(v * 1000) / 1000;
    // keep first/last keys pinned to t=0/1 when they are the boundary keys
    if (this.dragIndex > 0 && this.dragIndex < this.keys.length - 1) {
      const lo = this.keys[this.dragIndex - 1].t + 0.01;
      const hi = this.keys[this.dragIndex + 1].t - 0.01;
      k.t = Math.round(Math.min(hi, Math.max(lo, t)) * 1000) / 1000;
    }
    this.draw();
    this.onChange(this.keys.map((kk) => ({ ...kk })));
  };

  private onUp = (): void => {
    if (this.dragIndex >= 0) {
      this.dragIndex = -1;
      this.updateRange();
      this.draw();
    }
  };

  private onDbl = (e: MouseEvent): void => {
    const [x, y] = this.localPos(e);
    const [t, v] = this.fromPx(x, y);
    this.keys.push({ t: Math.round(t * 1000) / 1000, v: Math.round(v * 1000) / 1000 });
    this.keys.sort((a, b) => a.t - b.t);
    this.draw();
    this.onChange(this.keys.map((k) => ({ ...k })));
  };

  private onCtx = (e: MouseEvent): void => {
    e.preventDefault();
    const [x, y] = this.localPos(e);
    const i = this.hitTest(x, y);
    if (i >= 0 && this.keys.length > 2) {
      this.keys.splice(i, 1);
      this.updateRange();
      this.draw();
      this.onChange(this.keys.map((k) => ({ ...k })));
    }
  };

  private draw(): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);

    // grid + zero line
    c.strokeStyle = '#1d2935';
    c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = PAD + (i / 4) * (W - PAD * 2);
      c.beginPath();
      c.moveTo(x, PAD);
      c.lineTo(x, H - PAD);
      c.stroke();
    }
    if (this.vMin < 0 && this.vMax > 0) {
      const [, zy] = this.toPx(0, 0);
      c.strokeStyle = '#32465a';
      c.beginPath();
      c.moveTo(PAD, zy);
      c.lineTo(W - PAD, zy);
      c.stroke();
    }

    // curve
    c.strokeStyle = '#2dd4bf';
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const v = sampleCurveKeys(this.keys, t);
      const [x, y] = this.toPx(t, v);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();

    // keys
    for (const k of this.keys) {
      const [x, y] = this.toPx(k.t, k.v);
      c.fillStyle = '#dbe7f0';
      c.beginPath();
      c.arc(x, y, 4.5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#2dd4bf';
      c.lineWidth = 1.5;
      c.stroke();
    }

    // range labels
    c.fillStyle = '#56708a';
    c.font = '9px sans-serif';
    c.fillText(this.vMax.toFixed(2), 2, 10);
    c.fillText(this.vMin.toFixed(2), 2, H - 2);
  }

  dispose(): void {
    window.removeEventListener('pointerup', this.onUp);
  }
}
