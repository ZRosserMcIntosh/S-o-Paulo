// São Paulo World · driving test track.
// Physics: the OpenRoad Dynamics core (github.com/ZRosserMcIntosh/Game-Vehicle-Dynamics, MIT)
// compiled to WebAssembly. Rendering: three.js (MIT). This file only renders and reads input;
// every force, slip and aid intervention comes from the core.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/libs/meshopt_decoder.module.js';
import createOrdModule from './ord.mjs';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('spw-drive:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('spw-drive:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- Physics module ----------
let M;
try {
  M = await createOrdModule();
} catch (e) {
  $('loadMsg').textContent = 'Could not start the WebAssembly physics in this browser: ' + e.message;
  throw e;
}
const HEADER = M._ord_state_header(), PER_WHEEL = M._ord_state_per_wheel();
const statePtr = M._ord_state() / 8;
const S = (i) => M.HEAPF64[statePtr + i];
const W = (w, i) => M.HEAPF64[statePtr + HEADER + PER_WHEEL * w + i];
const LIMITER = [7200, 6500, 6800, 8500, 12500];
const G = 9.81;

// ISO 8855 (x forward, y left, z up) -> three.js (y up): (x, z, -y)
const v3 = (x, y, z) => new THREE.Vector3(x, z, -y);

// ---------- Settings ----------
const settings = {
  car: store.get('car', 0),
  preset: store.get('preset', 0),
  abs: true, tcs: 2, esc: 2, auto: true,
  cam: store.get('cam', 0),
};
function presetAids(p) {
  if (p === 0) return { abs: true, tcs: 2, esc: 2, auto: true };
  if (p === 1) return { abs: true, tcs: 1, esc: 0, auto: true };
  return { abs: false, tcs: 0, esc: 0, auto: false };
}
Object.assign(settings, presetAids(settings.preset));

// ---------- Renderer & scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const SKY = new THREE.Color('#9fb8d3');
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 180, 900);
const camera = new THREE.PerspectiveCamera(60, 1, 0.2, 2000);
scene.add(new THREE.HemisphereLight('#dbe8ff', '#4a4136', 1.4));
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.5, 1, 0.35).normalize();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 78 : 60; // portrait phones need a wider view of the road
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Proving ground ----------
function asphaltTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#4b4f55'; g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const asphalt = asphaltTexture();
{
  const tex = asphalt.clone(); tex.needsUpdate = true; tex.repeat.set(280, 200);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1000),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(v3(200, -20, 0));
  ground.receiveShadow = true;
  scene.add(ground);
  // grass beyond the pad
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: '#56703f', roughness: 1 }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.6; scene.add(grass);
}
// Road paint and overlays sit on the pad via polygon offset (robust on 16-bit depth buffers).
const decal = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
const paint = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.7, ...decal });
const yellowPaint = new THREE.MeshStandardMaterial({ color: '#f0c419', roughness: 0.7, ...decal });
function stripe(x0, y0, x1, y1, w, mat = paint) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
  m.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, 0.003));
  m.receiveShadow = true;
  scene.add(m);
}
// Straight: edge lines, dashed centre, start line, 100 m boards
stripe(-40, 6, 620, 6, 0.15); stripe(-40, -6, 620, -6, 0.15);
for (let x = -40; x < 620; x += 12) stripe(x, 0, x + 6, 0, 0.12);
stripe(0, -6, 0, 6, 0.5);
// Skidpad R40, centre (120, 110)
const SKID = { x: 120, y: 110, r: 40 };
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(SKID.r - 0.15, SKID.r + 0.15, 256), yellowPaint);
  ring.rotation.x = -Math.PI / 2; ring.position.copy(v3(SKID.x, SKID.y, 0.002)); scene.add(ring);
  for (const r of [36, 44]) {
    const g = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r + 0.08, 256), paint);
    g.rotation.x = -Math.PI / 2; g.position.copy(v3(SKID.x, SKID.y, 0.002)); scene.add(g);
  }
}
// Wet section (matches the patch in ord_web.cpp: x 250..450, y 25..75)
{
  const wet = new THREE.Mesh(new THREE.PlaneGeometry(200, 50),
    new THREE.MeshStandardMaterial({ color: '#1f2a36', roughness: 0.08, metalness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  wet.rotation.x = -Math.PI / 2; wet.position.copy(v3(350, 50, 0.001)); wet.receiveShadow = true; scene.add(wet);
  stripe(250, 25, 450, 25, 0.2, yellowPaint); stripe(250, 75, 450, 75, 0.2, yellowPaint);
}
// Bump lane: height field sampled from the physics' own ground function
const LANE_Y = M._ord_bump_lane_y();
{
  const x0 = 40, x1 = 300, y0 = LANE_Y - 4, y1 = LANE_Y + 4, dx = 0.1, dy = 0.1;
  const nx = Math.round((x1 - x0) / dx) + 1, ny = Math.round((y1 - y0) / dy) + 1;
  const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
  const asphaltC = new THREE.Color('#ffffff'), kerbR = new THREE.Color('#d22a1f'), kerbW = new THREE.Color('#f4f4f4'), bumpC = new THREE.Color('#f0c419');
  for (let j = 0; j < ny; ++j) for (let i = 0; i < nx; ++i) {
    const x = x0 + i * dx, y = y0 + j * dy, h = M._ord_ground_height(x, y);
    const k = j * nx + i;
    pos.set([x, h, -y], k * 3);
    uv.set([x / 5, y / 5], k * 2);
    let c = asphaltC;
    const e = y - (LANE_Y + 3);
    if (e > 0 && e < 0.6) c = Math.floor(x) % 2 ? kerbR : kerbW;
    else if (h > 0.004 && Math.abs(y - LANE_Y) < 3) c = Math.floor(y * 2) % 2 ? bumpC : asphaltC;
    col.set([c.r, c.g, c.b], k * 3);
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let p = 0;
  for (let j = 0; j < ny - 1; ++j) for (let i = 0; i < nx - 1; ++i) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.set([a, b, c, b, d, c], p); p += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const tex = asphalt.clone(); tex.needsUpdate = true;
  const lane = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  lane.receiveShadow = true;
  lane.position.y = 0.001;
  scene.add(lane);
  stripe(0, LANE_Y - 3, 40, LANE_Y - 3, 0.15); stripe(0, LANE_Y + 3, 40, LANE_Y + 3, 0.15);
}
// Slalom cones: 10 cones, 18 m apart, at y = -45
const SLALOM = { y: -45, x0: 40, gap: 18, n: 10 };
const cones = [];
{
  const coneGeo = new THREE.ConeGeometry(0.17, 0.7, 20);
  const coneMat = new THREE.MeshStandardMaterial({ color: '#ff6a13', roughness: 0.6 });
  for (let i = 0; i < SLALOM.n; ++i) {
    const m = new THREE.Mesh(coneGeo, coneMat);
    m.castShadow = true;
    const x = SLALOM.x0 + i * SLALOM.gap;
    m.position.copy(v3(x, SLALOM.y, 0.35));
    scene.add(m);
    cones.push({ mesh: m, home: m.position.clone(), hit: false, vel: new THREE.Vector3(), spin: 0 });
  }
}
function sign(text, x, y, sub = '') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#1d57c2'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(8, 8, 496, 144);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = '900 64px "Big Shoulders Display", Impact, sans-serif'; g.fillText(text, 256, sub ? 82 : 102);
  if (sub) { g.font = '600 28px "Public Sans", sans-serif'; g.fillText(sub, 256, 128); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.5), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
  board.position.copy(v3(x, y, 2.6));
  board.rotation.y = -Math.PI / 2; // faces the approaching car (+x travel)
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.9), new THREE.MeshStandardMaterial({ color: '#888' }));
  post.position.copy(v3(x, y, 0.95)); post.castShadow = true;
  scene.add(board, post);
}
document.fonts?.ready.then(() => {
  sign('STRAIGHT', -12, 9, '0 – 600 m');
  sign('SKIDPAD', 105, 72, 'R40 · constant radius');
  sign('SLALOM', 22, -40, '10 cones · 18 m');
  sign('BUMPS', 25, LANE_Y + 5, 'bumps · rumble · pothole · kerb');
  sign('WET', 240, 50, 'reduced grip · 200 m');
  for (let x = 100; x <= 600; x += 100) sign(`${x} m`, x, 9);
});

// ---------- Car ----------
const carRoot = new THREE.Group();
scene.add(carRoot);
const placeholder = new THREE.Group();
carRoot.add(placeholder);
const wheelRigs = []; // placeholder wheels: {steer, spin}
let restWheelZ = [0, 0, 0, 0];
let groundZBody = -0.45;
let model = null; // { wrapper, rigs:[{steer,spin}|null x4], hasWheels }
let spinAngle = [0, 0, 0, 0];

const bodyMat = new THREE.MeshPhysicalMaterial({ color: '#d22a1f', roughness: 0.32, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.12 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: '#33465e', roughness: 0.08, metalness: 0.6 });
const tireMat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.85 });
const rimMat = new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.3, metalness: 0.9 });

