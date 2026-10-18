// Décor du village avec les packs KayKit (Dungeon, RPG Tools, Adventurers) :
// remparts en pierre, bannières, coffres, tonneaux, étals du marché, atelier du forgeron…
// et le forgeron lui-même (PNJ) avec sa bulle de discussion.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { prop, skinnedModel, staticGeometry, modelMaterial, KK } from './models.js';
import { getClip } from './character.js';

const rnd = (() => { let s = 1337; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();

// Fusionne tous les objets fixes par matériau (quelques appels de dessin au lieu de centaines)
// attributs compressés (modèles quantifiés) -> flottants, sinon la fusion les écrase
function toFloat(attr) {
  if (attr.array instanceof Float32Array && !attr.isInterleavedBufferAttribute) return attr;
  const n = attr.count, sz = attr.itemSize, out = new Float32Array(n * sz);
  for (let i = 0; i < n; i++) for (let k = 0; k < sz; k++) out[i * sz + k] = attr.getComponent ? attr.getComponent(i, k) : [attr.getX(i), attr.getY(i), attr.getZ(i), attr.getW?.(i)][k];
  return new THREE.BufferAttribute(out, sz);
}
export function bake(root, group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.userData.keep) return;
    let g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); else g.setAttribute(k, toFloat(g.attributes[k]));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  for (const [mat, geos] of byMat) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  }
}

