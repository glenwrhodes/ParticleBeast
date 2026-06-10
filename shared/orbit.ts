/** Pointer-driven orbit camera producing view/projection matrices. */

import { mat4LookAt, mat4Perspective, type Vec3 } from '../src/core/math';

export class OrbitCamera {
  yaw = Math.PI / 4;
  pitch = 0.42;
  distance = 9;
  target: Vec3 = [0, 1.2, 0];
  minDistance = 1.5;
  maxDistance = 40;
  minPitch = -1.45;
  maxPitch = 1.45;
  /** Radians per second of idle auto-rotation (0 = off) */
  autoRotate = 0;

  readonly view = new Float32Array(16);
  readonly proj = new Float32Array(16);
  readonly eye: Vec3 = [0, 0, 0];

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private lastInteraction = 0;
  private pinchDist = 0;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.style.touchAction = 'none';
  }

  private onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastInteraction = performance.now();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw -= dx * 0.008;
    this.pitch = Math.min(this.maxPitch, Math.max(this.minPitch, this.pitch + dy * 0.008));
    this.lastInteraction = performance.now();
  };

  private onUp = (): void => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance * (1 + e.deltaY * 0.001)));
    this.lastInteraction = performance.now();
  };

  private onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      this.pinchDist = Math.hypot(dx, dy);
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.hypot(dx, dy);
      if (this.pinchDist > 0) {
        this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance * (this.pinchDist / d)));
      }
      this.pinchDist = d;
      this.lastInteraction = performance.now();
    }
  };

  update(dt: number): void {
    if (this.autoRotate !== 0 && !this.dragging && performance.now() - this.lastInteraction > 3000) {
      this.yaw += this.autoRotate * dt;
    }
    const cp = Math.cos(this.pitch);
    this.eye[0] = this.target[0] + Math.cos(this.yaw) * cp * this.distance;
    this.eye[1] = this.target[1] + Math.sin(this.pitch) * this.distance;
    this.eye[2] = this.target[2] + Math.sin(this.yaw) * cp * this.distance;
    mat4LookAt(this.view, this.eye, this.target, [0, 1, 0]);
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    mat4Perspective(this.proj, (50 * Math.PI) / 180, aspect, 0.1, 200);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
  }
}