function geometryFromState() {
  const n = S(22);
  const wheels = [];
  for (let w = 0; w < n; ++w) wheels.push({ x: W(w, 0), y: W(w, 1), z: W(w, 2), r: W(w, 3) });
  return wheels;
}

function buildPlaceholder() {
  placeholder.clear();
  wheelRigs.length = 0;
  const wh = geometryFromState();
  const xf = Math.max(...wh.map((w) => w.x)), xr = Math.min(...wh.map((w) => w.x));
  const half = Math.max(...wh.map((w) => Math.abs(w.y)));
  const r = wh[0].r;
  const len = xf - xr + 1.7, wid = 2 * half - 0.3;
  const bottom = groundZBody + 0.16, top = groundZBody + 0.92;
  const midX = (xf + xr) / 2;
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.copy(v3(x, y, z)); m.castShadow = true; placeholder.add(m); return m; };
  add(new THREE.BoxGeometry(len, top - bottom, wid), bodyMat, midX, 0, (top + bottom) / 2);
  add(new THREE.BoxGeometry(len * 0.48, 0.42, wid * 0.86), glassMat, midX - len * 0.08, 0, top + 0.21);
  add(new THREE.BoxGeometry(0.06, 0.12, wid * 0.7), new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#fff2c0', emissiveIntensity: 0.6 }), midX + len / 2, 0, top - 0.12);
  add(new THREE.BoxGeometry(0.06, 0.1, wid * 0.8), new THREE.MeshStandardMaterial({ color: '#600', emissive: '#c00', emissiveIntensity: 0.5 }), midX - len / 2, 0, top - 0.1);
  for (const w of wh) {
    const steer = new THREE.Group();
    steer.position.copy(v3(w.x, w.y, w.z));
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(w.r, w.r, 0.24, 32), tireMat);
    tire.rotation.x = Math.PI / 2; tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(w.r * 0.62, w.r * 0.62, 0.25, 6), rimMat);
    rim.rotation.x = Math.PI / 2;
    spin.add(tire, rim); steer.add(spin); placeholder.add(steer);
    wheelRigs.push({ steer, spin, base: steer.position.clone() });
  }
  return { xf, xr, half, r, midX };
}

