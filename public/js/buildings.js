// Constructions : plancher, charpente, mur, fenêtre, porte, escalier et toit en bois
// (modèles du « Wood Frame Base Build Set »), plus les défenses (mur de pierre, pieux, tours).
// Aperçu fantôme, grille de 2 m, étages (molette pour monter / descendre), collisions.
import * as THREE from 'three';
import {
  heightAt, GRID, WALL_H, BUILD_TIME, BUILD_RANGE, PIECES, wallBox, pieceTop, distToBox, slotKey,
  isWallType, stairsHeight, pieceCost, pieceUnlocked, canAfford, MAX_LEVEL,
} from './world.js';
import { prop } from './models.js';

// modèles en bois de chaque pièce (plusieurs variantes pour que tout ne se ressemble pas)
const WOOD = {
  floor: ['w_floor1', 'w_floor2', 'w_floor4', 'w_floor5'],
  wall: ['w_wall1', 'w_wall2', 'w_wall4'],
  window: ['w_window1', 'w_window2'],
  door: ['w_door'], stairs: ['w_stairs'], base: ['w_base4', 'w_base6'], roof: ['w_roof'],
};
const variantOf = (id) => { const n = parseInt(String(id || '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : 0; };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function plankTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const shade = 0.85 + Math.random() * 0.25;
      ctx.fillStyle = `rgb(${150 * shade | 0},${102 * shade | 0},${62 * shade | 0})`;
      ctx.fillRect(i * w / n, 0, w / n, h);
      for (let k = 0; k < 14; k++) {
        ctx.strokeStyle = `rgba(80,50,25,${0.15 + Math.random() * 0.25})`;
        ctx.lineWidth = 1;
        const x = i * w / n + Math.random() * w / n;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 4, h * 0.3, x - 4, h * 0.6, x + 2, h); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,24,12,0.9)';
      ctx.fillRect(i * w / n, 0, 3, h);
      const ny = Math.random() * h;
      ctx.fillStyle = 'rgba(60,35,18,0.8)';
      ctx.beginPath(); ctx.ellipse(i * w / n + w / n / 2, ny, 3, 6, 0, 0, Math.PI * 2); ctx.fill();
      // clous
      ctx.fillStyle = '#2b2b2b';
      for (const y of [12, h - 12]) { ctx.fillRect(i * w / n + 10, y, 4, 4); ctx.fillRect(i * w / n + w / n - 14, y, 4, 4); }
    }
  });
}
export function stoneTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5d5a55'; ctx.fillRect(0, 0, w, h);
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 25;
      for (let x = -50; x < w; x += 50 + Math.random() * 10) {
        const g = 120 + Math.random() * 40;
        ctx.fillStyle = `rgb(${g},${g - 4},${g - 10})`;
        const bw = 46 + Math.random() * 8, bh = h / rows - 5;
        ctx.beginPath();
        ctx.roundRect(x + off + 2, r * h / rows + 2, bw, bh, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + off + 4, r * h / rows + 4, bw - 6, 4);
      }
    }
  });
}
// pavés de la dalle de chemin
function pathTexture() {
  return canvasTex(256, 256, (ctx, w) => {
    ctx.fillStyle = '#5d5850'; ctx.fillRect(0, 0, w, w);
    const n = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const s = w / n, x = i * s + (j % 2 ? s / 2 : 0), y = j * s;
      for (const ox of [0, -w]) {
        const g = 140 + Math.random() * 40;
        ctx.fillStyle = `rgb(${g},${g - 6},${g - 16})`;
        ctx.beginPath(); ctx.roundRect(x + ox + 4, y + 4, s - 8, s - 8, 10); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + ox + 8, y + 7, s - 22, 6);
      }
    }
  });
}
export function shingleTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4b4a48'; ctx.fillRect(0, 0, w, h);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 16;
      for (let x = -32; x < w; x += 32) {
        const g = 95 + Math.random() * 35;
        ctx.fillStyle = `rgb(${g + 12},${g},${g - 8})`;
        ctx.beginPath(); ctx.roundRect(x + off + 1, r * h / rows, 30, h / rows + 6, [0, 0, 8, 8]); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + off + 1, r * h / rows + h / rows + 2, 30, 3);
      }
    }
  });
}