export function decorateVillage(v, SPOTS, villageHeight) {
  const tmp = new THREE.Group();     // tout ce qui sera fusionné
  v.root.add(tmp);
  // bannières visibles des deux côtés (elles n'avaient qu'une face)
  const bannerMat = modelMaterial('d_banner_red').clone();
  bannerMat.side = THREE.DoubleSide;
  const put = (name, x, z, ry = 0, s = 1, y = null, parent = tmp) => {
    const o = prop(name, KK * s);
    if (name.startsWith('d_banner')) o.traverse((m) => { if (m.isMesh) m.material = bannerMat; });
    o.position.set(x, y ?? villageHeight(x, z), z);
    o.rotation.y = ry;
    parent.add(o);
    return o;
  };
  const coll = (x, z, r) => v.colliders.push({ x, z, r });
  // accroche une bannière sous une traverse d'après sa boîte englobante : centrée sur (sx,sz),
  // collée contre la face de normale (nx,nz), haut à topY
  const hang = (name, s, ry, sx, sz, nx, nz, topY) => {
    const o = put(name, 0, 0, ry, s, 0);
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const off = (Math.abs(nx) * size.x + Math.abs(nz) * size.z) / 2;
    o.position.set(sx + nx * off - c.x, topY - b.max.y, sz + nz * off - c.z);
  };

  // ---------------- Remparts de pierre ----------------
  const WALL_R = 34, segW = 4 * KK;
  const n = Math.ceil(2 * Math.PI * WALL_R / segW);
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * Math.PI * 2;
    const x = Math.cos(a) * WALL_R, z = Math.sin(a) * WALL_R;
    if (Math.abs(x) < 4.5) continue;                 // portes nord et sud (les chemins)
    const piece = i % 9 === 0 ? 'd_wall_window_open' : i % 13 === 5 ? 'd_wall_shelves' : 'd_wall';
    put(piece, x, z, -a + Math.PI / 2 + Math.PI, 1);
    for (let k = -1; k <= 1; k++) {
      const b = a + k * (segW / WALL_R) * 0.33;
      coll(Math.cos(b) * WALL_R, Math.sin(b) * WALL_R, 0.75);
    }
  }
  // piliers, torches et bannières aux deux portes
  for (const sz of [1, -1]) {
    for (const sx of [-1, 1]) {
      const x = sx * 4.6, z = sz * Math.sqrt(WALL_R * WALL_R - 4.6 * 4.6);
      const pil = put('d_pillar_decorated', x, z, sz > 0 ? Math.PI : 0, 0.9);
      coll(x, z, 1.0);
      const tx = x - sx * 1.1, tz = z - sz * 1.2;
      put('d_torch_lit', tx, tz, 0, 1.4, villageHeight(tx, tz) + 0.4 * KK * 1.4);
      // contre la face du pilier tournée vers la place, sous le haut du pilier
      const pb = new THREE.Box3().setFromObject(pil);
      hang(sx > 0 ? 'd_banner_shield_red' : 'd_banner_shield_blue', 0.8, sz > 0 ? Math.PI : 0, x, sz > 0 ? pb.min.z : pb.max.z, 0, -sz, pb.max.y - 0.4);
    }
  }

  // ---------------- Atelier du forgeron ----------------
  const fg = v.forgeGroup;   // repère de la forge (ouverte vers +z local)
  const fput = (name, x, z, ry = 0, s = 1, y = 0.25) => {
    const o = prop(name, KK * s);
    o.position.set(x, y, z); o.rotation.y = ry;
    fg.add(o);
    return o;
  };
  fput('t_anvil', 1.1, 0.0, Math.PI / 2, 1.15);
  fput('t_grindstone', 2.4, -1.5, 0.3, 0.9);
  fput('d_table_medium', 0.2, -2.15, 0, 0.75);
  const top = 0.25 + 1.0 * KK * 0.75;
  fput('t_saw', -0.1, -2.1, 0.2, 0.9, top + 0.02).rotation.z = Math.PI / 2;
  fput('t_tongs', 0.4, -2.0, 1.2, 0.9, top + 0.05).rotation.z = Math.PI / 2;
  fput('t_file', 0.75, -2.25, 2.0, 0.9, top + 0.04).rotation.z = Math.PI / 2;
  fput('t_mallet', -0.45, -2.3, 0.5, 0.9, top + 0.05).rotation.z = Math.PI / 2;
  fput('t_chisel', 0.05, -2.4, -0.4, 0.9, top + 0.04).rotation.z = Math.PI / 2;
  fput('t_bucket_metal', 2.5, 0.2, 0.4, 0.8);
  fput('d_barrel_small', 2.55, 1.0, 0.8, 0.9);
  fput('t_rope_bundle_A', 2.3, -0.6, 0.6, 0.9, 0.27);
  const ss = fput('d_sword_shield', 1.6, -2.55, 0, 0.9, 1.6);
  void ss;
  fput('t_shovel', -2.65, 1.2, 0.3, 0.9).rotation.z = 0.15;
  fput('d_crates_stacked', 3.9, -1.6, 0.2, 0.75, 0);
  fput('d_box_small', 3.7, 0.0, 0.5, 0.7, 0);
  for (const [lx, lz] of [[3.9, -1.6], [3.7, 0]]) { const w = fg.localToWorld(new THREE.Vector3(lx, 0, lz)); coll(w.x, w.z, 0.8); }
  fg.updateMatrixWorld(true);
  for (const [lx, lz, r] of [[1.1, 0, 0.6], [2.4, -1.5, 0.75], [0.2, -2.15, 0.7], [2.5, 0.6, 0.6]]) { const w = fg.localToWorld(new THREE.Vector3(lx, 0, lz)); coll(w.x, w.z, r); }

  // ---------------- Trésor autour du classement ----------------
  const B = SPOTS.board;
  put('d_chest_gold', B.x + 1.6, B.z + 2.6, -2.4, 0.75); coll(B.x + 1.6, B.z + 2.6, 0.7);
  put('d_chest', B.x + 1.6, B.z - 2.6, -0.7, 0.75); coll(B.x + 1.6, B.z - 2.6, 0.7);
  put('d_coin_stack_large', B.x + 0.6, B.z + 2.9, 0.4, 0.7);
  put('d_coin_stack_medium', B.x + 2.6, B.z + 1.8, 1.2, 0.7);
  put('d_coin_stack_medium', B.x + 0.8, B.z - 2.9, 2.2, 0.6);
  // mâts à bannières de part et d'autre du panneau
  for (const sz of [-1, 1]) {
    const x = B.x - 0.4, z = B.z + sz * 2.4;
    v.add(tmp, new THREE.CylinderGeometry(0.06, 0.08, 3.6, 8), v.M.log, x, 1.8, z);
    v.add(tmp, new THREE.BoxGeometry(0.1, 0.1, 1.4), v.M.log, x + 0.13, 3.55, z);
    hang(sz > 0 ? 'd_banner_patternA_yellow' : 'd_banner_patternA_red', 0.75, -Math.PI / 2, x + 0.18, z, 1, 0, 3.5);   // sous la traverse (bas à 3,5)
    coll(x, z, 0.25);
  }

  // ---------------- Bannières autour de la place ----------------
  const cols = ['d_banner_blue', 'd_banner_red', 'd_banner_patternA_blue', 'd_banner_patternA_red', 'd_banner_thin_blue', 'd_banner_triple_red'];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + Math.PI / 6 + 0.25;
    const r = 13.2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 3) continue;
    v.add(tmp, new THREE.CylinderGeometry(0.07, 0.09, 4.2, 8), v.M.log, x, 2.1, z);
    // traverse accrochée contre le mât, côté place, et la bannière juste dessous
    v.add(tmp, new THREE.BoxGeometry(0.1, 0.1, 1.3), v.M.log, x - Math.cos(a) * 0.14, 4.1, z - Math.sin(a) * 0.14).rotation.y = -a;
    hang(cols[i], 0.7, -a - Math.PI / 2, x - Math.cos(a) * 0.2, z - Math.sin(a) * 0.2, -Math.cos(a), -Math.sin(a), 4.05);   // sous la traverse (bas à 4,05)
    coll(x, z, 0.25);
  }

  // ---------------- Devant les maisons ----------------
  const clusters = [
    [['d_barrel_large', 0.7], ['d_barrel_small', 0.8], ['d_box_small', 0.7]],
    [['d_crates_stacked', 0.6], ['d_barrel_small_stack', 0.7]],
    [['d_keg', 0.6], ['d_stool', 0.8], ['d_bottle_A_green', 0.8]],
    [['d_box_large', 0.6], ['d_box_small_decorated', 0.6], ['t_lantern', 0.8]],
    [['d_trunk_large_A', 0.8], ['d_barrel_small', 0.8]],
    [['d_keg_decorated', 0.5], ['d_box_small', 0.7]],
    [['d_barrel_large', 0.7], ['d_crates_stacked', 0.55]],
    [['d_table_small_decorated_A', 0.8], ['d_chair', 0.8], ['d_chair', 0.8]],
  ];
  v.houseSpots.forEach(([hx, hz, w, d, ry], i) => {
    const cl = clusters[i % clusters.length];
    const side = i % 2 ? 1 : -1;
    cl.forEach(([name, s], k) => {
      const lx = side * (w / 2 + 0.9 + k * 0.15), lz = d / 2 + 0.2 - k * 1.25;
      const c = Math.cos(ry), sn = Math.sin(ry);
      const x = hx + lx * c + lz * sn, z = hz - lx * sn + lz * c;
      put(name, x, z, ry + rnd() * 1.2 - 0.6, s);
      coll(x, z, 0.55 * s + 0.15);
    });
  });

  // ---------------- Étals du marché ----------------
  const stalls = [
    [0.75, ['d_table_long_tablecloth_decorated_A', 'd_barrel_small', 'a_mug_full']],
    [2.35, ['d_table_medium_tablecloth_decorated_B', 'd_crates_stacked', 'd_bottle_A_labeled_brown']],
    [-0.75, ['d_table_medium_decorated_A', 'd_keg', 'd_box_small']],
    [-2.35, ['d_table_long_decorated_A', 'd_barrel_large', 'd_candle_triple']],
  ];
  for (const [ang, [table, a, b]] of stalls) {
    const r = 16, x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    const ry = -ang + Math.PI / 2;
    put(table, x, z, ry, 0.6);
    coll(x, z, 1.1);
    const ox = Math.cos(ang + 0.16) * (r + 0.2), oz = Math.sin(ang + 0.16) * (r + 0.2);
    put(a, ox + Math.cos(ang) * 1.3, oz + Math.sin(ang) * 1.3, ry, 0.6);
    coll(ox + Math.cos(ang) * 1.3, oz + Math.sin(ang) * 1.3, 0.6);
    if (b.startsWith('a_') || b.includes('bottle') || b.includes('candle')) put(b, x, z, ry, 0.9, villageHeight(x, z) + 1.0 * KK * 0.6);
    else { const px = Math.cos(ang - 0.16) * (r + 0.4) + Math.cos(ang) * 1.2, pz = Math.sin(ang - 0.16) * (r + 0.4) + Math.sin(ang) * 1.2; put(b, px, pz, ry, 0.6); coll(px, pz, 0.5); }
  }

  bake(v.root, tmp);
  v.root.remove(tmp);
}