// ---------- Blender model loading (.glb) ----------
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let modelSource = null; // { buffer, name }
const WHEEL_RE = /(wheel|tire|tyre|rim|roda|pneu)/i;
const CALIPER_RE = /^caliper/i;

function isWheelNode(o) {
  for (let n = o; n && n !== modelSource?.sceneRoot; n = n.parent) if (WHEEL_RE.test(n.name || '')) return true;
  return false;
}

async function loadModel(buffer, name, announce = true) {
  modelSource = { buffer, name };
  const gltf = await loader.parseAsync(buffer, './');
  const inner = gltf.scene;
  modelSource.sceneRoot = inner;
  if (model) carRoot.remove(model.wrapper);
  // Fit in the car's own frame: park the root at the origin (the next frame restores the pose).
  carRoot.position.set(0, 0, 0); carRoot.quaternion.identity(); carRoot.updateMatrixWorld(true);
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  carRoot.add(wrapper);
  // Orientation: the car must face +X (three.js). Blender's default glTF export maps
  // Blender -Y (the usual "front") to +Z, so a model longer along Z is turned 90°.
  let turn = store.get('turn:' + name, null);
  if (turn === null) {
    const b = new THREE.Box3().setFromObject(inner), sz = b.getSize(new THREE.Vector3());
    turn = sz.z > sz.x ? 1 : 0;
  }
  inner.rotation.y = turn * Math.PI / 2;
  inner.updateMatrixWorld(true);
  // Scale: keep real metres if the model is car-sized, else fit to the physics car's length.
  const geo = geometryFromState();
  const xf = Math.max(...geo.map((w) => w.x)), xr = Math.min(...geo.map((w) => w.x));
  wrapper.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(inner);
  let size = box.getSize(new THREE.Vector3());
  const len = Math.max(size.x, size.z);
  if (len < 2.5 || len > 7) inner.scale.multiplyScalar((xf - xr + 1.8) / len);
  inner.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // Centre between the physics axles, tyres on the ground at rest.
  const target = v3((xf + xr) / 2, 0, groundZBody);
  inner.position.add(new THREE.Vector3(target.x - c.x, target.y - box.min.y, target.z - c.z));
  inner.updateMatrixWorld(true);
  carRoot.updateMatrixWorld(true);

  // Wheels: nodes named wheel/tire/tyre/rim (any language variant above), grouped per corner.
  const quads = [[], [], [], []]; // FL FR RL RR (physics order)
  const calipers = [[], [], [], []]; // steer and bounce with the wheel, but don't spin
  const mid = new THREE.Box3().setFromObject(inner).getCenter(new THREE.Vector3());
  inner.traverse((o) => {
    const isCal = o.isMesh && CALIPER_RE.test(o.name || '') && !isWheelNode(o);
    if (!o.isMesh || (!isWheelNode(o) && !isCal)) return;
    const bc = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    carRoot.worldToLocal(bc);
    const front = bc.x > mid.x, left = bc.z < mid.z; // three -Z is ISO +Y (left)
    (isCal ? calipers : quads)[(front ? 0 : 2) + (left ? 0 : 1)].push(o);
  });
  const rigs = [null, null, null, null];
  const hasWheels = quads.every((q) => q.length > 0);
  if (hasWheels) {
    quads.forEach((meshes, w) => {
      const box = new THREE.Box3();
      for (const m of meshes) box.union(new THREE.Box3().setFromObject(m));
      const centre = carRoot.worldToLocal(box.getCenter(new THREE.Vector3()));
      const steer = new THREE.Group(), spin = new THREE.Group();
      steer.position.copy(centre); steer.add(spin); wrapper.add(steer);
      steer.updateMatrixWorld(true);
      for (const m of meshes) spin.attach(m);
      for (const m of calipers[w]) steer.attach(m);
      rigs[w] = { steer, spin, base: centre.clone() };
    });
  }
  inner.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  model = { wrapper, rigs, hasWheels, turn };
  placeholder.visible = false;
  $('modelNote').innerHTML = `Driving <b>${escapeHtml(name)}</b> (${size.x.toFixed(2)} × ${size.z.toFixed(2)} m). ` +
    (hasWheels ? 'Wheels found and animated from the physics.' : 'No separate wheel objects found (name them “Wheel_FL”, “Tire_RR”…, to animate them).');
  if (announce) toast(`Loaded ${name}`);
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function loadModelFile(file) {
  if (!/\.glb$/i.test(file.name)) { toast('Please use a binary glTF (.glb). In Blender: File › Export › glTF 2.0, format “glTF Binary”.'); return; }
  try { await loadModel(await file.arrayBuffer(), file.name); }
  catch (e) { toast('Could not read that model: ' + e.message); }
}
$('bModel').onclick = () => $('file').click();
$('file').onchange = (e) => { const f = e.target.files[0]; if (f) loadModelFile(f); e.target.value = ''; };
$('bTurn').onclick = async () => {
  if (!modelSource) { toast('Load a model first'); return; }
  const turn = ((model?.turn ?? 0) + 1) % 4;
  store.set('turn:' + modelSource.name, turn);
  await loadModel(modelSource.buffer, modelSource.name, false);
};
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) $('drop').classList.add('on'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.remove('on'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('drop').classList.remove('on');
  const f = e.dataTransfer?.files?.[0]; if (f) loadModelFile(f);
});

