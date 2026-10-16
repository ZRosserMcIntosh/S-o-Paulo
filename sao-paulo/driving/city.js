// São Paulo World · tile T_p0_p0: the 500 x 500 m block around MASP on Avenida Paulista.
// Built from the same Blender tile as the rest of the world (tools/web_tile in SaoPauloWorld):
//   city/world.glb       terrain, roads, sidewalks, parks, buildings (one mesh per material)
//   city/props.glb       library assets (trees, poles, signals, bins...) drawn instanced
//   city/city.json       instance matrices, street-name plates, street centrelines, spawn
//   city/phys.bin(.gz)   the drivable heightfield (0.5 m, cm), surface classes and colliders
// The physics gets the heightfield and colliders; the renderer gets the meshes. Both come from
// the same tile export, so what you see is what you drive on.
import * as THREE from 'three';

const BASE = new URL('./city/', import.meta.url);

// Material colours for the tile's procedural Blender materials (sRGB hex), roughness, metalness.
const MATS = {
  M_PH_Road: ['#ffffff', 0.92, 0, 'asphalt'],
  M_PH_Bridge: ['#8c8a84', 0.85, 0],
  M_RM_WhitePaint: ['#ecebe6', 0.7, 0, 'decal'],
  M_RM_YellowPaint: ['#e9bf2a', 0.7, 0, 'decal'],
  M_RM_CicloviaRed: ['#a8322a', 0.75, 0, 'decal'],
  M_SP_TactileYellow: ['#d9b229', 0.8, 0, 'decal'],
  M_SP_CurbGranite: ['#9a978f', 0.75, 0, 'grain'],
  M_SP_GutterConcrete: ['#a29e95', 0.85, 0, 'grain'],
  M_SP_SidewalkConcrete: ['#b8b3aa', 0.88, 0, 'grain'],
  M_SP_SidewalkPaulista: ['#a3a19c', 0.85, 0, 'grain'],
  M_SP_PlazaConcrete: ['#bdb8af', 0.85, 0, 'grain'],
  M_SP_GroundSoil: ['#6e5d45', 1, 0, 'grain'],
  M_PARK_ForestFloor: ['#4c4a31', 1, 0, 'grain'],
  M_PARK_Path: ['#a8977a', 0.95, 0, 'grain'],
  M_PAV_RedCeramicTile: ['#9a4c38', 0.8, 0, 'grain'],
  M_PAV_PortugueseStone: ['#b9b6af', 0.8, 0, 'grain'],
  M_PAV_InterlockPaver: ['#8f8277', 0.85, 0, 'grain'],
  M_PAV_GraniteSlab: ['#8f8c86', 0.7, 0, 'grain'],
  M_PAV_ConcretePlain: ['#aca89f', 0.88, 0, 'grain'],
  M_PAV_ConcreteGrassGrid: ['#7c8a59', 0.95, 0, 'grain'],
  M_RES_DrivewayConcrete: ['#aaa59c', 0.88, 0, 'grain'],
  M_RES_LawnGarden: ['#5a7d39', 1, 0, 'grain'],
  M_RES_YardPaved: ['#a39e94', 0.9, 0, 'grain'],
  M_RES_VacantDirt: ['#8b6d4c', 1, 0, 'grain'],
  M_RES_TreePitSoil: ['#4d3b2a', 1, 0, 'grain'],
  M_RES_GateSteel: ['#3b3d40', 0.55, 0.6],
  M_RES_Cable: ['#151515', 0.7, 0],
  M_RES_WallStucco_0: ['#d9cfbd', 0.9, 0], M_RES_WallStucco_1: ['#c8b89a', 0.9, 0],
  M_RES_WallStucco_2: ['#e3dccd', 0.9, 0], M_RES_WallStucco_3: ['#b9a58a', 0.9, 0],
  M_RES_WallStucco_4: ['#d6c3a3', 0.9, 0], M_RES_WallStucco_5: ['#cfd3cc', 0.9, 0],
  M_RES_WallStucco_6: ['#e0c9b0', 0.9, 0], M_RES_WallStucco_7: ['#bfb7a8', 0.9, 0],
  RetainingWallConcrete: ['#8a877f', 0.9, 0],
  M_SIGN_PostGalv: ['#a3a7aa', 0.4, 0.8],
  M_SIGN_PlateBlueSP: ['#1d4f9c', 0.5, 0],
  M_CTX_DistantCity: ['#a3abb5', 0.9, 0],
  'LMK:MASP_Red_Interfine878': ['#c3141d', 0.45, 0],
  'LMK:MASP_ExposedConcrete': ['#8f8c86', 0.85, 0, 'grain'],
  'LMK:MASP_BelvedereStone': ['#b9b2a4', 0.75, 0, 'grain'],
  'LMK:MASP_Glass': ['#26343b', 0.05, 0.6],
  'LMK:MASP_Mullion': ['#26282a', 0.5, 0.6],
  'LMK:MASP_Railing': ['#3c3e40', 0.5, 0.6],
  // instanced library assets
  M_VEG_BarkV2: ['#5a4636', 0.95, 0],
  M_VEG_LeavesV2: ['#46702e', 0.85, 0, 'leaves'],
  M_RES_BinOrange: ['#e0661c', 0.6, 0],
  M_RES_PoleConcrete: ['#9a968e', 0.9, 0],
  M_RES_LED: ['#ffffff', 0.3, 0, 'glow'],
  M_SK_OrelhaoBlue: ['#2a5fae', 0.4, 0],
  M_SK_OrelhaoYellow: ['#e7c021', 0.4, 0],
  M_SK_DarkSteel: ['#2b2d30', 0.5, 0.6],
  M_SK_SignalBlack: ['#18191a', 0.5, 0.3],
  M_SK_Wood: ['#7a5534', 0.8, 0],
  M_SK_PaintedSteelGrey: ['#70747a', 0.5, 0.5],
};

function grainTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 232 + (Math.random() - 0.5) * 30;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Facade shader: the web version of the tile's M_FAC_Parametric. Per-vertex facade parameters
// (bay and floor size, window size, wall and glass colour, a random seed) come from the export;
// windows are cut procedurally in object space so they line up with each building's walls.
function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 _facuv; attribute vec4 _facp; attribute vec4 _facw; attribute vec4 _facg;
        varying vec2 vFacUV; varying vec4 vFacP; varying vec4 vFacW; varying vec4 vFacG; varying float vUp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFacUV = _facuv; vFacP = _facp; vFacW = _facw; vFacG = _facg; vUp = normal.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vFacUV; varying vec4 vFacP; varying vec4 vFacW; varying vec4 vFacG; varying float vUp;
        float fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float facWin; float facGlassRough;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wall = vFacW.rgb, glass = vFacG.rgb;
          float bay = max(vFacP.x, 0.5), flr = max(vFacP.y, 1.0);
          vec2 cell = vec2(vFacUV.x / bay, vFacUV.y / flr);
          vec2 f = fract(cell), id = floor(cell) + vFacW.a * 37.0;
          float roof = step(0.7, abs(vUp));
          float win = step(abs(f.x - 0.5), vFacP.z * 0.5) * step(abs(f.y - 0.5), vFacP.w * 0.5);
          // ground floor: tall shopfront glazing with a dark frame
          float shop = step(vFacUV.y, 0.0) * step(-4.3, vFacUV.y);
          win = mix(win, step(abs(f.x - 0.5), 0.42) * step(0.08, vFacUV.y + 4.3) * step(vFacUV.y, -0.5), shop);
          win *= 1.0 - roof;
          float lum = 0.55 + 0.9 * fh(id) * fh(id + 3.1);
          vec3 g = glass * lum * 1.8 + vec3(0.02, 0.03, 0.04);
          vec3 w = wall * (roof > 0.5 ? 0.75 : 1.0) * (0.92 + 0.16 * fh(floor(vFacUV / 7.0) + vFacW.a));
          diffuseColor.rgb = mix(w, g, win);
          facWin = win;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.06, facWin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.85, facWin);`);
  };
  m.customProgramCacheKey = () => 'spw-facade-1';
  return m;
}

function plateTexture(lines) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 170;
  const g = c.getContext('2d');
  g.fillStyle = '#1d4f9c'; g.fillRect(0, 0, 512, 170);
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(9, 9, 494, 152);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = '800 60px "Public Sans", Arial, sans-serif';
  g.fillText(lines[0] || '', 256, 82, 470);
  g.font = '600 30px "Public Sans", Arial, sans-serif';
  g.fillText(lines[1] || '', 256, 135, 470);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

async function fetchPhys() {
  if ('DecompressionStream' in window) {
    try {
      const r = await fetch(new URL('phys.bin.gz', BASE));
      if (r.ok) return new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    } catch (e) { console.warn('phys.bin.gz', e); }
  }
  return new Uint8Array(await (await fetch(new URL('phys.bin', BASE))).arrayBuffer());
}

// Hand the heightfield, surface classes and colliders to the physics core.
export function uploadPhysics(M, buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nx = dv.getUint32(4, true), ny = dv.getUint32(8, true);
  const x0 = dv.getFloat32(12, true), y0 = dv.getFloat32(16, true), cell = dv.getFloat32(20, true);
  const nseg = dv.getUint32(24, true), ncirc = dv.getUint32(28, true);
  let p = 32;
  M._ord_set_world(1);
  const hp = M._ord_city_heights(nx, ny, x0, y0, cell);
  M.HEAP16.set(new Int16Array(buf.slice(p, p + nx * ny * 2).buffer), hp / 2); p += nx * ny * 2;
  M.HEAPU8.set(buf.subarray(p, p + nx * ny), M._ord_city_classes()); p += nx * ny; p += (4 - (p % 4)) % 4;
  const f = new Float32Array(buf.slice(p, p + (nseg * 6 + ncirc * 5) * 4).buffer);
  M.HEAPF64.set(Float64Array.from(f), M._ord_city_colliders(nseg, ncirc) / 8);
  M._ord_city_commit(-300, -300, 8, 75);
  return { nseg, ncirc };
}

export async function loadCity({ scene, M, loader, mobile, asphalt, status }) {
  status?.('Loading the block around MASP…');
  const [phys, info, world, props] = await Promise.all([
    fetchPhys(),
    fetch(new URL('city.json', BASE)).then((r) => r.json()),
    loader.loadAsync(new URL(mobile ? 'world_mobile.glb' : 'world.glb', BASE).href),
    loader.loadAsync(new URL(mobile ? 'props_mobile.glb' : 'props.glb', BASE).href),
  ]);
  status?.('Building the city…');
  uploadPhysics(M, phys);

  const grain = grainTexture();
  const mats = new Map();
  const matFor = (name) => {
    if (mats.has(name)) return mats.get(name);
    const [col, rough, metal, kind] = MATS[name] || ['#b0aca4', 0.9, 0];
    const p = { color: col, roughness: rough, metalness: metal };
    if (kind === 'asphalt') p.map = asphalt;
    if (kind === 'grain') p.map = grain;
    if (kind === 'decal') Object.assign(p, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    if (kind === 'glow') Object.assign(p, { emissive: '#fff6e0', emissiveIntensity: 1.5 });
    if (kind === 'leaves') p.side = THREE.DoubleSide;
    const m = new THREE.MeshStandardMaterial(p);
    m.envMapIntensity = metal > 0.3 ? 0.8 : 0.3;
    mats.set(name, m);
    return m;
  };
  const city = new THREE.Group(); city.name = 'city';
  const facade = facadeMaterial();
  facade.envMapIntensity = 0.9;
  world.scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material?.name || o.name;
    const geo = o.geometry;
    if (name === 'BUILDING') {
      o.material = facade; o.castShadow = true; o.receiveShadow = true;
    } else {
      o.material = matFor(name);
      // world-space UVs (5 m repeat) for the asphalt / grain textures
      const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2), v = new THREE.Vector3();
      for (let i = 0; i < pos.count; ++i) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); uv[i * 2] = v.x * 0.2; uv[i * 2 + 1] = -v.z * 0.2; }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      o.receiveShadow = true;
      o.castShadow = /Wall|Gate|LMK|Bridge|Post/.test(name);
    }
  });
  city.add(world.scene);

  // instanced props
  const parts = new Map(); // asset -> [{geometry, material}]
  props.scene.traverse((o) => {
    if (!o.isMesh) return;
    const [asset, mat] = (o.parent?.isMesh || !o.name.includes('|') ? (o.parent?.name || o.name) : o.name).split('|');
    if (!parts.has(asset)) parts.set(asset, []);
    parts.get(asset).push({ geometry: o.geometry, material: matFor(mat || o.material?.name) });
  });
  // Instances are bucketed into 100 m cells so the camera and the sun's shadow pass only draw
  // the props near them.
  const mtx = new THREE.Matrix4(), CELLM = 100;
  for (const [asset, all] of Object.entries(info.instances)) {
    const ps = parts.get(asset);
    if (!ps) continue;
    // phones: thinner forest and shrubbery
    const keep = mobile ? (/forest/.test(asset) ? 2 : /SHRUB/.test(asset) ? 3 : 1) : 1;
    const cells = new Map();
    all.forEach((m, i) => {
      if (i % keep) return;
      const k = Math.floor((m[12] + 250) / CELLM) + ',' + Math.floor((m[14] + 250) / CELLM);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(m);
    });
    const tree = /TREE|SHRUB/.test(asset);
    for (const list of cells.values()) {
      for (const { geometry, material } of ps) {
        const im = new THREE.InstancedMesh(geometry, material, list.length);
        list.forEach((m, i) => { mtx.fromArray(m); im.setMatrixAt(i, mtx); });
        im.castShadow = !mobile || (tree && !/SHRUB/.test(asset)); im.receiveShadow = !tree || !mobile;
        im.computeBoundingSphere();
        city.add(im);
      }
    }
  }

  // street-name plates (the text was too heavy as geometry, so it is drawn here)
  for (const pl of info.plates) {
    const t = plateTexture(pl.lines);
    const mat = new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: '#e6e6e6' });
    const geo = new THREE.PlaneGeometry(pl.w * 0.98, pl.h * 0.94);
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(geo, mat);
      const a = (pl.a * Math.PI) / 180;
      // plate normal in the ground plane is perpendicular to its long axis
      const nx = -Math.sin(a) * side, ny = Math.cos(a) * side, off = pl.t / 2 + 0.004;
      m.position.set(pl.c[0] + nx * off, pl.c[2], -(pl.c[1] + ny * off));
      m.rotation.y = Math.atan2(nx, -ny); // plane +z -> (nx, 0, -ny) in three axes
      city.add(m);
    }
  }

  // ground skirt beyond the tile so the edge doesn't float in the sky
  const skirt = new THREE.Mesh(new THREE.RingGeometry(354, 4000, 4, 1), new THREE.MeshStandardMaterial({ color: '#6d6a60', roughness: 1 }));
  skirt.rotation.x = -Math.PI / 2; skirt.rotation.z = Math.PI / 4; skirt.position.y = -8;
  city.add(skirt);

  scene.add(city);
  return { info, group: city };
}

// Nearest street name (for the banner), from the tile's street centrelines.
export function streetNamer(streets) {
  return (x, y) => {
    let best = 12, name = '';
    for (const [n, pts] of streets) {
      for (let i = 0; i + 1 < pts.length; ++i) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
        if (d < best) { best = d; name = n; }
      }
    }
    return name;
  };
}