// ---------------- Le forgeron (PNJ) ----------------
const LINES = [
  'Pense à améliorer tes compétences à la forge !',
  'Les éclats ◆ gagnés chaque nuit servent à acheter des compétences.',
  'Bâtisseur, récolteur ou combattant : choisis ta voie !',
  'Une bonne lame et de bons murs… voilà comment on survit.',
  'Approche-toi de l’enclume pour voir l’arbre des compétences.',
];
function bubbleSprite() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(3.2, 1.0, 1);
  s.renderOrder = 11;
  s.userData = { c, tex };
  return s;
}
function drawBubble(s, text) {
  const { c, tex } = s.userData;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 160);
  // bulle arrondie avec une pointe
  ctx.fillStyle = 'rgba(255,250,238,0.96)'; ctx.strokeStyle = '#4a3a24'; ctx.lineWidth = 5;
  const r = 26, x = 8, y = 8, w = 496, h = 116;
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.lineTo(276, y + h); ctx.lineTo(256, 152); ctx.lineTo(236, y + h);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2b2216'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px system-ui, sans-serif';
  // retour à la ligne
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (ctx.measureText(t).width > 460) { lines.push(cur); cur = wd; } else cur = t; }
  lines.push(cur);
  lines.slice(0, 3).forEach((l, i, a) => ctx.fillText(l, 256, 66 + (i - (a.length - 1) / 2) * 36));
  tex.needsUpdate = true;
}