// ---------- Create car ----------
const ZONES = [
  { name: 'Start', x: 0, y: 0, yaw: 0 },
  { name: 'Skidpad', x: SKID.x, y: SKID.y - SKID.r, yaw: 0 },
  { name: 'Slalom', x: 10, y: SLALOM.y, yaw: 0 },
  { name: 'Bumps', x: 15, y: LANE_Y, yaw: 0 },
  { name: 'Wet', x: 200, y: 50, yaw: 0 },
];
function createCar() {
  applyAids();
  if (!M._ord_create(settings.car, 0, 0, 0)) { toast('Vehicle definition rejected by the physics core'); return; }
  // Settle on the brakes so the rest pose is the loaded suspension.
  for (let i = 0; i < 90; ++i) { M._ord_set_input(0, 0, 1, 0, 0, 0); M._ord_advance(1 / 60); }
  restWheelZ = [0, 1, 2, 3].map((w) => W(w, 2));
  groundZBody = Math.min(...[0, 1, 2, 3].map((w) => W(w, 2) - W(w, 3)));
  buildPlaceholder();
  if (modelSource) loadModel(modelSource.buffer, modelSource.name, false);
  M._ord_reset(0, 0, 0);
  resetTimers();
}
function placeAt(z) {
  M._ord_reset(z.x, z.y, z.yaw);
  for (const c of cones) { c.hit = false; c.mesh.position.copy(c.home); c.mesh.rotation.set(0, 0, 0); c.vel.set(0, 0, 0); }
  resetTimers();
  camInit = true;
}
for (const z of ZONES) {
  const b = document.createElement('button'); b.textContent = z.name; b.onclick = () => { placeAt(z); b.blur(); };
  $('zones').append(b);
}

// ---------- Aids & presets ----------
function applyAids() {
  M._ord_set_preset(settings.preset);
  M._ord_set_aids(settings.abs ? 1 : 0, settings.tcs, settings.esc, settings.auto ? 1 : 0);
  const lv = ['off', 'sport', 'full'];
  $('aAbs').setAttribute('aria-pressed', settings.abs);
  $('aTcs').textContent = 'TCS: ' + lv[settings.tcs]; $('aTcs').setAttribute('aria-pressed', settings.tcs > 0);
  $('aEsc').textContent = 'ESC: ' + lv[settings.esc]; $('aEsc').setAttribute('aria-pressed', settings.esc > 0);
  $('aBox').textContent = settings.auto ? 'Auto gearbox' : 'Manual gearbox'; $('aBox').setAttribute('aria-pressed', settings.auto);
  document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.preset === settings.preset));
  $('hPreset').textContent = ['Fun', 'Sport', 'Simulation'][settings.preset] + (customised() ? ' · custom' : '');
  $('iAbs').classList.toggle('on', settings.abs); $('iTcs').classList.toggle('on', settings.tcs > 0);
  $('iEsc').classList.toggle('on', settings.esc > 0); $('iCs').classList.toggle('on', settings.preset < 2);
}
function customised() { const d = presetAids(settings.preset); return d.abs !== settings.abs || d.tcs !== settings.tcs || d.esc !== settings.esc || d.auto !== settings.auto; }
function setPreset(p) { settings.preset = p; Object.assign(settings, presetAids(p)); store.set('preset', p); applyAids(); toast(['FUN: every aid on', 'SPORT: ABS + light TCS', 'SIMULATION: no aids, manual gearbox (E/Q)'][p]); }
document.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => setPreset(+b.dataset.preset)));
$('aAbs').onclick = () => { settings.abs = !settings.abs; applyAids(); };
$('aTcs').onclick = () => { settings.tcs = (settings.tcs + 1) % 3; applyAids(); };
$('aEsc').onclick = () => { settings.esc = (settings.esc + 1) % 3; applyAids(); };
$('aBox').onclick = () => { settings.auto = !settings.auto; applyAids(); };
$('car').value = settings.car;
$('car').onchange = (e) => { settings.car = +e.target.value; store.set('car', settings.car); createCar(); e.target.blur(); };
$('bReset').onclick = (e) => { placeAt(ZONES[0]); e.currentTarget.blur(); };
$('bCam').onclick = (e) => { cycleCam(); e.currentTarget.blur(); };
function togglePanel() {
  const side = $('side'); side.hidden = !side.hidden; $('bPanel').setAttribute('aria-expanded', !side.hidden); store.set('panel', !side.hidden);
}
$('bPanel').onclick = (e) => { togglePanel(); e.currentTarget.blur(); };
if (store.get('panel', innerWidth > 900) === false) togglePanel();

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600); }

