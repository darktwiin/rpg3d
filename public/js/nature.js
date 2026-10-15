// Arbres, rochers, buissons, particules et ambiance (feuilles au vent, pollen / lucioles).
// Arbres et rochers peuvent être coupés / cassés. Leur état est synchronisé par le serveur.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, noise3, seededRandom, WORLD_LIMIT, TREE_HP, ROCK_HP, riverDist, GEM_HOME, isWater, caveAt, CAVES, caveK, CLIFF } from './world.js';
import { staticGeometry, atlasTexture, textureOf, modelMaterial, KK } from './models.js';

// ---------- Matériaux qui bougent avec le vent ----------
function windMaterial(params, wind, leaf, sway = 0.006) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uWind = wind.uWind;
    shader.vertexShader = 'uniform float uTime;\nuniform vec3 uWind;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec3 wO = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float hh = max(position.y, 0.0);
      float kk = hh * hh * ${sway.toFixed(4)} * uWind.z;
      float sw = sin(uTime * 1.1 + wO.x * 0.21 + wO.z * 0.17) * 0.7 + sin(uTime * 2.3 + wO.z * 0.5) * 0.3;
      float gust = smoothstep(-0.2, 1.0, sin(uTime * 0.7 - dot(wO.xz, uWind.xy) * 0.09));
      transformed.xz += uWind.xy * kk * (0.5 + sw * 0.45 + gust * 0.9);
      ${leaf ? 'transformed += normal * sin(uTime * 6.0 + position.x * 3.1 + position.y * 2.3 + position.z * 2.7) * 0.04 * uWind.z;' : ''}`
    );
  };
  m.customProgramCacheKey = () => 'wind' + (leaf ? 'L' : 'T') + sway;
  return m;
}

// ---------- Textures dessinées par le code ----------
function makeBarkTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6e4d31'; ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 64;
    ctx.strokeStyle = Math.random() < 0.7 ? `rgba(40,25,14,${0.3 + Math.random() * 0.4})` : `rgba(160,120,85,${0.25 + Math.random() * 0.3})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 16) ctx.lineTo(x + Math.sin(y * 0.05 + i) * 3, y);
    ctx.stroke();
  }
  for (let i = 0; i < 5; i++) { // nœuds
    ctx.fillStyle = 'rgba(35,22,12,0.6)';
    ctx.beginPath(); ctx.ellipse(Math.random() * 64, Math.random() * 256, 3, 6, 0, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeRingsTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9b27a'; ctx.fillRect(0, 0, 128, 128);
  for (let r = 6; r < 64; r += 5 + Math.random() * 3) {
    ctx.strokeStyle = `rgba(140,95,50,${0.4 + Math.random() * 0.3})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(64 + Math.random() * 2, 64 + Math.random() * 2, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = '#5a3c22'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Outils de géométrie ----------
function displace(geo, freq, amp, seed, center = new THREE.Vector3()) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(center);
    const n = noise3(v.x * freq + seed, v.y * freq, v.z * freq) * amp
      + noise3(v.x * freq * 3 + seed, v.y * freq * 3, v.z * freq * 3) * amp * 0.3;
    v.multiplyScalar(1 + n).add(center);
    p.setXYZ(i, v.x, v.y, v.z);
  }
}
function colorFaces(geo, palette, rand, under = 0.55, mossCol = null) {
  geo.computeVertexNormals();
  const n = geo.attributes.position.count, nor = geo.attributes.normal, pos = geo.attributes.position;
  const col = new Float32Array(n * 3), c = new THREE.Color();
  for (let f = 0; f < n; f += 3) {
    c.copy(palette[Math.floor(rand() * palette.length)]);
    let s = 0.85 + rand() * 0.3;
    const ny = nor.getY(f);
    if (ny < -0.2) s *= under; else if (ny > 0.5) s *= 1.12;
    c.multiplyScalar(s);
    if (mossCol && ny > 0.5 && noise3(pos.getX(f) * 2, pos.getY(f) * 2, pos.getZ(f) * 2) > -0.2) c.lerp(mossCol, 0.75);
    for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const pal = (...hex) => hex.map((h) => new THREE.Color(h));
const PAL = {
  oak: pal('#3f7a2a', '#4d8c30', '#5c9a35', '#356b24', '#467f2b'),
  autumn: pal('#c8641e', '#d98a24', '#b84a1c', '#e0a832', '#9c3d18'),
  pine: pal('#2b5a2e', '#24502a', '#336636', '#1f4626'),
  bush: pal('#3d7a2c', '#4b8a31', '#2f6524', '#5a9637'),
  rock: pal('#8d8a85', '#7c7a76', '#9a958d', '#6f6d6a', '#858079'),
  moss: new THREE.Color('#4f7d2c'),
};

function blobCanopy(rand, count, cy, spreadH, spreadV, rMin, rMax, palette) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const r = rMin + rand() * (rMax - rMin);
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.deleteAttribute('uv');
    displace(g, 1.3, 0.28, rand() * 50);
    const a = rand() * Math.PI * 2, d = i === 0 ? 0 : spreadH * (0.4 + rand() * 0.6);
    g.translate(Math.cos(a) * d, cy + (rand() - 0.5) * spreadV * 2 + (i === 0 ? 0.2 : 0), Math.sin(a) * d);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  colorFaces(geo, palette, rand);
  return geo;
}

function buildBush(rand) {
  return blobCanopy(rand, 3 + Math.floor(rand() * 2), 0.45, 0.55, 0.15, 0.4, 0.7, PAL.bush);
}

// ---------- Modèles du Pirate Kit ----------
// Modèles du pack KayKit Forest Nature (plusieurs formes pour que rien ne se ressemble)
const TREES = ['Tree_1_A', 'Tree_1_B', 'Tree_1_C', 'Tree_2_A', 'Tree_2_B', 'Tree_2_C', 'Tree_2_D', 'Tree_2_E',
  'Tree_3_A', 'Tree_3_B', 'Tree_3_C', 'Tree_4_A', 'Tree_4_B', 'Tree_4_C', 'Tree_1_B', 'Tree_3_B', 'Tree_4_B', 'Tree_2_C',
  'Tree_Bare_1_A', 'Tree_Bare_1_B', 'Tree_Bare_1_C', 'Tree_Bare_2_A', 'Tree_Bare_2_B', 'Tree_Bare_2_C'].map((n) => 'f_' + n);
const ROCKS = ['Rock_1_D', 'Rock_1_E', 'Rock_1_F', 'Rock_1_G', 'Rock_1_H', 'Rock_1_I', 'Rock_3_E', 'Rock_3_F', 'Rock_3_G',
  'Rock_3_H', 'Rock_3_I', 'Rock_3_J', 'Rock_3_K', 'Rock_3_L', 'Rock_2_C', 'Rock_2_D'].map((n) => 'f_' + n);
const BUSHES = ['Bush_1_B', 'Bush_1_C', 'Bush_1_D', 'Bush_2_A', 'Bush_2_B', 'Bush_2_C', 'Bush_3_A', 'Bush_3_B', 'Bush_4_A', 'Bush_4_B', 'Bush_4_C'].map((n) => 'f_' + n);
const PEBBLES = ['Rock_1_A', 'Rock_1_B', 'Rock_1_C', 'Rock_2_A', 'Rock_2_B', 'Rock_3_A', 'Rock_3_B', 'Rock_3_C', 'Rock_3_D'].map((n) => 'f_' + n);
const BIG_ROCKS = ['Rock_1_J', 'Rock_1_K', 'Rock_1_N', 'Rock_1_O', 'Rock_2_E', 'Rock_2_G', 'Rock_3_M', 'Rock_3_Q'].map((n) => 'f_' + n);
const TREE_SCALE = KK;    // les arbres du pack font 3 à 11 unités
const hashId = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
// Géométrie centrée en x/z, posée au sol et ramenée à une demi-largeur « size »
function unitGeometry(name, size) {
  const g = staticGeometry(name).clone();
  g.computeBoundingBox();
  const b = g.boundingBox;
  const half = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  const k = size / half;
  g.scale(k, k, k);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// ---------- Particules ----------
export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.groundFn = heightAt;
    this.list = [];
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.leaf = new THREE.PlaneGeometry(1, 0.6);
    this.sphere = new THREE.IcosahedronGeometry(1, 1);
    this.mats = {
      wood: new THREE.MeshStandardMaterial({ color: '#d4a96a', roughness: 0.9 }),
      bark: new THREE.MeshStandardMaterial({ color: '#5a3c22', roughness: 1 }),
      stone: new THREE.MeshStandardMaterial({ color: '#8a8680', roughness: 0.9, flatShading: true }),
      leaf: new THREE.MeshStandardMaterial({ color: '#4d8c30', side: THREE.DoubleSide }),
      leafAutumn: new THREE.MeshStandardMaterial({ color: '#d98a24', side: THREE.DoubleSide }),
      leafPine: new THREE.MeshStandardMaterial({ color: '#2b5a2e', side: THREE.DoubleSide }),
    };
    // éclats de rocher : les petits cailloux du Pirate Kit (taille ~1)
    this.fragMat = modelMaterial('f_Rock_1_A');
    this.fragGeos = PEBBLES.map((n) => unitGeometry(n, 1));
    this.mats.palm = new THREE.MeshStandardMaterial({ color: '#5fae3c', side: THREE.DoubleSide });
  }
  spawn(o) {
    const mesh = new THREE.Mesh(o.geo, o.mat);
    mesh.position.copy(o.pos);
    mesh.scale.setScalar(o.size);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    mesh.castShadow = !!o.shadow;
    this.scene.add(mesh);
    this.list.push({
      mesh, vel: o.vel.clone(), life: o.life, max: o.life, size: o.size,
      gravity: o.gravity ?? 15, drag: o.drag ?? 0.5, spin: o.spin ?? 6, flutter: o.flutter ?? 0,
      bounce: o.bounce ?? 0.3, puff: !!o.puff, windK: o.windK ?? 0,
      av: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(o.spin ?? 6),
    });
  }
  puff(pos, color = 0xd8cfc0, count = 4, size = 0.4) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
      this.spawn({
        geo: this.sphere, mat, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.3, (Math.random() - 0.5) * 0.6)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5),
        size: size * (0.6 + Math.random() * 0.6), life: 0.9 + Math.random() * 0.5, gravity: 0, drag: 2, spin: 0, puff: true,
      });
    }
  }
  update(dt, wind) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      const m = p.mesh;
      if (p.life <= 0) {
        this.scene.remove(m);
        if (p.puff) m.material.dispose();
        this.list.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      if (p.windK) { p.vel.x += wind.x * wind.z * p.windK * dt; p.vel.z += wind.y * wind.z * p.windK * dt; }
      if (p.flutter) { p.vel.x += Math.sin(p.life * 7 + i) * p.flutter * dt; p.vel.z += Math.cos(p.life * 5 + i) * p.flutter * dt; }
      m.position.addScaledVector(p.vel, dt);
      const gy = this.groundFn(m.position.x, m.position.z) + p.size * 0.4;
      if (m.position.y < gy) {
        m.position.y = gy;
        if (p.vel.y < 0) p.vel.y *= -p.bounce;
        p.vel.x *= 0.6; p.vel.z *= 0.6; p.av.multiplyScalar(0.6);
      }
      m.rotation.x += p.av.x * dt; m.rotation.y += p.av.y * dt; m.rotation.z += p.av.z * dt;
      const k = p.life / p.max;
      if (p.puff) { m.scale.setScalar(p.size * (1 + (1 - k) * 2)); m.material.opacity = 0.45 * k; }
      else if (k < 0.25) m.scale.setScalar(p.size * (k / 0.25));
    }
  }
}

// ---------- Le monde naturel ----------
export class Nature {
  constructor(scene, wind) {
    this.scene = scene;
    this.wind = wind;
    this.fx = new Particles(scene);
    this.resources = new Map();
    this.list = [];
    this.highlighted = null;
    this.ambientT = 0;

    const bark = makeBarkTexture();
    const forest = textureOf('f_Tree_1_A');
    const mk = (emissive) => ({
      palm: windMaterial({ map: forest, roughness: 0.8, metalness: 0, emissive }, wind, false, 0.005),
      leaf: windMaterial({ map: forest, roughness: 0.8, metalness: 0, emissive }, wind, false, 0.03),
      rock: new THREE.MeshStandardMaterial({ map: forest, roughness: 0.85, metalness: 0, emissive }),
    });
    this.mat = mk(0x000000);
    this.hiMat = mk(0x16120a);
    this.flashMat = mk(0xffffff);   // fondu blanc quand on frappe
    this.flashing = [];
    this.stumpSide = new THREE.MeshStandardMaterial({ map: bark, roughness: 1 });
    this.stumpTop = new THREE.MeshStandardMaterial({ map: makeRingsTexture(), roughness: 0.9 });

    // Modèles (identiques chez tous les joueurs grâce à la graine fixe)
    const r = seededRandom(1234);
    void r;
    // arbres (le tronc part de l'origine du modèle)
    this.palms = TREES.map((n) => {
      const geo = staticGeometry(n);
      const b = geo.boundingBox;
      const top = b.max.y;
      return { geo, canopyY: top * 0.72, canopyR: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.35, height: top, bare: n.includes('Bare') };
    });
    // rochers : demi-largeur 1 (la taille « s » du serveur donne le rayon)
    this.rockGeos = ROCKS.map((n) => unitGeometry(n, 1.05));
    // buissons : demi-largeur 0,62
    this.bushGeos = BUSHES.map((n) => unitGeometry(n, 0.62));
    this.stumpGeo = new THREE.CylinderGeometry(0.24, 0.34, 0.45, 10);
    this.stumpGeo.translate(0, 0.2, 0);
    this.stumpTopGeo = new THREE.CircleGeometry(0.24, 16);
    this.stumpTopGeo.rotateX(-Math.PI / 2);
    this.stumpTopGeo.translate(0, 0.43, 0);

    this.populate();
    this.createMotes();
    this.stumps = [];
  }

  // Petits cailloux décoratifs posés partout (identiques chez tout le monde, sans collision)
  populate() {
    this.landmarks = [];
    this.populateBigRocks();
    const rand = seededRandom(4242);
    const geos = PEBBLES.map((n) => unitGeometry(n, 1));
    const per = PEBBLES.map(() => []);
    const L = WORLD_LIMIT - 2;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0, n = 0; i < 6000 && n < 650; i++) {
      // en petits groupes de 1 à 4 cailloux
      const cx = (rand() * 2 - 1) * L, cz = (rand() * 2 - 1) * L;
      if (Math.hypot(cx - GEM_HOME.x, cz - GEM_HOME.z) < 7) continue;
      if (cx > CLIFF.x0 - 2 && cx < CLIFF.x1 + 1) continue;
      if (CAVES.some((c) => caveK(c, cx, cz) > 0.3)) continue;
      if (this.landmarks.some((l) => Math.hypot(l.x - cx, l.z - cz) < l.r + 1)) continue;
      const k = 1 + Math.floor(rand() * 4);
      for (let j = 0; j < k; j++) {
        const x = cx + (rand() - 0.5) * 2.4, z = cz + (rand() - 0.5) * 2.4;
        if (isWater(x, z) && rand() < 0.7) continue;
        const v = Math.floor(rand() * PEBBLES.length);
        const s = (j === 0 ? 0.18 + rand() * 0.25 : 0.08 + rand() * 0.15) * (rand() < 0.08 ? 2 : 1);
        p.set(x, heightAt(x, z) - s * 0.25, z);
        q.setFromEuler(e.set((rand() - 0.5) * 0.4, rand() * 6.28, (rand() - 0.5) * 0.4));
        sc.set(s, s * (0.7 + rand() * 0.5), s);
        per[v].push(m.compose(p, q, sc).clone());
        n++;
      }
    }
    const mat = modelMaterial('f_Rock_1_A');
    this.pebbles = per.map((list, v) => {
      const im = new THREE.InstancedMesh(geos[v], mat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      return im;
    });
  }

  // Quelques grands rochers (décor fixe, on ne peut pas les casser mais on s'y cogne)
  populateBigRocks() {
    const rand = seededRandom(777);
    const L = WORLD_LIMIT - 8;
    const mat = modelMaterial('f_Rock_1_A');
    for (let i = 0, n = 0; i < 2000 && n < 26; i++) {
      const x = (rand() * 2 - 1) * L, z = (rand() * 2 - 1) * L;
      if (Math.hypot(x - GEM_HOME.x, z - GEM_HOME.z) < 24) continue;
      if (riverDist(x, z) < 12 || isWater(x, z)) continue;
      if (x > CLIFF.x0 - 8 && x < CLIFF.x1 + 6) continue;
      if (CAVES.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 10)) continue;
      if (this.landmarks.some((l) => Math.hypot(l.x - x, l.z - z) < 18)) continue;
      const name = BIG_ROCKS[n % BIG_ROCKS.length];
      const geo = unitGeometry(name, 1);
      const r = 1.8 + rand() * 1.6;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, heightAt(x, z) - 0.25 * r, z);
      m.rotation.y = rand() * Math.PI * 2;
      m.scale.setScalar(r);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
      this.landmarks.push({ x, z, r: r * 0.85, mesh: m });
      n++;
    }
  }

  // Reçoit la liste complète envoyée par le serveur (début de partie)
  load(list) {
    for (const r of this.list) this.removeMeshes(r);
    this.resources.clear();
    this.list = [];
    this.highlighted = null;
    for (const res of list) this.add(res, false);
  }

  add(res, grow) {
    if (this.resources.has(res.id)) return;
    if (res.k === 't') {
      const h = hashId(res.id);
      this.addTree(res.id, res.x, res.z, this.palms[(res.v * 7 + h) % this.palms.length], res.s, h);
    } else if (res.k === 'b') {
      this.addBush(res.id, res.x, res.z, res.s, this.bushGeos[(res.v * 5 + hashId(res.id)) % this.bushGeos.length], res.rot);
    } else {
      this.addRock(res.id, res.x, res.z, res.s, this.rockGeos[(res.v * 3 + hashId(res.id)) % this.rockGeos.length], res.rot);
    }
    const r = this.resources.get(res.id);
    if (res.rich && r) {
      // rocher riche : gemmes roses qui sortent de la roche
      if (!this.richMat) {
        this.richMat = new THREE.MeshStandardMaterial({ map: atlasTexture(), emissive: '#c040ff', emissiveIntensity: 0.55, roughness: 0.2, flatShading: true });
        this.richGeo = staticGeometry('Gem_Pink').clone();
        this.richGeo.computeBoundingBox();
        this.richGeo.translate(0, -this.richGeo.boundingBox.min.y, 0);
      }
      for (let i = 0; i < 5; i++) {
        const cr = new THREE.Mesh(this.richGeo, this.richMat);
        const a = i * 1.3;
        cr.scale.setScalar(0.45 + (i % 3) * 0.15);
        cr.position.set(Math.cos(a) * 0.75, 0.25 + (i % 2) * 0.3, Math.sin(a) * 0.75);
        cr.rotation.set(Math.cos(a) * 0.6, a, -Math.sin(a) * 0.6);
        cr.castShadow = true;
        r.mesh.add(cr);
      }
      r.rich = true;
    }
    if (res.hp != null) this.setHp(res.id, res.hp);
    if (grow) {
      r.state = 'growing'; r.anim = 0;
      if (r.kind === 'tree') r.group.scale.setScalar(0.01); else r.mesh.scale.setScalar(0.01);
      this.fx.puff(new THREE.Vector3(r.x, r.y + 0.3, r.z), 0xcfe8b0, 5, 0.5);
    }
  }

  removeMeshes(r) {
    if (r.kind === 'tree') { this.scene.remove(r.group); this.scene.remove(r.stump); }
    else this.scene.remove(r.mesh);
  }

  addTree(id, x, z, proto, s, v) {
    const scale = s * TREE_SCALE;
    const group = new THREE.Group();
    const y = heightAt(x, z) - 0.08;
    group.position.set(x, y, z);
    group.scale.setScalar(scale);
    const trunk = new THREE.Mesh(proto.geo, this.mat.palm);
    // chaque arbre est tourné différemment
    trunk.rotation.y = ((v % 628) / 100);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);
    this.scene.add(group);
    const stump = new THREE.Group();
    stump.add(new THREE.Mesh(this.stumpGeo, this.stumpSide), new THREE.Mesh(this.stumpTopGeo, this.stumpTop));
    stump.position.set(x, y, z);
    stump.scale.set(s * 0.75, s * 0.6, s * 0.75);
    stump.visible = false;
    stump.children.forEach((m) => { m.castShadow = true; });
    this.scene.add(stump);
    const t = {
      id, kind: 'tree', x, z, y, r: 0.4 * s, max: TREE_HP, hp: TREE_HP, alive: true, state: 'idle',
      group, trunk, leaves: null, stump, scale, bare: proto.bare,
      canopyY: proto.canopyY * scale, canopyR: proto.canopyR * scale, height: proto.height * scale,
      shakeT: 9, shakeDir: new THREE.Vector2(), anim: 0,
    };
    this.resources.set(id, t); this.list.push(t);
  }

  addBush(id, x, z, size, geo, rot) {
    const mesh = new THREE.Mesh(geo, this.mat.leaf);
    const y = heightAt(x, z) - 0.05;
    mesh.position.set(x, y, z);
    mesh.rotation.y = rot;
    mesh.scale.setScalar(size);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    const b = { id, kind: 'bush', x, z, y, size, scale: size, r: 0.55 * size, max: 2, hp: 2, alive: true, state: 'idle', mesh, body: mesh, shakeT: 9, shakeDir: new THREE.Vector2(), anim: 0 };
    this.resources.set(id, b); this.list.push(b);
  }

  addRock(id, x, z, size, geo, rot) {
    // groupe (taille, position) + rocher du Pirate Kit dedans
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(geo, this.mat.rock);
    body.castShadow = body.receiveShadow = true;
    mesh.add(body);
    const y = heightAt(x, z) - 0.1 * size;
    mesh.position.set(x, y, z);
    mesh.rotation.y = rot;
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    const r = { id, kind: 'rock', x, z, y, size, r: size * 0.9, scale: size, max: ROCK_HP, hp: ROCK_HP, alive: true, state: 'idle', mesh, body, shakeT: 9, shakeDir: new THREE.Vector2(), anim: 0 };
    this.resources.set(id, r); this.list.push(r);
  }

  createMotes() {
    const N = 350;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = (Math.random() - 0.5) * 40;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // Petit point lumineux rond et doux
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 32, 32);
    this.motes = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xfff3c4, size: 0.12, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.motes.frustumCulled = false;
    this.moteSeeds = Float32Array.from({ length: N }, () => Math.random() * 100);
    this.scene.add(this.motes);
  }

  // ----- Interaction -----
  getTarget(px, pz, fx, fz, reach) {
    let best = null, bestScore = Infinity;
    for (const r of this.list) {
      if (!r.alive || (r.state !== 'idle' && r.state !== 'growing')) continue;
      const dx = r.x - px, dz = r.z - pz;
      if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
      const d = Math.hypot(dx, dz), edge = d - r.r;
      if (edge > reach) continue;
      const dot = (dx * fx + dz * fz) / Math.max(d, 0.01);
      if (dot < 0.3 && edge > 0.4) continue;
      const score = edge - dot * 1.5;
      if (score < bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  collide(pos, radius) {
    for (const l of this.landmarks) {
      const dx = pos.x - l.x, dz = pos.z - l.z, min = l.r + radius;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 0.0001) { pos.x = l.x + dx / d * min; pos.z = l.z + dz / d * min; }
    }
    for (const r of this.list) {
      if (!r.alive || r.state === 'falling' || r.kind === 'bush') continue;
      const dx = pos.x - r.x, dz = pos.z - r.z;
      const min = r.r + radius;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 0.0001) { pos.x = r.x + dx / d * min; pos.z = r.z + dz / d * min; }
    }
  }

  applyMat(res, set) {
    if (!res) return;
    if (res.kind === 'tree') res.trunk.material = set.palm;
    else res.body.material = res.kind === 'bush' ? set.leaf : set.rock;
  }

  flash(r) {
    r.flashT = 0.22;
    if (!this.flashing.includes(r)) this.flashing.push(r);
    this.applyMat(r, this.flashMat);
  }

  setHighlight(r) {
    if (this.highlighted === r) return;
    const apply = (res, set) => {
      if (!res || res.flashT > 0) return;
      this.applyMat(res, set);
    };
    apply(this.highlighted, this.mat);
    apply(r, this.hiMat);
    this.highlighted = r;
  }

  impactPoint(r, fromX, fromZ) {
    const dx = fromX - r.x, dz = fromZ - r.z, d = Math.hypot(dx, dz) || 1;
    const k = r.r * (r.kind === 'rock' ? 0.8 : 1);
    return new THREE.Vector3(r.x + dx / d * k, r.y + (r.kind === 'tree' ? 1.0 : r.kind === 'bush' ? r.size * 0.5 : r.size * 0.55), r.z + dz / d * k);
  }

  // Coup reçu (effets visuels)
  hit(id, fromX, fromZ) {
    const r = this.resources.get(id);
    if (!r || !r.alive) return;
    const p = this.impactPoint(r, fromX, fromZ);
    const out = new THREE.Vector3(fromX - r.x, 0, fromZ - r.z).normalize();
    r.shakeT = 0;
    r.shakeDir.set(-out.x, -out.z);
    this.flash(r);
    // étincelles blanches à l'impact
    if (!this.sparkMat) this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    for (let i = 0; i < 6; i++) {
      this.fx.spawn({
        geo: this.fx.box, mat: this.sparkMat, pos: p,
        vel: out.clone().multiplyScalar(3 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5)),
        size: 0.025 + Math.random() * 0.02, life: 0.25 + Math.random() * 0.15, gravity: 8, spin: 0,
      });
    }
    if (r.kind === 'tree') this.fx.puff(p, 0xd8c8a8, 1, 0.25);
    if (r.kind === 'tree') {
      for (let i = 0; i < 8; i++) {
        this.fx.spawn({
          geo: this.fx.box, mat: i % 3 ? this.fx.mats.wood : this.fx.mats.bark, pos: p,
          vel: out.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3)),
          size: 0.05 + Math.random() * 0.07, life: 1.5 + Math.random(), gravity: 14, shadow: false,
        });
      }
      for (let i = 0; i < 5; i++) this.spawnLeaf(r, true);
    } else if (r.kind === 'bush') {
      this.bushBurst(r, p, 7);
    } else {
      for (let i = 0; i < 10; i++) {
        this.fx.spawn({
          geo: this.fx.box, mat: this.fx.mats.stone, pos: p,
          vel: out.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 4, (Math.random() - 0.5) * 3)),
          size: 0.05 + Math.random() * 0.08, life: 1.2 + Math.random(), gravity: 18,
        });
      }
      this.fx.puff(p, 0xbab3a6, 2, 0.25);
    }
  }

  setHp(id, hp) {
    const r = this.resources.get(id);
    if (!r) return;
    r.hp = hp;
    if (r.kind !== 'tree' && r.state !== 'growing') r.mesh.scale.setScalar(r.size * (0.75 + 0.25 * Math.max(0, hp) / r.max));
  }

  bushBurst(r, p, n) {
    for (let i = 0; i < n; i++) {
      this.fx.spawn({
        geo: this.fx.leaf, mat: this.fx.mats.leaf, pos: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.4, (Math.random() - 0.5) * 0.6)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 4, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 4),
        size: 0.12, life: 2 + Math.random() * 2, gravity: 2, drag: 1.5, flutter: 3, windK: 1.5,
      });
    }
  }

  spawnLeaf(t, burst) {
    if (t.bare) return;
    const a = Math.random() * Math.PI * 2, d = Math.random() * t.canopyR;
    const pos = new THREE.Vector3(t.x + Math.cos(a) * d, t.y + t.canopyY + (Math.random() - 0.5) * 1.2, t.z + Math.sin(a) * d);
    this.fx.spawn({
      geo: this.fx.leaf, mat: this.fx.mats.palm, pos,
      vel: new THREE.Vector3((Math.random() - 0.5) * (burst ? 3 : 0.5), burst ? Math.random() * 2 : 0, (Math.random() - 0.5) * (burst ? 3 : 0.5)),
      size: 0.12 + Math.random() * 0.06, life: 5 + Math.random() * 3, gravity: 0.9, drag: 1.8, spin: 4, flutter: 3, windK: 2.2, bounce: 0,
    });
  }

  destroy(id, dx, dz) {
    const r = this.resources.get(id);
    if (!r || !r.alive) return;
    r.alive = false; r.hp = 0;
    if (this.highlighted === r) this.setHighlight(null);
    if (r.kind === 'bush') {
      r.state = 'dead';
      this.bushBurst(r, new THREE.Vector3(r.x, r.y + r.size * 0.5, r.z), 18);
      this.fx.puff(new THREE.Vector3(r.x, r.y + 0.4, r.z), 0x9ac070, 4, 0.4);
      this.scene.remove(r.mesh);
      this.forget(r);
      return;
    }
    if (r.kind === 'tree') {
      const d = Math.hypot(dx, dz) || 1;
      r.fallDir = new THREE.Vector2(dx / d, dz / d);
      r.axis = new THREE.Vector3(r.fallDir.y, 0, -r.fallDir.x).normalize();
      r.state = 'falling'; r.angle = 0.02; r.angVel = 0.25; r.anim = 0; r.bounced = false;
      r.stump.visible = true;
      this.audio?.play('treeCreak', new THREE.Vector3(r.x, r.y + 2, r.z));
      this.stumps.push({ mesh: r.stump, t: 0 });
      for (let i = 0; i < 10; i++) {
        this.fx.spawn({
          geo: this.fx.box, mat: this.fx.mats.wood, pos: new THREE.Vector3(r.x, r.y + 0.5, r.z),
          vel: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5),
          size: 0.06 + Math.random() * 0.08, life: 2, gravity: 14,
        });
      }
    } else {
      r.state = 'dead';
      this.scene.remove(r.mesh);
      this.forget(r);
      const c = new THREE.Vector3(r.x, r.y + r.size * 0.3, r.z);
      const n = 7 + Math.floor(r.size * 4);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 3;
        this.fx.spawn({
          geo: this.fx.fragGeos[i % 4], mat: this.fx.fragMat,
          pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r.size * 0.4, Math.random() * r.size * 0.4, Math.sin(a) * r.size * 0.4)),
          vel: new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp),
          size: r.size * (0.14 + Math.random() * 0.16), life: 3.5 + Math.random(), gravity: 18, bounce: 0.35, spin: 8, shadow: true,
        });
      }
      for (let i = 0; i < 14; i++) {
        this.fx.spawn({
          geo: this.fx.box, mat: this.fx.mats.stone, pos: c,
          vel: new THREE.Vector3((Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7),
          size: 0.05 + Math.random() * 0.08, life: 1.5 + Math.random(), gravity: 18,
        });
      }
      this.fx.puff(c, 0xbab3a6, 6, r.size * 0.5);
      this.audio?.play('rockBreak', c);
    }
  }

  forget(r) {
    this.resources.delete(r.id);
    const i = this.list.indexOf(r);
    if (i >= 0) this.list.splice(i, 1);
  }

  // Les arbres, rochers et buissons très loin (dans le brouillard) ne sont pas dessinés
  cull(player) {
    const D2 = 150 * 150;
    for (const r of this.list) {
      const far = (r.x - player.x) ** 2 + (r.z - player.z) ** 2 > D2;
      const obj = r.kind === 'tree' ? r.group : r.mesh;
      obj.visible = !far;
    }
  }

  update(dt, time, windVec, player, night) {
    this.cullT = (this.cullT || 0) - dt;
    if (this.cullT <= 0) { this.cullT = 0.3; this.cull(player); }
    // fondu blanc qui s'estompe
    let lvl = 0;
    for (let i = this.flashing.length - 1; i >= 0; i--) {
      const r = this.flashing[i];
      r.flashT -= dt;
      if (r.flashT <= 0 || !r.alive) {
        this.flashing.splice(i, 1);
        r.flashT = 0;
        if (r.alive) this.applyMat(r, this.highlighted === r ? this.hiMat : this.mat);
      } else lvl = Math.max(lvl, r.flashT / 0.22);
    }
    for (const k of ['palm', 'leaf', 'rock']) this.flashMat[k].emissiveIntensity = 0.1 + lvl * 0.4;
    // Les souches s'enfoncent et disparaissent au bout d'un moment
    for (let i = this.stumps.length - 1; i >= 0; i--) {
      const st = this.stumps[i];
      st.t += dt;
      if (st.t > 60) st.mesh.position.y -= dt * 0.3;
      if (st.t > 63) { this.scene.remove(st.mesh); this.stumps.splice(i, 1); }
    }
    for (const r of [...this.list]) {
      if (r.state === 'idle' && r.shakeT < 1.5) {
        r.shakeT += dt;
        const amp = Math.exp(-r.shakeT * 7) * Math.sin(r.shakeT * 38);
        if (r.kind === 'tree') r.group.rotation.set(r.shakeDir.y * amp * 0.05, 0, -r.shakeDir.x * amp * 0.05);
        else { r.mesh.position.x = r.x + r.shakeDir.x * amp * 0.04; r.mesh.position.z = r.z + r.shakeDir.y * amp * 0.04; }
      } else if (r.state === 'falling') {
        r.anim += dt;
        if (!r.bounced) {
          r.angVel += (2.4 * Math.sin(r.angle) + 0.4) * dt;
          r.angle += r.angVel * dt;
          if (r.angle >= 1.5) {
            r.angle = 1.5; r.angVel = -r.angVel * 0.18; r.bounced = true; r.anim = 0;
            const top = new THREE.Vector3(r.x + r.fallDir.x * r.canopyY, r.y + 0.6, r.z + r.fallDir.y * r.canopyY);
            this.fx.puff(top, 0xcfc6b0, 7, 0.7);
            this.audio?.play('treeFall', top);
            for (let i = 0; i < 18; i++) {
              this.fx.spawn({
                geo: this.fx.leaf, mat: this.fx.mats.palm,
                pos: top.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2)),
                vel: new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4),
                size: 0.13, life: 4 + Math.random() * 2, gravity: 1.2, drag: 1.6, flutter: 3, windK: 2,
              });
            }
          }
        } else {
          r.angVel += 3 * dt;
          r.angle = Math.min(1.5, r.angle + r.angVel * dt);
          if (r.anim > 4) r.group.position.y -= dt * 1.2;
          if (r.anim > 4) r.group.scale.setScalar(r.scale * Math.max(0.01, 1 - (r.anim - 4) / 1.5));
          if (r.anim > 5.5) { r.state = 'dead'; this.scene.remove(r.group); this.forget(r); }
        }
        r.group.quaternion.setFromAxisAngle(r.axis, r.angle);
      } else if (r.state === 'growing') {
        r.anim += dt;
        const t = Math.min(1, r.anim / 1.4);
        const s = 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2); // "easeOutBack"
        if (r.kind === 'tree') { r.group.scale.setScalar(r.scale * Math.max(0.01, s)); if (t > 0.3) r.stump.visible = false; }
        else r.mesh.scale.setScalar(r.size * Math.max(0.01, s));
        if (t >= 1) { r.state = 'idle'; r.shakeT = 9; if (r.kind === 'tree') r.group.rotation.set(0, 0, 0); }
      }
    }

    // Feuilles emportées par le vent
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 0.35 / Math.max(0.3, windVec.z);
      const near = this.list.filter((r) => r.kind === 'tree' && r.alive && r.state === 'idle' && Math.abs(r.x - player.x) < 25 && Math.abs(r.z - player.z) < 25);
      if (near.length) this.spawnLeaf(near[Math.floor(Math.random() * near.length)], false);
    }
    this.fx.update(dt, windVec);

    // Pollen le jour, lucioles la nuit
    const pos = this.motes.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const s = this.moteSeeds[i];
      let x = pos.getX(i) + (windVec.x * windVec.z * 0.6 + Math.sin(time * 0.7 + s) * 0.3) * dt;
      let y = pos.getY(i) + Math.sin(time * 1.3 + s * 2) * 0.25 * dt;
      let z = pos.getZ(i) + (windVec.y * windVec.z * 0.6 + Math.cos(time * 0.6 + s) * 0.3) * dt;
      if (x - player.x > 20) x -= 40; if (x - player.x < -20) x += 40;
      if (z - player.z > 20) z -= 40; if (z - player.z < -20) z += 40;
      const gy = heightAt(x, z);
      if (y < gy + 0.3) y = gy + 4; if (y > gy + 5) y = gy + 0.4;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    const m = this.motes.material;
    m.color.setRGB(1, 0.95, 0.75).lerp(new THREE.Color(0.75, 1, 0.3), night);
    m.size = 0.1 + night * 0.12;
    m.opacity = 0.35 + night * 0.6;
  }
}
