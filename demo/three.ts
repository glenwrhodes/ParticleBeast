/** ParticleBeast three.js addon demo: effects living in a real three.js scene graph. */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ParticleBeastThree, type EffectDefinition } from '../src/three/index';
import { Stats } from '../shared/stats';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const statsEl = document.getElementById('stats')!;

// ---- three.js scene ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(0x0a0e13);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0e13, 26, 60);

const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 200);
camera.position.set(8, 5.5, 11);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 4;
controls.maxDistance = 35;

scene.add(new THREE.HemisphereLight(0x90b4d0, 0x1a2128, 0.7));
const key = new THREE.DirectionalLight(0xfff2dd, 1.1);
key.position.set(6, 10, 4);
scene.add(key);

// Ground
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(24, 64),
  new THREE.MeshStandardMaterial({ color: 0x18222c, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
scene.add(new THREE.GridHelper(48, 48, 0x2a3a4a, 0x1c2935));

// A few props
const rock = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.9, 0),
  new THREE.MeshStandardMaterial({ color: 0x3a4754, roughness: 0.9, flatShading: true })
);
rock.position.set(-3.4, 0.5, 2.6);
scene.add(rock);

const archway = new THREE.Mesh(
  new THREE.TorusGeometry(1.8, 0.16, 12, 48),
  new THREE.MeshStandardMaterial({ color: 0x2dd4bf, roughness: 0.4, metalness: 0.6, emissive: 0x0d4d44 })
);
archway.position.set(4.5, 2, -3);
scene.add(archway);

// A little ship that flies in a circle (the thruster is parented to it)
const ship = new THREE.Group();
const hull = new THREE.Mesh(
  new THREE.ConeGeometry(0.45, 1.6, 5),
  new THREE.MeshStandardMaterial({ color: 0xc8d4de, roughness: 0.35, metalness: 0.7, flatShading: true })
);
hull.rotation.x = Math.PI / 2;
ship.add(hull);
scene.add(ship);

// ---- ParticleBeast ----
const particles = new ParticleBeastThree(renderer);

let explosionDef: EffectDefinition | null = null;

async function setupEffects(): Promise<void> {
  const [campfire, portal, thruster, explosion] = await Promise.all([
    particles.loadEffect('/presets/campfire.json'),
    particles.loadEffect('/presets/portal.json'),
    particles.loadEffect('/presets/thruster.json'),
    particles.loadEffect('/presets/explosion.json'),
  ]);
  explosionDef = explosion;

  // Campfire by the rock — a plain scene-level effect
  particles.spawn(campfire, { parent: scene, position: [-3.4, 0, 0.8] });

  // Portal inside the archway — rotated upright, tinted teal to match
  const fxPortal = particles.spawn(portal, { parent: scene, tint: '#48ff96', scale: 0.9 });
  fxPortal.position.set(4.5, 2, -3);
  fxPortal.rotation.x = Math.PI / 2;

  // Thruster parented to the ship, pointing backwards
  const fxThruster = particles.spawn(thruster, { parent: ship, scale: 0.45, tint: '#7fd1ff' });
  fxThruster.position.set(0, 0, -0.9);
  fxThruster.rotation.x = -Math.PI / 2;
}

// Click the ground to spawn an explosion (one-shots auto-dispose)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downX = 0;
let downY = 0;
canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || !explosionDef) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(ground, false)[0];
  if (!hit) return;
  const tints = ['#ffffff', '#ff9a3d', '#5ad1ff', '#9dff57'];
  particles.spawn(explosionDef, {
    parent: scene,
    position: [hit.point.x, hit.point.y + 1, hit.point.z],
    scale: 0.8,
    tint: tints[Math.floor(Math.random() * tints.length)],
  });
});

// ---- Frame loop ----
const stats = new Stats();
const clock = new THREE.Clock();

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  // Fly the ship in a tilted circle; the thruster follows for free
  const r = 7.5;
  ship.position.set(Math.cos(t * 0.55) * r, 3.4 + Math.sin(t * 1.1) * 0.7, Math.sin(t * 0.55) * r);
  ship.lookAt(
    Math.cos(t * 0.55 + 0.1) * r,
    3.4 + Math.sin((t + 0.09) * 1.1) * 0.7,
    Math.sin(t * 0.55 + 0.1) * r
  );

  rock.rotation.y += dt * 0.1;
  archway.rotation.z += dt * 0.25;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
  }

  controls.update();
  particles.update(dt);
  renderer.render(scene, camera);
  particles.render(camera);

  stats.tick();
  statsEl.textContent = `${stats.fps} fps · ${particles.particleCount.toLocaleString()} particles`;
  requestAnimationFrame(frame);
}

void setupEffects();
requestAnimationFrame(frame);