// ---------- Input ----------
const keys = new Set();
const edge = { up: false, down: false };
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  if (k === 'e') edge.up = true;
  if (k === 'q') edge.down = true;
  if (k === 'r') placeAt(ZONES[0]);
  if (k === 'c') cycleCam();
  if (k === 'h') togglePanel();
  if (k === '1' || k === '2' || k === '3') setPreset(+k - 1);
  if (k === 'b') $('aAbs').click();
  if (k === 't') $('aTcs').click();
  if (k === 'y') $('aEsc').click();
  if (k === 'g') $('aBox').click();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
const touch = { steer: 0, gas: 0, brake: 0 };
function bindHold(id, prop) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); touch[prop] = 1; el.classList.add('on'); });
  const up = () => { touch[prop] = 0; el.classList.remove('on'); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
bindHold('tGas', 'gas'); bindHold('tBrake', 'brake');
{
  const el = $('tSteer'), knob = el.querySelector('i');
  const set = (e) => {
    const r = el.getBoundingClientRect();
    const u = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    touch.steer = -u; knob.style.left = `calc(${(u + 1) * 50}% - 17px)`;
  };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(e); });
  const up = () => { touch.steer = 0; knob.style.left = 'calc(50% - 17px)'; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
const pad = { prev: [] };
let kbSteer = 0, reverseHold = 0;
function readInput(dt, gear, speed) {
  // Keyboard steering is digital; ramp it like a driver turning a wheel (the presets add their own shaping).
  const target = (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0);
  const rate = target === 0 || Math.sign(target) !== Math.sign(kbSteer) ? 6 : 3;
  kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - kbSteer));
  let steer = kbSteer;
  let up = keys.has('w') || keys.has('arrowup') ? 1 : 0;
  let down = keys.has('s') || keys.has('arrowdown') ? 1 : 0;
  let hand = keys.has(' ') ? 1 : 0;
  let shiftUp = edge.up, shiftDown = edge.down;
  edge.up = edge.down = false;
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
  if (gp) {
    const btn = (i) => gp.buttons[i] ? gp.buttons[i].value : 0;
    const pressed = (i) => !!gp.buttons[i]?.pressed;
    const was = (i) => !!pad.prev[i];
    const ax = gp.axes[0] ?? 0;
    const sx = Math.abs(ax) < 0.08 ? 0 : (ax - Math.sign(ax) * 0.08) / 0.92;
    if (Math.abs(sx) > Math.abs(steer)) steer = -sx;
    up = Math.max(up, btn(7)); down = Math.max(down, btn(6)); hand = Math.max(hand, btn(0));
    if (pressed(5) && !was(5)) shiftUp = true;
    if (pressed(4) && !was(4)) shiftDown = true;
    if (pressed(3) && !was(3)) placeAt(ZONES[0]);
    if (pressed(8) && !was(8)) cycleCam();
    if (pressed(9) && !was(9)) setPreset((settings.preset + 1) % 3);
    pad.prev = gp.buttons.map((b) => b.pressed);
  }
  if (Math.abs(touch.steer) > Math.abs(steer)) steer = touch.steer;
  up = Math.max(up, touch.gas); down = Math.max(down, touch.brake);
  // Automatic gearbox: hold brake at a standstill to engage reverse, then "brake" drives backwards.
  let throttle = up, brake = down;
  if (settings.auto) {
    if (gear >= 1 && Math.abs(speed) < 0.4 && down > 0.5 && up === 0) { reverseHold += dt; if (reverseHold > 0.35) { shiftDown = true; reverseHold = 0; } }
    else reverseHold = 0;
    if (gear === -1) {
      throttle = down; brake = up;
      if (Math.abs(speed) < 0.4 && up > 0.5) shiftUp = true;
    }
  }
  return { steer: Math.max(-1, Math.min(1, steer)), throttle, brake, hand, shiftUp, shiftDown };
}