export class Blacksmith {
  constructor(v, localPos, faceAngle) {
    const { scene, animations } = skinnedModel('Ranger');
    this.model = scene;
    scene.scale.setScalar(KK);
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    this.root = new THREE.Group();
    this.root.add(scene);
    v.forgeGroup.add(this.root);
    this.root.position.copy(localPos);
    this.baseYaw = faceAngle;
    this.root.rotation.y = faceAngle;
    // un marteau en main
    const hand = scene.getObjectByName('handslotr');
    const hm = new THREE.Mesh(staticGeometry('t_hammer'), modelMaterial('t_hammer'));
    hm.castShadow = true;
    hand?.add(hm);
    this.mixer = new THREE.AnimationMixer(scene);
    // il martèle l'enclume ; quand un aventurier approche, il le salue puis lui parle
    this.idle = this.mixer.clipAction(getClip(animations, 'Idle_A')); this.idle.play(); this.idle.weight = 0;
    this.work = this.mixer.clipAction(getClip(animations, 'Hammering')); this.work.play(); this.work.weight = 1;
    this.wave = this.mixer.clipAction(getClip(animations, 'Waving')); this.wave.setLoop(THREE.LoopOnce, 1); this.wave.clampWhenFinished = false;
    this.wave.play(); this.wave.weight = 0; this.wave.paused = true;
    this.waveT = 9; this.near = false; this.talk = 0;
    // bulle de discussion au-dessus de la tête
    this.bubble = bubbleSprite();
    this.bubble.position.set(0, 2.45, 0);
    this.root.add(this.bubble);
    this.line = 0; this.lineT = 0;
    drawBubble(this.bubble, LINES[0]);
    const w = new THREE.Vector3(); this.root.getWorldPosition(w);
    v.colliders.push({ x: w.x, z: w.z, r: 0.5 });
    this.world = w;
  }

  update(dt, focus) {
    this.mixer.update(dt);
    // il se tourne vers le joueur quand on approche
    const d = focus ? Math.hypot(focus.x - this.world.x, focus.z - this.world.z) : 99;
    let want = this.baseYaw;
    if (d < 7) {
      const parentYaw = this.root.parent.rotation.y;
      want = Math.atan2(focus.x - this.world.x, focus.z - this.world.z) - parentYaw;
    }
    const diff = Math.atan2(Math.sin(want - this.root.rotation.y), Math.cos(want - this.root.rotation.y));
    this.root.rotation.y += diff * Math.min(1, dt * 3);
    // travail à l'enclume / salut / discussion
    const near = d < 7;
    if (near && !this.near) { this.wave.reset(); this.wave.paused = false; this.wave.play(); this.waveT = 0; }
    this.near = near;
    this.talk += ((near ? 1 : 0) - this.talk) * Math.min(1, dt * 3);
    this.waveT += dt;
    const wd = this.wave.getClip().duration;
    const wv = this.waveT < wd ? Math.sin(Math.min(1, this.waveT / wd) * Math.PI) : 0;
    this.wave.weight = wv * 3;
    this.work.weight = 1 - this.talk;
    this.idle.weight = this.talk;
    // la bulle change de phrase et n'apparaît que si on est assez près
    this.lineT += dt;
    if (this.lineT > 6) { this.lineT = 0; this.line = (this.line + 1) % LINES.length; drawBubble(this.bubble, LINES[this.line]); }
    const vis = d < 16 ? 1 : 0;
    const m = this.bubble.material;
    m.opacity += (vis - m.opacity) * Math.min(1, dt * 4);
    this.bubble.visible = m.opacity > 0.02;
    this.bubble.position.y = 2.45 + Math.sin(this.lineT * 2) * 0.03;
  }
}