export class Buildings {
  constructor(scene, fx, audio) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.map = new Map();
    const planks = plankTexture(), stone = stoneTexture(), shingles = shingleTexture();
    this.mats = {
      planks: new THREE.MeshStandardMaterial({ map: planks, roughness: 0.85 }),
      planksDark: new THREE.MeshStandardMaterial({ map: planks, color: '#a07a5a', roughness: 0.9 }),
      log: new THREE.MeshStandardMaterial({ color: '#6a4528', roughness: 0.9 }),
      stone: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 }),
      shingles: new THREE.MeshStandardMaterial({ map: shingles, roughness: 0.9 }),
      stoneWall: new THREE.MeshStandardMaterial({ map: stone, color: '#d8d2c8', roughness: 0.95 }),
      iron: new THREE.MeshStandardMaterial({ color: '#555a60', metalness: 0.6, roughness: 0.45 }),
      stake: new THREE.MeshStandardMaterial({ color: '#c49a6a', roughness: 0.8 }),
      ice: new THREE.MeshStandardMaterial({ color: '#bfe8ff', emissive: '#4ab8ff', emissiveIntensity: 1.2, roughness: 0.15, transparent: true, opacity: 0.9 }),
      rune: new THREE.MeshStandardMaterial({ color: '#9ad8ff', emissive: '#3aa8ff', emissiveIntensity: 1.4 }),
      doorLeaf: new THREE.MeshStandardMaterial({ map: planks, color: '#d08850', roughness: 0.85 }),
      path: new THREE.MeshStandardMaterial({ map: pathTexture(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    this.bars = new Map();
    this.blueprint = new THREE.MeshStandardMaterial({ color: '#9fd0ff', emissive: '#2a5a90', transparent: true, opacity: 0.45, depthWrite: false });
    this.ghostOk = new THREE.MeshBasicMaterial({ color: '#6dff8a', transparent: true, opacity: 0.38, depthWrite: false });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: '#ff5a4a', transparent: true, opacity: 0.38, depthWrite: false });
    this.ghost = null;
    this.ghostKey = '';
    this.version = 0;
  }

  // ----- Création des modèles -----
  makeMesh(type, drop, matOverride, variant = 0) {
    if (WOOD[type]) return this.makeWood(type, drop, matOverride, variant);
    const g = new THREE.Group();
    const m = (name) => matOverride || this.mats[name];
    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = !matOverride; mesh.receiveShadow = !matOverride;
      g.add(mesh);
      return mesh;
    };
    if (type === 'floor') {
      add(new THREE.BoxGeometry(2, 0.14, 2), m('planks'), 0, -0.07, 0);
      const fh = Math.max(0.2, drop + 0.3);
      add(new THREE.BoxGeometry(1.9, fh, 1.9), m('stone'), 0, -0.14 - fh / 2, 0);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(2.02, 0.08, 0.12), m('log'), 0, -0.04, sx * 0.95);
    } else if (type === 'wall') {
      const dh = Math.max(0, drop);
      add(new THREE.BoxGeometry(1.8, WALL_H - 0.2, 0.16), m('planks'), 0, WALL_H / 2, 0);
      for (const sx of [-1, 1]) {
        const post = new THREE.CylinderGeometry(0.11, 0.12, WALL_H + dh + 0.1, 8);
        add(post, m('log'), sx * 0.95, (WALL_H - dh) / 2, 0);
      }
      for (const y of [0.12, WALL_H - 0.1]) add(new THREE.BoxGeometry(1.9, 0.14, 0.22), m('log'), 0, y, 0);
      // Croix de renfort
      for (const s of [1, -1]) {
        const b = add(new THREE.BoxGeometry(0.1, 2.5, 0.06), m('planksDark'), 0, WALL_H / 2, 0.1);
        b.rotation.z = s * 0.62;
      }
      if (dh > 0.05) add(new THREE.BoxGeometry(1.8, dh + 0.2, 0.2), m('stone'), 0, -dh / 2, 0);
    } else if (type === 'roof') {
      add(new THREE.BoxGeometry(2.1, 0.12, 2.1), m('planks'), 0, 0.06, 0);
      for (let i = 0; i < 4; i++) {
        const row = add(new THREE.BoxGeometry(2.14, 0.07, 0.6), m('shingles'), 0, 0.15 + i * 0.045, -0.78 + i * 0.52);
        row.rotation.x = -0.1;
      }
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.12, 0.14, 2.14), m('log'), sx * 1.0, 0.13, 0);
    } else if (type === 'stairs') {
      // Marches qui montent vers +z (la rotation est appliquée au groupe)
      const N = 6;
      for (let i = 0; i < N; i++) {
        const h = (i + 1) * WALL_H / N;
        add(new THREE.BoxGeometry(1.7, 0.12, 2 / N + 0.02), m('planks'), 0, h - 0.06, -1 + (i + 0.5) * 2 / N);
        add(new THREE.BoxGeometry(1.6, h, 0.05), m('planksDark'), 0, h / 2, -1 + i * 2 / N + 0.03);
      }
      for (const sx of [-1, 1]) {
        const side = add(new THREE.BoxGeometry(0.12, 0.25, 3.25), m('log'), sx * 0.9, WALL_H / 2, 0);
        side.rotation.x = -Math.atan2(WALL_H, 2);
        add(new THREE.CylinderGeometry(0.08, 0.09, WALL_H + Math.max(0, drop) + 0.3, 8), m('log'), sx * 0.9, (WALL_H - Math.max(0, drop)) / 2, 0.95);
      }
    } else if (type === 'door') {
      const dh = Math.max(0, drop);
      for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.11, 0.12, WALL_H + dh + 0.1, 8), m('log'), sx * 0.95, (WALL_H - dh) / 2, 0);
      add(new THREE.BoxGeometry(1.9, 0.3, 0.24), m('log'), 0, WALL_H - 0.15, 0);
      // Battant qui pivote (charnière à gauche)
      const hinge = new THREE.Group();
      hinge.position.set(-0.82, 0, 0);
      g.add(hinge);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.64, WALL_H - 0.35, 0.1), m('planksDark'));
      leaf.position.set(0.82, (WALL_H - 0.35) / 2 + 0.02, 0);
      leaf.castShadow = !matOverride;
      hinge.add(leaf);
      for (const y of [0.5, WALL_H - 0.7]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.13), m('iron'));
        band.position.set(0.82, y, 0);
        hinge.add(band);
      }
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 10), m('iron'));
      handle.position.set(1.45, 1.05, 0.08);
      hinge.add(handle);
      g.userData.hinge = hinge;
      if (dh > 0.05) add(new THREE.BoxGeometry(1.8, dh + 0.2, 0.2), m('stone'), 0, -dh / 2, 0);
    } else if (type === 'path') {
      // dalle de pierre qui épouse le terrain (posée par add() / showGhost())
      const geo = new THREE.PlaneGeometry(1.96, 1.96, 6, 6);
      geo.rotateX(-Math.PI / 2);
      const mesh = add(geo, matOverride || this.mats.path, 0, 0, 0);
      mesh.castShadow = false;
      g.userData.conform = mesh;
    } else if (type === 'stonewall') {
      const dh = Math.max(0, drop);
      add(new THREE.BoxGeometry(2.04, WALL_H + dh, 0.42), m('stoneWall'), 0, (WALL_H - dh) / 2, 0);
      // Créneaux
      for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.5, 0.35, 0.46), m('stoneWall'), -0.75 + i * 0.75, WALL_H + 0.17, 0);
    } else if (type === 'tower') {
      // Tour d'archer : pilotis, plateforme, parapet, petit toit et arbalète
      for (const [px, pz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
        const post = add(new THREE.CylinderGeometry(0.12, 0.15, 3.2 + Math.max(0, drop), 8), m('log'), px, (3.2 - Math.max(0, drop)) / 2, pz);
        post.rotation.set(pz * 0.08, 0, -px * 0.08);
      }
      for (const y of [1.0, 2.1]) for (const [w, d, x, z] of [[1.6, 0.1, 0, 0.72], [1.6, 0.1, 0, -0.72], [0.1, 1.6, 0.72, 0], [0.1, 1.6, -0.72, 0]]) add(new THREE.BoxGeometry(w, 0.1, d), m('planksDark'), x, y, z);
      add(new THREE.BoxGeometry(2, 0.15, 2), m('planks'), 0, 3.2, 0);
      for (const [w, d, x, z] of [[2, 0.1, 0, 0.95], [2, 0.1, 0, -0.95], [0.1, 2, 0.95, 0], [0.1, 2, -0.95, 0]]) add(new THREE.BoxGeometry(w, 0.6, d), m('planks'), x, 3.55, z);
      for (const [px, pz] of [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]]) add(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), m('log'), px, 4.0, pz);
      const roof = add(new THREE.ConeGeometry(1.6, 0.9, 4), m('shingles'), 0, 5.2, 0);
      roof.rotation.y = Math.PI / 4;
      const bow = new THREE.Group();
      bow.position.set(0, 3.75, 0);
      g.add(bow);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.0), m('log'));
      const arms = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.08), m('iron'));
      arms.position.z = 0.4;
      bow.add(stock, arms);
      g.userData.aim = bow;
    } else if (type === 'frost') {
      // Tour de givre : pilier de pierre, cristal de glace et anneaux de runes
      add(new THREE.CylinderGeometry(0.85, 1.0, 0.5 + Math.max(0, drop), 8), m('stoneWall'), 0, (0.5 - Math.max(0, drop)) / 2, 0);
      add(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 8), m('stoneWall'), 0, 1.8, 0);
      add(new THREE.CylinderGeometry(0.75, 0.55, 0.3, 8), m('stoneWall'), 0, 3.2, 0);
      const crystal = add(new THREE.OctahedronGeometry(0.42, 0), m('ice'), 0, 3.95, 0);
      crystal.scale.set(1, 1.7, 1);
      const rings = new THREE.Group();
      rings.position.y = 3.95;
      for (let i = 0; i < 2; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75 + i * 0.2, 0.035, 6, 32), m('rune'));
        ring.rotation.x = Math.PI / 2 + (i ? 0.5 : -0.4);
        rings.add(ring);
      }
      g.add(rings);
      g.userData.spin = rings;
      g.userData.crystal = crystal;
    } else if (type === 'spikes') {
      add(new THREE.BoxGeometry(1.9, 0.1, 1.9), m('planksDark'), 0, 0.03, 0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const stake = new THREE.ConeGeometry(0.07, 0.65, 5);
        const st = add(stake, m('stake'), -0.7 + i * 0.47 + (j % 2) * 0.12, 0.35, -0.7 + j * 0.47);
        st.rotation.set((j - 1.5) * 0.12, 0, (i - 1.5) * -0.12);
      }
    }
    return g;
  }

  // Pièces en bois (modèles du pack), posées sur la grille
  makeWood(type, drop, matOverride, variant) {
    const g = new THREE.Group();
    const list = WOOD[type];
    const o = prop(list[variant % list.length], 1);
    const kY = WALL_H / 2.05;
    if (type === 'floor') o.position.y = -0.17;
    else if (type === 'stairs') { o.rotation.y = Math.PI; o.scale.set(1, kY, 0.94); }   // le modèle monte vers -z
    else if (type === 'roof') o.scale.set(1.12, 1, 1.0);
    else o.scale.set(1, kY, 1);
    g.add(o);
    const stone = matOverride || this.mats.stone;
    // fondations en pierre quand le terrain descend sous la pièce (rez-de-chaussée seulement)
    if (type === 'floor' && drop > 0.05) {
      const fh = drop + 0.3;
      const f = new THREE.Mesh(new THREE.BoxGeometry(1.9, fh, 1.9), stone);
      f.position.y = -0.17 - fh / 2; f.castShadow = f.receiveShadow = !matOverride;
      g.add(f);
    }
    if ((isWallType(type) || type === 'base') && drop > 0.05) {
      const w = type === 'base' ? 2 : 1.9, d = type === 'base' ? 2 : 0.24;
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, drop + 0.2, d), stone);
      f.position.y = -drop / 2; f.castShadow = !matOverride;
      g.add(f);
    }
    if (type === 'door') {
      // battant qui pivote dans l'ouverture (charnière à gauche)
      const hinge = new THREE.Group();
      hinge.position.set(-0.46, 0, -0.03);
      g.add(hinge);
      const woodMat = matOverride || this.mats.doorLeaf;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.58, 0.07), woodMat);
      leaf.position.set(0.45, 0.8, 0);
      leaf.castShadow = !matOverride;
      hinge.add(leaf);
      for (const y of [0.35, 1.25]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.06, 0.09), matOverride || this.mats.iron);
        band.position.set(0.45, y, 0);
        hinge.add(band);
      }
      g.userData.hinge = hinge;
    }
    g.traverse((m) => {
      if (!m.isMesh) return;
      if (matOverride) { m.material = matOverride; m.castShadow = false; m.receiveShadow = false; }
      else { m.castShadow = true; m.receiveShadow = true; }
    });
    return g;
  }

  clear() {
    for (const b of this.map.values()) this.scene.remove(b.mesh);
    this.map.clear();
    this.bars.clear();
    for (const a of this.arrows || []) this.scene.remove(a.arrow);
    for (const r of this.rings || []) this.scene.remove(r.ring);
    this.arrows = []; this.rings = [];
    this.version++;
  }

  add(b, quiet) {
    if (this.map.has(b.id)) return;
    const drop = b.lv ? 0 : this.dropFor(b);
    const mesh = this.makeMesh(b.type, drop, null, variantOf(b.id));
    mesh.position.set(b.x, b.y, b.z);
    this.conform(mesh, b.x, b.y, b.z);
    mesh.rotation.y = this.rotY(b);
    this.scene.add(mesh);
    const box = isWallType(b.type) ? wallBox(b) : PIECES[b.type].tower ? { x: b.x, z: b.z, hx: 0.85, hz: 0.85 } : { x: b.x, z: b.z, hx: 1, hz: 1 };
    if (b.type === 'stonewall') { if (b.rot) box.hx = 0.24; else box.hz = 0.24; }
    const e = { ...b, mesh, drop, anim: b.state === 'done' ? 9 : 0, shake: 9, box, dur: b.dur || BUILD_TIME, open: 0 };
    this.map.set(b.id, e);
    if (b.state !== 'done') this.setBlueprint(e, true);
    if (e.hp < e.max) this.drawBar(e);
    if (!quiet) {
      this.audio?.play('buildPlace', mesh.position);
      this.dust(e, 3, 0.3);
    }
    this.version++;
  }

  rotY(b) {
    if (isWallType(b.type)) return b.rot ? Math.PI / 2 : 0;
    if (b.type === 'stairs') return [0, Math.PI / 2, Math.PI, -Math.PI / 2][b.rot & 3];
    return 0;
  }

  setBlueprint(e, on) {
    e.mesh.traverse((o) => {
      if (!o.isMesh) return;
      if (on) { o.userData.mat = o.material; o.material = this.blueprint; }
      else if (o.userData.mat) o.material = o.userData.mat;
    });
  }

  done(id) {
    const e = this.map.get(id);
    if (!e) return;
    e.state = 'done';
    e.anim = 9;
    e.mesh.scale.set(1, 1, 1);
    this.setBlueprint(e, false);
    this.dust(e, 4, 0.3);
    this.audio?.play('buildDone', e.mesh.position);
  }

  setHp(id, hp) {
    const e = this.map.get(id);
    if (!e) return;
    e.hp = hp;
    this.drawBar(e);
  }

  barHeight(e) {
    return { floor: 0.7, path: 0.6, base: 2.5, wall: 2.5, window: 2.5, door: 2.5, stonewall: 2.7, roof: 1.6, stairs: 2.5, spikes: 1.0, tower: 5.9, frost: 4.9 }[e.type] || 2;
  }
  drawBar(e) {
    let bar = this.bars.get(e.id);
    const frac = Math.max(0, e.hp / e.max);
    if (frac >= 0.999) { if (bar) { e.mesh.remove(bar.sprite); this.bars.delete(e.id); } return; }
    if (!bar) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 18;
      const tex = new THREE.CanvasTexture(c);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.scale.set(1.5, 0.21, 1);
      sprite.renderOrder = 9;
      sprite.position.y = this.barHeight(e);
      e.mesh.add(sprite);
      bar = { c, tex, sprite };
      this.bars.set(e.id, bar);
    }
    const ctx = bar.c.getContext('2d');
    ctx.clearRect(0, 0, 128, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, 128, 18);
    ctx.fillStyle = frac > 0.5 ? '#e0b050' : frac > 0.25 ? '#e08a30' : '#e04030';
    ctx.fillRect(2, 2, 124 * frac, 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(1, 1, 126, 16);
    bar.tex.needsUpdate = true;
  }

  // Tir d'une tour d'archer vers un monstre
  shoot(id, target) {
    const e = this.map.get(id);
    if (!e) return;
    const from = new THREE.Vector3(e.x, e.y + 3.8, e.z);
    const aim = e.mesh.userData.aim;
    if (aim) aim.rotation.y = Math.atan2(target.x - e.x, target.z - e.z) - e.mesh.rotation.y;
    if (!this.arrowGeo) {
      this.arrowGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5).rotateX(Math.PI / 2);
      this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xf0e0c0 });
    }
    const arrow = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    arrow.position.copy(from);
    arrow.lookAt(target);
    this.scene.add(arrow);
    (this.arrows ||= []).push({ arrow, from, to: target.clone(), t: 0, dur: Math.max(0.08, from.distanceTo(target) / 45) });
    this.audio?.play('bow', from);
  }

  // Onde de givre
  pulse(id) {
    const e = this.map.get(id);
    if (!e) return;
    if (!this.ringGeo) {
      this.ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
    }
    const mat = new THREE.MeshBasicMaterial({ color: 0x8ad8ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(this.ringGeo, mat);
    ring.position.set(e.x, heightAt(e.x, e.z) + 0.15, e.z);
    this.scene.add(ring);
    (this.rings ||= []).push({ ring, t: 0 });
    this.audio?.play('frost', ring.position);
  }

  hit(id, hp) {
    const e = this.map.get(id);
    if (!e) return;
    e.hp = hp;
    this.drawBar(e);
    e.shake = 0;
    this.chips(e, 6);
    this.audio?.play('woodHit', e.mesh.position);
  }

  remove(id, broken) {
    const e = this.map.get(id);
    if (!e) return;
    this.scene.remove(e.mesh);
    this.map.delete(id);
    this.bars.delete(id);
    if (broken) {
      this.chips(e, 22);
      this.dust(e, 10);
      this.audio?.play('buildBreak', e.mesh.position);
    }
    this.version++;
  }

  dust(e, n, size = 0.4) {
    const p = e.mesh.position;
    for (let i = 0; i < n; i++) this.fx.puff(new THREE.Vector3(p.x + (Math.random() - 0.5) * 2, p.y + (isWallType(e.type) ? Math.random() * 1.5 : 0.1), p.z + (Math.random() - 0.5) * 2), 0xcdbfa6, 1, size);
  }
  chips(e, n) {
    const p = e.mesh.position;
    for (let i = 0; i < n; i++) {
      this.fx.spawn({
        geo: this.fx.box, mat: i % 3 ? this.fx.mats.wood : this.fx.mats.bark,
        pos: new THREE.Vector3(p.x + (Math.random() - 0.5) * 1.6, p.y + (isWallType(e.type) ? 0.3 + Math.random() * 2 : 0.2), p.z + (Math.random() - 0.5) * 1.6),
        vel: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5),
        size: 0.06 + Math.random() * 0.1, life: 1.6, gravity: 15,
      });
    }
  }

  // Profondeur à combler sous la pièce jusqu'au terrain
  dropFor(b) {
    let minH = Infinity;
    const pts = isWallType(b.type)
      ? (b.rot ? [[0, -1], [0, 0], [0, 1]] : [[-1, 0], [0, 0], [1, 0]])
      : [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]];
    for (const [dx, dz] of pts) minH = Math.min(minH, heightAt(b.x + dx, b.z + dz));
    return b.y - minH;
  }

  floors() { return [...this.map.values()].filter((b) => b.type === 'floor' || b.type === 'path'); }

  // la dalle suit les bosses du terrain
  conform(group, x, y, z) {
    const mesh = group.userData.conform;
    if (!mesh) return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(x + p.getX(i), z + p.getZ(i)) - y + 0.05);
    p.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  // le joueur marche-t-il sur une dalle de chemin ?
  onPath(x, z, feetY) {
    const cx = Math.round(x / GRID) * GRID, cz = Math.round(z / GRID) * GRID;
    for (const b of this.map.values()) {
      if (b.type === 'path' && b.state === 'done' && Math.abs(b.x - cx) < 0.1 && Math.abs(b.z - cz) < 0.1 && feetY < heightAt(x, z) + 0.6) return true;
    }
    return false;
  }

  // ----- Collisions -----
  // Hauteur du sol sous les pieds (terrain ou plancher / toit sur lequel on peut monter)
  groundAt(x, z, feetY, terrainY) {
    let g = terrainY;
    for (const b of this.map.values()) {
      if (isWallType(b.type) || b.type === 'spikes' || b.type === 'frost') continue;
      if (Math.abs(x - b.x) > 1.05 || Math.abs(z - b.z) > 1.05) continue;
      const top = b.type === 'stairs' ? stairsHeight(b, clamp(x, b.x - 1, b.x + 1), clamp(z, b.z - 1, b.z + 1)) : pieceTop(b);
      if (top <= feetY + 0.55 && top > g) g = top;
    }
    return g;
  }

  // Pousse le joueur hors des murs ; renvoie true s'il a touché
  collide(pos, radius) {
    let hit = false;
    for (const b of this.map.values()) {
      const tower = PIECES[b.type].tower;
      if (b.type !== 'wall' && b.type !== 'stonewall' && b.type !== 'window' && !tower) continue; // les portes laissent passer les joueurs
      if (tower && pos.y > b.y + 3.0) continue;
      if (!tower && pos.y > b.y + WALL_H - 0.45 || pos.y + 1.7 < b.y - b.drop - 0.2) continue;
      const box = b.box;
      const dx = pos.x - box.x, dz = pos.z - box.z;
      const px = box.hx + radius - Math.abs(dx), pz = box.hz + radius - Math.abs(dz);
      if (px > 0 && pz > 0) {
        if (px < pz) pos.x += Math.sign(dx || 1) * px; else pos.z += Math.sign(dz || 1) * pz;
        hit = true;
      }
    }
    // Plafond : on ne traverse pas un toit en sautant
    return hit;
  }

  // ----- Placement -----
  // aim : point visé au sol ; renvoie une proposition { type, x, z, rot, y, ok, reason }
  // Hauteurs possibles pour une pièce à cet endroit : le sol, puis tout ce qui peut la porter
  // (dessus d'une charpente ou d'un mur, plancher voisin, plancher sous un escalier…)
  levelsFor(type, x, z, rot) {
    if (type === 'path') return [{ y: Math.max(...[[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([a, c]) => heightAt(x + a, z + c))), lv: 0 }];
    const near = (b, d = 1.15) => Math.abs(b.x - x) <= d && Math.abs(b.z - z) <= d;
    const same = (b) => Math.abs(b.x - x) < 0.1 && Math.abs(b.z - z) < 0.1;
    const out = [];
    let ground;
    if (isWallType(type)) {
      const pts = rot ? [[0, -0.9], [0, 0], [0, 0.9]] : [[-0.9, 0], [0, 0], [0.9, 0]];
      ground = Math.max(...pts.map(([a, c]) => heightAt(x + a, z + c))) + 0.02;
      for (const b of this.map.values()) {
        if (b.type === 'floor' && near(b, 1.05) && (rot ? Math.abs(b.z - z) < 0.1 : Math.abs(b.x - x) < 0.1)) out.push(b.y);
        if (b.type === 'base' && near(b, 1.05) && (rot ? Math.abs(b.z - z) < 0.1 : Math.abs(b.x - x) < 0.1)) out.push(b.y + WALL_H);
        if (isWallType(b.type) && same(b) && (b.rot & 1) === (rot & 1)) out.push(b.y + WALL_H);
      }
    } else {
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([a, c]) => heightAt(x + a, z + c));
      ground = Math.max(...corners) + (type === 'floor' ? 0.15 : type === 'spikes' ? 0.02 : type === 'roof' ? WALL_H : 0.05);
      for (const b of this.map.values()) {
        if (type === 'roof') {
          if (isWallType(b.type) && near(b, 1.05) && !same(b)) out.push(b.y + WALL_H);
          if ((b.type === 'base') && same(b)) out.push(b.y + WALL_H);
          if (b.type === 'floor' && same(b)) out.push(b.y + WALL_H);
          continue;
        }
        if (b.type === 'base' && same(b)) out.push(b.y + WALL_H);
        if (isWallType(b.type) && near(b, 1.05) && !same(b)) out.push(b.y + WALL_H);
        if (type === 'floor' && b.type === 'floor' && b.lv && Math.abs(b.x - x) + Math.abs(b.z - z) < 2.1 && !same(b)) out.push(b.y);
        if (type !== 'floor' && b.type === 'floor' && same(b)) out.push(b.y);
      }
    }
    // grille : au rez-de-chaussée, une pièce se cale à la hauteur de ses voisines
    // (planchers, charpentes et murs restent alignés même sur un terrain en pente)
    ground = this.alignGround(type, x, z, rot, ground);
    const levels = [{ y: ground, lv: 0 }];
    for (const y of out) {
      const lv = Math.max(1, Math.round((y - ground) / WALL_H));
      if (y > ground + 0.5 && lv <= MAX_LEVEL && !levels.some((l) => Math.abs(l.y - y) < 0.2)) levels.push({ y, lv });
      // un objet posé sur un plancher du rez-de-chaussée reste au niveau 0
      if (y <= ground + 0.5 && y > ground - 1 && type !== 'floor') levels[0] = { y: Math.max(levels[0].y, y), lv: 0 };
    }
    return levels.sort((a, b) => a.y - b.y);
  }

  alignGround(type, x, z, rot, ground) {
    let best = null;
    const wallT = isWallType(type);
    for (const b of this.map.values()) {
      if (b.lv) continue;
      const dx = Math.abs(b.x - x), dz = Math.abs(b.z - z);
      if (dx < 0.1 && dz < 0.1) continue;
      let ok = false;
      if (type === 'floor' || type === 'base') ok = b.type === type && dx + dz < 2.1;
      else if (wallT) ok = isWallType(b.type) && dx + dz < 2.1 && (dx > 0.1 || dz > 0.1);
      if (!ok) continue;
      // pas plus de 45 cm enfoncé dans le sol, ni de 1 m au-dessus
      if (b.y < ground - 0.45 || b.y > ground + 1.0) continue;
      if (!best || Math.abs(b.y - ground) < Math.abs(best - ground)) best = b.y;
    }
    return best ?? ground;
  }

  // Grille de construction autour du point visé (lignes posées sur le terrain, qui s'estompent)
  showGrid(cx, cz, on) {
    if (!on) { if (this.grid) this.grid.visible = false; return; }
    if (!this.grid) {
      this.grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.grid.renderOrder = 4;
      this.grid.frustumCulled = false;
      this.scene.add(this.grid);
    }
    this.grid.visible = true;
    if (this.grid.userData.cx === cx && this.grid.userData.cz === cz) return;
    this.grid.userData.cx = cx; this.grid.userData.cz = cz;
    const N = 5, R = N * GRID, pos = [], col = [];
    const fade = (x, z) => { const d = Math.hypot(x - cx, z - cz) / R; return Math.max(0, 1 - d * d) * 0.55; };
    const add = (x, z) => { pos.push(x, this.groundAt(x, z, 99, heightAt(x, z)) + 0.06, z); const f = fade(x, z); col.push(f, f * 0.95, f * 0.8); };
    // bords des cases : x = cx ± 1, ± 3… (les cases sont centrées sur la grille de 2 m)
    for (let i = -N; i <= N; i++) {
      const e = cx + i * GRID + GRID / 2;
      for (let t = -R; t < R; t += 0.5) { add(e, cz + t); add(e, cz + t + 0.5); }
      const f = cz + i * GRID + GRID / 2;
      for (let t = -R; t < R; t += 0.5) { add(cx + t, f); add(cx + t + 0.5, f); }
    }
    const g = this.grid.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
  }

  // aim : point visé ; refY : hauteur de référence (les pieds du joueur) ; lift : étages en plus (molette)
  plan(type, aim, player, resources, inv, free, mods, camYaw = 0, lift = 0) {
    const cx = Math.round(aim.x / GRID) * GRID, cz = Math.round(aim.z / GRID) * GRID;
    let x = cx, z = cz, rot = 0;
    if (isWallType(type)) {
      const dx = aim.x - cx, dz = aim.z - cz;
      if (Math.abs(dx) > Math.abs(dz)) { x = cx + Math.sign(dx || 1) * GRID / 2; rot = 1; }
      else { z = cz + Math.sign(dz || 1) * GRID / 2; rot = 0; }
    } else if (type === 'stairs' || type === 'spikes' || PIECES[type].tower) {
      // l'escalier monte dans la direction où regarde la caméra
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      rot = Math.abs(fz) > Math.abs(fx) ? (fz > 0 ? 0 : 2) : (fx > 0 ? 1 : 3);
    }
    const levels = this.levelsFor(type, x, z, rot);
    // étage choisi : le plus proche de « pieds du joueur + molette »
    const refY = Math.max(player.y ?? 0, aim.hit && aim.y < (player.y ?? 0) + 3 ? aim.y : -Infinity) + lift * WALL_H + (type === 'roof' ? WALL_H : 0);
    let best = levels[0];
    for (const l of levels) if (Math.abs(l.y - refY) < Math.abs(best.y - refY) - 0.01) best = l;
    const plan = { type, x, z, rot, y: +best.y.toFixed(2), lv: best.lv, levels: levels.length, ok: true, reason: '' };
    const key = slotKey(type, x, z, rot, plan.y);
    for (const b of this.map.values()) if (slotKey(b.type, b.x, b.z, b.rot, b.y) === key) { plan.ok = false; plan.reason = 'Emplacement occupé'; }
    if (plan.ok && Math.hypot(x - player.x, z - player.z) > BUILD_RANGE + 1) { plan.ok = false; plan.reason = 'Trop loin'; }
    if (plan.ok && type !== 'roof' && !plan.lv) {
      const box = isWallType(type) ? wallBox(plan) : { x, z, hx: 1, hz: 1 };
      for (const r of resources) {
        if (!r.alive) continue;
        if (distToBox(r.x, r.z, box) < r.r * 0.9) { plan.ok = false; plan.reason = r.kind === 'tree' ? 'Un arbre gêne' : r.kind === 'bush' ? 'Un buisson gêne' : 'Un rocher gêne'; break; }
      }
    }
    if (!free && !pieceUnlocked(type, mods)) { plan.ok = false; plan.reason = 'À débloquer auprès du Gardien de maîtrise'; }
    if (plan.ok && !free) {
      const c = pieceCost(type, mods);
      if (!canAfford(inv, c)) { plan.ok = false; plan.reason = 'Pas assez de matériaux'; }
    }
    return plan;
  }

  showGhost(plan) {
    if (!plan) { if (this.ghost) this.ghost.visible = false; return; }
    const drop = plan.lv ? 0 : this.dropFor(plan);
    const key = plan.type + ':' + plan.ok + ':' + drop.toFixed(1);
    if (key !== this.ghostKey) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = this.makeMesh(plan.type, drop, plan.ok ? this.ghostOk : this.ghostBad, 0);
      this.ghost.renderOrder = 5;
      this.scene.add(this.ghost);
      this.ghostKey = key;
    }
    this.ghost.visible = true;
    this.ghost.position.set(plan.x, plan.y, plan.z);
    if (plan.type === 'path' && (this.ghost.userData.cx !== plan.x || this.ghost.userData.cz !== plan.z)) {
      this.conform(this.ghost, plan.x, plan.y, plan.z);
      this.ghost.userData.cx = plan.x; this.ghost.userData.cz = plan.z;
    }
    this.ghost.rotation.y = this.rotY(plan);
  }

  // Pièce visée (pour démolir)
  pick(aim) {
    let best = null, bd = 1.3;
    for (const b of this.map.values()) {
      const mid = b.y + (isWallType(b.type) || b.type === 'base' || b.type === 'stairs' ? WALL_H / 2 : 0);
      const d = distToBox(aim.x, aim.z, b.box) + (b.type === 'roof' ? 0.3 : 0) + Math.max(0, Math.abs((aim.y ?? mid) - mid) - 1.2) * 0.8;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // players : positions des joueurs (pour ouvrir les portes)
  update(dt, players = []) {
    this.time = (this.time || 0) + dt;
    for (const a of this.arrows || []) {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.arrow.position.lerpVectors(a.from, a.to, k);
      if (k >= 1) { this.scene.remove(a.arrow); a.done = true; this.fx.spawn({ geo: this.fx.box, mat: this.fx.mats.wood, pos: a.to, vel: new THREE.Vector3(0, 2, 0), size: 0.04, life: 0.4, gravity: 10 }); }
    }
    if (this.arrows) this.arrows = this.arrows.filter((a) => !a.done);
    for (const r of this.rings || []) {
      r.t += dt;
      const k = r.t / 0.9;
      r.ring.scale.setScalar(1 + k * 7);
      r.ring.material.opacity = 0.6 * (1 - k);
      if (k >= 1) { this.scene.remove(r.ring); r.ring.material.dispose(); r.done = true; }
    }
    if (this.rings) this.rings = this.rings.filter((r) => !r.done);
    for (const e of this.map.values()) {
      const sp = e.mesh.userData.spin;
      if (sp) { sp.rotation.y = this.time * 1.5; e.mesh.userData.crystal.position.y = 3.95 + Math.sin(this.time * 2) * 0.1; }
      if (e.type === 'door') {
        const near = players.some((p) => Math.abs(p.x - e.x) < 1.7 && Math.abs(p.z - e.z) < 1.7 && Math.abs(p.y - e.y) < 2);
        e.open += ((near ? 1 : 0) - e.open) * Math.min(1, dt * 6);
        const h = e.mesh.userData.hinge;
        if (h) h.rotation.y = -e.open * 1.45;
        if (near !== e.wasOpen) { e.wasOpen = near; if (e.state === 'done') this.audio?.play('door', e.mesh.position); }
      }
      if (e.state !== 'done') {
        e.anim += dt;
        const k = clamp(e.anim / e.dur, 0, 1);
        e.mesh.scale.set(1, 0.15 + 0.85 * k, 1);
        this.blueprint.opacity = 0.35 + Math.sin(e.anim * 8) * 0.1;
        // Bruit de marteau pendant la construction
        if (Math.floor((e.anim - dt) / 0.45) !== Math.floor(e.anim / 0.45) && e.anim < e.dur) this.audio?.play('hammerTap', e.mesh.position);
      }
      if (e.shake < 0.4) {
        e.shake += dt;
        const a = Math.sin(e.shake * 60) * (0.4 - e.shake) * 0.08;
        e.mesh.position.x = e.x + a; e.mesh.position.z = e.z + a * 0.5;
      }
    }
  }
}