// ---------- Camera ----------
const CAMS = ['Chase', 'Far chase', 'Bonnet', 'Overhead'];
let camInit = true;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function cycleCam() { settings.cam = (settings.cam + 1) % CAMS.length; store.set('cam', settings.cam); camInit = true; toast('Camera: ' + CAMS[settings.cam]); }
function updateCamera(dt, carPos, carQuat, vel) {
  const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuat); fwd.y = 0; fwd.normalize();
  const vh = new THREE.Vector3(vel.x, 0, vel.z);
  const dir = vh.length() > 4 && S(7) > 2 ? vh.normalize().lerp(fwd, 0.5).normalize() : fwd;
  let want, look;
  if (settings.cam === 0) { want = carPos.clone().addScaledVector(dir, -6.2).add(new THREE.Vector3(0, 2.1, 0)); look = carPos.clone().addScaledVector(dir, 4).add(new THREE.Vector3(0, 0.7, 0)); }
  else if (settings.cam === 1) { want = carPos.clone().addScaledVector(dir, -12).add(new THREE.Vector3(0, 4.5, 0)); look = carPos.clone().addScaledVector(dir, 6); }
  else if (settings.cam === 2) {
    want = new THREE.Vector3(0.3, groundZBody + 1.25, 0).applyQuaternion(carQuat).add(carPos);
    look = new THREE.Vector3(30, groundZBody + 0.9, 0).applyQuaternion(carQuat).add(carPos);
    camPos.copy(want); camLook.copy(look); camera.position.copy(camPos); camera.lookAt(camLook); return;
  }
  else { want = carPos.clone().add(new THREE.Vector3(-0.01, 45, 0)); look = carPos.clone(); }
  const k = camInit ? 1 : 1 - Math.exp(-dt * (settings.cam === 3 ? 6 : 5));
  camPos.lerp(want, k); camLook.lerp(look, camInit ? 1 : 1 - Math.exp(-dt * 10));
  camInit = false;
  camera.position.copy(camPos); camera.lookAt(camLook);
}

// ---------- HUD ----------
const wheelEls = [];
{
  const names = ['FL', 'FR', 'RL', 'RR'];
  for (let w = 0; w < 4; ++w) {
    const d = document.createElement('div'); d.className = 'wheel';
    d.innerHTML = `<span>${names[w]}</span> <span class="v"></span><div class="bar"><i></i></div>`;
    $('hWheels').append(d); wheelEls.push({ v: d.querySelector('.v'), bar: d.querySelector('i'), el: d });
  }
}
const gg = $('gg');
gg.innerHTML = `<circle r="40" fill="none" stroke="rgba(255,255,255,.25)"/><circle r="20" fill="none" stroke="rgba(255,255,255,.12)"/>
<line x1="-46" x2="46" stroke="rgba(255,255,255,.12)"/><line y1="-46" y2="46" stroke="rgba(255,255,255,.12)"/>
<text x="0" y="-42" fill="rgba(255,255,255,.45)" font-size="8" text-anchor="middle">1 g</text>
<polyline id="ggTrail" fill="none" stroke="rgba(255,211,107,.45)" stroke-width="1.5"/><circle id="ggDot" r="4" fill="#ffd36b"/>`;
const trail = [];
const timers = { t0: null, best0100: null, last0100: null, brakeStart: null, last1000: null, maxLat: 0, slalomStart: null, slalomLast: null, conesHit: 0 };
function resetTimers() { Object.assign(timers, { t0: null, last0100: null, brakeStart: null, last1000: null, maxLat: 0, slalomStart: null, slalomLast: null, conesHit: 0 }); trail.length = 0; }
let latF = 0, lonF = 0;

function updateHud(dt, inp) {
  const kmh = S(7) * 3.6;
  $('hSpeed').firstChild.nodeValue = Math.abs(Math.round(kmh)).toString();
  const gear = S(15);
  $('hGear').textContent = gear === -1 ? 'R' : gear === 0 ? 'N' : String(gear);
  $('hRpm').style.width = Math.min(100, (S(14) / LIMITER[settings.car]) * 100).toFixed(1) + '%';
  let abs = false, esc = false;
  for (let w = 0; w < 4; ++w) {
    abs ||= W(w, 13) > 0; esc ||= W(w, 14) > 1;
    const load = W(w, 6), kappa = W(w, 7), alpha = W(w, 8);
    const slip = Math.max(Math.abs(kappa) / 0.12, Math.abs(alpha) / 0.12); // 1 ≈ near the tyre's peak
    const e = wheelEls[w];
    e.v.textContent = `${(load / 1000).toFixed(1)}kN`;
    e.bar.style.width = Math.min(100, slip * 70) + '%';
    e.bar.style.background = W(w, 12) > 0 ? 'var(--bad)' : slip > 1.15 ? 'var(--warn)' : 'var(--good)';
    e.el.style.opacity = W(w, 11) > 0 ? 1 : 0.4;
  }
  $('iAbs').classList.toggle('act', abs);
  $('iTcs').classList.toggle('act', S(18) > 0.02);
  $('iEsc').classList.toggle('act', esc);
  $('iCs').classList.toggle('act', Math.abs(S(19)) > 0.004);
  // g-g
  const k = 1 - Math.exp(-dt * 12);
  latF += (S(12) / G - latF) * k; lonF += (S(11) / G - lonF) * k;
  const px = -latF * 40, py = -lonF * 40;
  $('ggDot').setAttribute('cx', px.toFixed(1)); $('ggDot').setAttribute('cy', py.toFixed(1));
  trail.push(`${px.toFixed(1)},${py.toFixed(1)}`); if (trail.length > 90) trail.shift();
  $('ggTrail').setAttribute('points', trail.join(' '));
  // timers
  const v = S(7), t = S(21);
  if (Math.abs(v) < 0.3 && inp.throttle > 0.05 && timers.t0 === null && gear >= 1) timers.t0 = t;
  if (timers.t0 !== null && (inp.brake > 0.1 || v < -0.5)) timers.t0 = null;
  if (timers.t0 !== null && v >= 100 / 3.6) { timers.last0100 = t - timers.t0; timers.best0100 = Math.min(timers.best0100 ?? Infinity, timers.last0100); timers.t0 = null; }
  const x = S(0), y = S(1);
  if (timers.brakeStart === null && v > 99 / 3.6 && v < 101 / 3.6 && inp.brake > 0.5) timers.brakeStart = { x, y };
  if (timers.brakeStart && inp.brake < 0.2 && v > 1) timers.brakeStart = null;
  if (timers.brakeStart && Math.abs(v) < 0.2) { timers.last1000 = Math.hypot(x - timers.brakeStart.x, y - timers.brakeStart.y); timers.brakeStart = null; }
  if (Math.abs(v) > 5) timers.maxLat = Math.max(timers.maxLat, Math.abs(latF));
  // slalom gate timing
  const inLane = Math.abs(y - SLALOM.y) < 6;
  if (inLane && timers.slalomStart === null && x > SLALOM.x0 - 2 && x < SLALOM.x0) { timers.slalomStart = t; timers.conesHit = 0; }
  const xEnd = SLALOM.x0 + (SLALOM.n - 1) * SLALOM.gap;
  if (timers.slalomStart !== null && x > xEnd + 2) { timers.slalomLast = { time: t - timers.slalomStart, cones: timers.conesHit }; timers.slalomStart = null; }
  if (timers.slalomStart !== null && !inLane) timers.slalomStart = null;
  const dSkid = Math.hypot(x - SKID.x, y - SKID.y);
  const onSkid = Math.abs(dSkid - SKID.r) < 6 && Math.abs(v) > 3;
  const fmt = (n, d = 2) => (n == null ? '—' : n.toFixed(d));
  $('hTimers').innerHTML =
    `<span>0–100 km/h</span> <b>${fmt(timers.last0100)} s</b>${timers.best0100 ? ` <span>best ${fmt(timers.best0100)}</span>` : ''}<br>` +
    `<span>100–0 km/h</span> <b>${fmt(timers.last1000, 1)} m</b><br>` +
    `<span>Lateral</span> <b>${fmt(Math.abs(latF))} g</b> <span>max ${fmt(timers.maxLat)}</span><br>` +
    (onSkid ? `<span>Skidpad radius</span> <b>${fmt(Math.abs(v / (S(9) || 1e-6)), 1)} m</b><br>` : '') +
    `<span>Slalom</span> <b>${timers.slalomLast ? fmt(timers.slalomLast.time) + ' s' : '—'}</b>${timers.slalomLast ? ` <span>${timers.slalomLast.cones} cones</span>` : ''}<br>` +
    `<span>Sideslip</span> <b>${fmt((S(10) * 180) / Math.PI, 1)}°</b>`;
}

// zone banner
let currentZone = '';
function zoneAt(x, y) {
  if (x > 250 && x < 450 && y > 25 && y < 75) return 'Wet section';
  if (Math.abs(Math.hypot(x - SKID.x, y - SKID.y) - SKID.r) < 8) return 'Skidpad · R40';
  if (Math.abs(y - SLALOM.y) < 6 && x > 25 && x < 220) return 'Slalom';
  if (Math.abs(y - LANE_Y) < 5 && x > 30 && x < 310) return 'Bumps & kerb';
  if (Math.abs(y) < 7 && x > 5) return 'Straight';
  return '';
}

// ---------- Telemetry recording ----------
let rec = null;
$('bRec').onclick = (e) => {
  if (rec) { rec.on = false; $('bRec').setAttribute('aria-pressed', 'false'); $('bRec').textContent = 'Record CSV'; $('bCsv').disabled = rec.rows.length === 0; $('recNote').textContent = `${rec.rows.length} frames recorded.`; }
  else { rec = { on: true, rows: [] }; $('bRec').setAttribute('aria-pressed', 'true'); $('bRec').textContent = 'Stop'; $('bCsv').disabled = true; }
  e.currentTarget.blur();
};
$('bCsv').onclick = () => {
  const head = 'time,x,y,z,speed_ms,lat_vel_ms,yaw_rate,sideslip,ax,ay,az,rpm,gear,steer_in,throttle_in,brake_in,steer_angle,throttle_out,tcs_cut,' +
    [0, 1, 2, 3].map((w) => ['FL', 'FR', 'RL', 'RR'][w]).map((n) => `${n}_load,${n}_kappa,${n}_alpha,${n}_fx,${n}_fy,${n}_abs,${n}_esc`).join(',');
  const blob = new Blob([head + '\n' + rec.rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `ord-drive-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
function recordRow() {
  if (!rec?.on) return;
  const r = [21, 0, 1, 2, 7, 8, 9, 10, 11, 12, 13, 14, 15, 27, 28, 29, 16, 17, 18].map((i) => +S(i).toFixed(5));
  for (let w = 0; w < 4; ++w) r.push(...[6, 7, 8, 9, 10, 13, 14].map((i) => +W(w, i).toFixed(4)));
  rec.rows.push(r.join(','));
  if (rec.rows.length > 60 * 600) $('bRec').click(); // stop after 10 minutes
}

// ---------- Cones ----------
function updateCones(dt, carPosIso, carVelIso) {
  for (const c of cones) {
    if (!c.hit) {
      const dx = c.home.x - carPosIso.x, dy = -c.home.z - carPosIso.y;
      if (Math.hypot(dx, dy) < 1.3) {
        c.hit = true; timers.conesHit++;
        c.vel.copy(v3(carVelIso.x * 0.7 + dx, carVelIso.y * 0.7 + dy, 2)); c.spin = 8;
      }
    } else if (c.mesh.position.y > 0.17 || c.vel.lengthSq() > 0.01) {
      c.vel.y -= G * dt; c.mesh.position.addScaledVector(c.vel, dt);
      if (c.mesh.position.y < 0.17) { c.mesh.position.y = 0.17; c.vel.multiplyScalar(0.5); c.vel.y = Math.abs(c.vel.y) * 0.3; }
      c.mesh.rotation.z += c.spin * dt; c.spin *= 0.97;
      if (c.mesh.rotation.z > Math.PI / 2) c.mesh.rotation.z = Math.PI / 2;
    }
  }
}

// ---------- Main loop ----------
createCar();
const savedModel = await fetch('models/car.glb', { method: 'HEAD' }).then((r) => (r.ok ? true : false)).catch(() => false);
if (savedModel) {
  try { await loadModel(await (await fetch('models/car.glb')).arrayBuffer(), 'Rosser Stella V8', false); }
  catch (e) { console.warn('models/car.glb failed to load', e); }
}
$('loading').remove();
let last = performance.now();
const qIso = new THREE.Quaternion();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const inp = readInput(dt, S(15), S(7));
  M._ord_set_input(inp.steer, inp.throttle, inp.brake, inp.hand, inp.shiftUp ? 1 : 0, inp.shiftDown ? 1 : 0);
  M._ord_advance(dt);
  if (S(23)) { toast('The simulation faulted (non-finite state). Resetting.'); placeAt(ZONES[0]); }
  // car pose: ISO quaternion (w,x,y,z) -> three (w, x, z, -y)
  qIso.set(S(4), S(6), -S(5), S(3));
  carRoot.quaternion.copy(qIso);
  carRoot.position.copy(v3(S(0), S(1), S(2)));
  const rigs = model?.hasWheels ? model.rigs : model ? null : wheelRigs;
  for (let w = 0; w < 4; ++w) {
    spinAngle[w] = (spinAngle[w] + W(w, 5) * dt) % (Math.PI * 2);
    const r = rigs?.[w];
    if (!r) continue;
    r.steer.position.copy(r.base); r.steer.position.y += W(w, 2) - restWheelZ[w];
    r.steer.rotation.y = W(w, 4);
    r.spin.rotation.z = -spinAngle[w];
  }
  const worldVel = new THREE.Vector3(S(7), 0, -S(8)).applyQuaternion(carRoot.quaternion);
  updateCamera(dt, carRoot.position, carRoot.quaternion, worldVel);
  sun.position.copy(carRoot.position).addScaledVector(SUN_DIR, 80); sun.target.position.copy(carRoot.position);
  updateCones(dt, { x: S(0), y: S(1) }, { x: worldVel.x, y: -worldVel.z });
  updateHud(dt, inp);
  recordRow();
  const z = zoneAt(S(0), S(1));
  if (z !== currentZone) { currentZone = z; $('zone').textContent = z; $('zone').classList.toggle('on', !!z); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
