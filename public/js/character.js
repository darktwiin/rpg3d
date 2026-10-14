// Personnage articulé : corps aux formes sculptées (tours "lathe"), visage, cheveux,
// cape, outils (épée, hache, pioche, marteau) et toutes les animations calculées en direct.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const TOOLS = ['sword', 'axe', 'pick', 'hammer'];

// Attaques : images-clés (p = progression 0..1). Les valeurs absentes gardent la pose normale.
export const ATTACKS = {
  slash: {
    dur: 0.5, hit: 0.46, tool: 'sword', frames: [
      [0.0, { rShX: -1.0, rShY: -0.6, rShZ: -0.3, rEl: -1.2, rWr: 0.3, spineRy: -0.3, chestRy: -0.2 }],
      [0.36, { rShX: -2.5, rShY: -0.9, rShZ: -0.2, rEl: -1.3, rWr: -0.2, spineRy: -0.6, chestRy: -0.3, spineRx: -0.05 }],
      [0.5, { rShX: -0.6, rShY: 0.9, rShZ: -0.2, rEl: -0.15, rWr: 1.0, spineRy: 0.5, chestRy: 0.3, spineRx: 0.2 }],
      [1.0, { rShX: -0.5, rShY: 0.6, rShZ: -0.15, rEl: -0.4, rWr: 1.1, spineRy: 0.3, chestRy: 0.1, spineRx: 0.1 }],
    ],
  },
  chop: { // coupe de bois : grand coup horizontal à la hache
    dur: 0.62, hit: 0.5, tool: 'axe', frames: [
      [0.0, { rShX: -1.2, rShY: -0.6, rShZ: -0.2, rEl: -0.9, rWr: 1.0, spineRy: -0.3, lShX: -0.4, lEl: -0.6 }],
      [0.38, { rShX: -1.45, rShY: -1.5, rShZ: -0.1, rEl: -0.7, rWr: 1.2, spineRy: -0.85, chestRy: -0.35, hipsRy: -0.2, lShX: -0.9, lShY: 0.6, lEl: -0.5, lThX: -0.25, rThX: 0.2, lKn: 0.25, rKn: 0.25 }],
      [0.52, { rShX: -1.45, rShY: 0.5, rShZ: -0.1, rEl: -0.1, rWr: 1.45, spineRy: 0.55, chestRy: 0.25, hipsRy: 0.15, lShX: -0.3, lShY: 0.0, lEl: -0.7, lThX: -0.25, rThX: 0.2, lKn: 0.3, rKn: 0.3 }],
      [1.0, { rShX: -1.0, rShY: 0.4, rShZ: -0.15, rEl: -0.4, rWr: 1.2, spineRy: 0.25, lShX: -0.2, lEl: -0.5 }],
    ],
  },
  mine: { // casse-pierre : frappe à deux mains au-dessus de la tête, à la pioche
    dur: 0.7, hit: 0.53, tool: 'pick', frames: [
      [0.0, { rShX: -1.6, rShY: 0.5, rEl: -1.0, rWr: 0.6, lShX: -1.5, lShY: -0.5, lEl: -1.0 }],
      [0.4, { rShX: -3.0, rShY: 0.4, rEl: -0.9, rWr: 0.2, lShX: -2.9, lShY: -0.4, lEl: -0.9, spineRx: -0.25, headRx: -0.25, hipsY: 0.95 }],
      [0.55, { rShX: -0.55, rShY: 0.35, rEl: -0.15, rWr: 1.25, lShX: -0.6, lShY: -0.35, lEl: -0.2, spineRx: 0.55, headRx: 0.25, hipsY: 0.82, lThX: -0.45, lKn: 0.75, rThX: 0.15, rKn: 0.55 }],
      [1.0, { rShX: -0.6, rShY: 0.3, rEl: -0.5, rWr: 1.2, lShX: -0.4, lShY: -0.2, lEl: -0.4, spineRx: 0.15, hipsY: 0.9 }],
    ],
  },
  hammer: { // coup de marteau rapide (construction)
    dur: 0.45, hit: 0.55, tool: 'hammer', frames: [
      [0.0, { rShX: -1.2, rShY: 0.1, rEl: -1.2, rWr: 0.8 }],
      [0.4, { rShX: -2.4, rShY: 0.2, rEl: -1.4, rWr: 0.0, spineRx: -0.08, headRx: 0.2 }],
      [0.58, { rShX: -0.9, rShY: 0.1, rEl: -0.5, rWr: 1.2, spineRx: 0.25, headRx: 0.35 }],
      [1.0, { rShX: -0.9, rShY: 0.1, rEl: -0.8, rWr: 1.0, spineRx: 0.1 }],
    ],
  },
};

function mix(a, b, w) {
  if (w <= 0) return a;
  const o = { ...a };
  for (const k in b) o[k] = lerp(a[k] ?? b[k], b[k], w);
  return o;
}

export function makeNameTag(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 80;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, 128, 40);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.6, 0.5, 1);
  sprite.position.y = 2.2;
  sprite.renderOrder = 10;
  sprite.userData = { canvas: c, ctx, tex, name: text };
  return sprite;
}
function drawTag(tag, hpFrac) {
  const { ctx, tex, name } = tag.userData;
  ctx.clearRect(0, 0, 256, 80);
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(name, 128, 40);
  ctx.fillStyle = '#fff';
  ctx.fillText(name, 128, 40);
  if (hpFrac < 0.999) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(68, 54, 120, 12);
    ctx.fillStyle = hpFrac > 0.5 ? '#5fd35f' : hpFrac > 0.25 ? '#f0c040' : '#e04040';
    ctx.fillRect(70, 56, 116 * Math.max(0, hpFrac), 8);
  }
  tex.needsUpdate = true;
}

// Traînée lumineuse de l'arme
class SwordTrail {
  constructor() {
    this.max = 18;
    this.samples = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 2 * 3);
    this.alpha = new Float32Array(this.max * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < this.max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(0.85,0.93,1.0) * vA, vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  update(time, base, tip, recording) {
    const LIFE = 0.16;
    if (recording) this.samples.push({ a: base.clone(), b: tip.clone(), t: time });
    while (this.samples.length && (time - this.samples[0].t > LIFE || this.samples.length > this.max)) this.samples.shift();
    const n = this.samples.length;
    this.mesh.visible = n > 1;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const k = (1 - (time - s.t) / LIFE) * (i / (n - 1));
      s.a.toArray(this.pos, i * 6); s.b.toArray(this.pos, i * 6 + 3);
      this.alpha[i * 2] = k * 0.15; this.alpha[i * 2 + 1] = k * 0.75;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.setDrawRange(0, (n - 1) * 6);
  }
}

// Forme de révolution : liste [rayon, hauteur] du bas vers le haut
function lathe(profile, seg = 16) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

// Tête sculptée : mâchoire plus fine, crâne plus long vers l'arrière
function headGeometry(r) {
  const g = new THREE.SphereGeometry(r, 32, 24);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ny = y / r, nz = z / r;
    if (ny < 0) {
      const k = Math.pow(-ny, 1.4);
      x *= 1 - 0.3 * k;
      z *= 1 - 0.12 * k * (nz < 0 ? 2.2 : 0.6);
    }
    if (nz < 0) z *= 1.1;
    if (ny > 0.2 && nz > 0.5) z *= 0.97; // front
    x *= 0.9;
    y *= 1.08;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export class CharacterRig {
  constructor(color, name) {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // tout le corps (pour la chute à la mort)
    this.root.add(this.body);
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, ...o });
    const tunicCol = new THREE.Color(color);
    const mat = {
      skin: M('#e9b996', { roughness: 0.6 }),
      tunic: M(tunicCol, { side: THREE.DoubleSide }),
      tunicDark: M(tunicCol.clone().multiplyScalar(0.7)),
      cape: M(tunicCol.clone().multiplyScalar(0.5), { side: THREE.DoubleSide, roughness: 0.9 }),
      pants: M('#5a4636', { roughness: 0.9 }),
      boots: M('#3d2717', { roughness: 0.55 }),
      sole: M('#1f150d'),
      leather: M('#7a4e2a', { roughness: 0.55 }),
      gold: M('#d6a93a', { metalness: 0.7, roughness: 0.35 }),
      hair: M('#4a2c18', { roughness: 0.65 }),
      lips: M('#a5554a', { roughness: 0.5 }),
      dark: M('#1d1a1a'),
      white: M('#f6f3ee', { roughness: 0.3 }),
      iris: M('#3c6b5a', { roughness: 0.25 }),
      steel: M('#dfe4ea', { metalness: 0.6, roughness: 0.25, emissive: 0x1a1d22 }),
      iron: M('#8d939b', { metalness: 0.7, roughness: 0.4 }),
      wood: M('#8a5a32', { roughness: 0.8 }),
    };
    this.mat = mat;
    this.allMats = Object.values(mat);
    this.baseEm = this.allMats.map((m) => m.emissive.clone());
    const part = (parent, geo, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const joint = (parent, x, y, z, order) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      if (order) g.rotation.order = order;
      parent.add(g);
      return g;
    };
    const J = this.J = {};
    const sph = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);

    // ---------------- Bassin ----------------
    J.hips = joint(this.body, 0, 0.93, 0);
    part(J.hips, lathe([[0.001, -0.1], [0.1, -0.09], [0.145, -0.03], [0.155, 0.05], [0.15, 0.1]]), mat.pants, 0, 0, 0, 1.05, 1, 0.78);

    // ---------------- Ventre ----------------
    J.spine = joint(J.hips, 0, 0.07, 0);
    part(J.spine, lathe([[0.148, -0.02], [0.152, 0.08], [0.16, 0.2]]), mat.tunic, 0, 0, 0, 1.15, 1, 0.78);
    part(J.spine, lathe([[0.16, -0.025], [0.162, 0.035]], 20), mat.leather, 0, 0, 0, 1.15, 1, 0.8);
    part(J.spine, new THREE.BoxGeometry(0.07, 0.055, 0.02), mat.gold, 0, 0.005, 0.13);
    // Pans de la tunique (jupe ouverte sur les côtés)
    for (const [ang, w] of [[0, 0.22], [Math.PI, 0.24]]) {
      const flap = new THREE.CylinderGeometry(0.17, 0.215, 0.27, 12, 1, true, ang - w * 2.2, w * 4.4);
      part(J.spine, flap, mat.tunic, 0, -0.15, 0, 1.12, 1, 0.82);
    }

    // ---------------- Buste ----------------
    J.chest = joint(J.spine, 0, 0.2, 0);
    part(J.chest, lathe([[0.16, -0.02], [0.18, 0.08], [0.195, 0.17], [0.188, 0.24], [0.16, 0.29], [0.1, 0.325], [0.04, 0.34]], 20), mat.tunic, 0, 0, 0, 1.24, 1, 0.76);
    // Col en V et bordure
    part(J.chest, new THREE.TorusGeometry(0.075, 0.016, 8, 18), mat.tunicDark, 0, 0.32, 0.005, 1.1, 1, 0.8).rotation.x = Math.PI / 2;
    // Bandoulière + sacoche
    const strap = part(J.chest, new THREE.BoxGeometry(0.05, 0.56, 0.31), mat.leather, 0, 0.13, 0, 1, 1, 1);
    strap.rotation.z = 0.72;
    part(J.chest, new THREE.BoxGeometry(0.03, 0.03, 0.02), mat.gold, -0.07, 0.2, 0.152);

    // ---------------- Tête ----------------
    J.neck = joint(J.chest, 0, 0.31, 0);
    part(J.neck, lathe([[0.058, -0.02], [0.052, 0.06], [0.055, 0.1]]), mat.skin);
    J.head = joint(J.neck, 0, 0.08, 0.005);
    const HR = 0.128, HC = 0.13; // rayon et hauteur du centre de la tête
    const headGeo = headGeometry(HR);
    part(J.head, headGeo, mat.skin, 0, HC, 0);
    // Profondeur de la surface du visage en (x, y) : pour coller les détails sur la peau
    const hp = headGeo.attributes.position;
    const faceZ = (x, y) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < hp.count; i++) {
        const vz = hp.getZ(i);
        if (vz <= 0) continue;
        const d = (hp.getX(i) - x) ** 2 + (hp.getY(i) - (y - HC)) ** 2;
        if (d < bd) { bd = d; best = vz; }
      }
      return best;
    };
    // Oreilles
    for (const sx of [1, -1]) part(J.head, sph(0.03, 10, 8), mat.skin, sx * 0.108, 0.125, -0.012, 0.45, 1, 0.75);
    // Nez
    const nose = new THREE.ConeGeometry(0.017, 0.05, 4);
    nose.rotateX(-Math.PI / 2 + 0.45);
    part(J.head, nose, mat.skin, 0, 0.118, faceZ(0, 0.118) + 0.008, 1, 1, 0.9).rotation.z = Math.PI / 4;
    part(J.head, sph(0.014, 8, 6), mat.skin, 0, 0.103, faceZ(0, 0.103) + 0.01, 1.2, 0.8, 1);
    // Bouche (léger sourire)
    const mouth = part(J.head, new THREE.TorusGeometry(0.02, 0.005, 6, 14, Math.PI * 0.7), mat.lips, 0, 0.082, faceZ(0, 0.075) - 0.002);
    mouth.rotation.set(0.25, 0, Math.PI + Math.PI * 0.15);
    // Yeux (posés sur la surface)
    J.eyes = joint(J.head, 0, 0.142, 0);
    for (const sx of [0.043, -0.043]) {
      const ez = faceZ(sx, 0.142) - 0.006;
      part(J.eyes, sph(0.02, 14, 10), mat.white, sx, 0, ez, 1.25, 0.85, 0.55);
      part(J.eyes, sph(0.012, 12, 8), mat.iris, sx, -0.001, ez + 0.0105, 1, 1, 0.45);
      part(J.eyes, sph(0.0062, 8, 6), mat.dark, sx, -0.001, ez + 0.0145, 1, 1, 0.45);
      part(J.eyes, sph(0.0032, 6, 4), mat.white, sx + 0.004, 0.004, ez + 0.017);
    }
    // Sourcils
    for (const sx of [1, -1]) {
      const b = part(J.head, new THREE.BoxGeometry(0.045, 0.01, 0.012), mat.hair, sx * 0.045, 0.17, faceZ(sx * 0.045, 0.17) + 0.002);
      b.rotation.set(-0.2, sx * 0.3, sx * -0.12);
    }
    // ---- Cheveux : calotte bosselée + mèches stylisées ----
    const hairMat = mat.hair;
    hairMat.flatShading = true;
    const cap = headGeometry(HR * 1.07);
    const cp = cap.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      let x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      // bosses (touffes) pour casser l'effet "casque"
      const n = Math.sin(x * 70) * Math.sin(y * 60 + 1) * Math.sin(z * 65 + 2);
      const k = 1 + n * 0.05;
      x *= k; y *= k; z *= k;
      // ligne des cheveux : dégage le front et le visage
      const hairline = 0.03 + Math.abs(x) * 0.25;
      if (z > 0.03 && y < hairline) { y = hairline + (y - hairline) * 0.08; z = Math.min(z, 0.03 + (y - hairline) * 0.2 + 0.02); x *= 0.97; }
      if (z <= 0.03 && y < -0.105) y = -0.105 + (y + 0.105) * 0.3;
      cp.setXYZ(i, x, y, z);
    }
    cap.computeVertexNormals();
    part(J.head, cap, hairMat, 0, HC + 0.012, -0.006, 1.0, 1.0, 1.0);
    const up = new THREE.Vector3(0, -1, 0), tmpQ = new THREE.Quaternion();
    // mèche : base sur le crâne, pointe vers la direction "dir"
    const lock = (bx, by, bz, dir, len, r) => {
      const g = new THREE.ConeGeometry(r, len, 6);
      g.translate(0, -len / 2, 0);
      g.scale(1, 1, 0.5);
      const m = part(J.head, g, hairMat, bx, by, bz);
      tmpQ.setFromUnitVectors(up, dir.clone().normalize());
      m.quaternion.copy(tmpQ);
      return m;
    };
    // Touffes balayées vers l'arrière tout autour du crâne
    for (let ring = 0; ring < 2; ring++) {
      const n = ring ? 9 : 6, el = ring ? 0.75 : 0.35;
      for (let i = 0; i < n; i++) {
        const az = (i / n) * Math.PI * 2 + ring * 0.3;
        const dx = Math.sin(az) * Math.sin(el), dy = Math.cos(el), dz = Math.cos(az) * Math.sin(el);
        const R = HR * 1.04;
        const bx = dx * R * 0.9, by = HC + 0.01 + dy * R * 1.06, bz = dz * R;
        if (dz > 0.6 && ring) continue; // pas sur le visage
        const sweep = new THREE.Vector3(dx * 0.5, -0.35 - ring * 0.4, -0.9 + dz * 0.2);
        lock(bx, by, bz, sweep, 0.1 + ring * 0.02, 0.04);
      }
    }
    // Frange balayée sur le côté
    lock(-0.05, 0.245, 0.085, new THREE.Vector3(0.9, -0.55, 0.35), 0.12, 0.034);
    lock(-0.01, 0.255, 0.09, new THREE.Vector3(0.85, -0.6, 0.3), 0.13, 0.036);
    lock(0.035, 0.25, 0.085, new THREE.Vector3(0.7, -0.75, 0.3), 0.1, 0.032);
    // Pattes sur les tempes et nuque
    for (const sx of [1, -1]) lock(sx * 0.108, 0.19, 0.035, new THREE.Vector3(sx * 0.15, -1, 0.1), 0.07, 0.024);
    lock(0, 0.1, -0.125, new THREE.Vector3(0, -1, -0.35), 0.08, 0.045);
    lock(0.05, 0.11, -0.11, new THREE.Vector3(0.2, -1, -0.3), 0.07, 0.035);
    lock(-0.05, 0.11, -0.11, new THREE.Vector3(-0.2, -1, -0.3), 0.07, 0.035);

    // ---------------- Bras (la droite du personnage est en -x) ----------------
    const arm = (side) => {
      const sh = joint(J.chest, 0.2 * side, 0.235, 0, 'YXZ');
      part(sh, lathe([[0.056, -0.28], [0.064, -0.17], [0.075, -0.06], [0.072, 0.0], [0.05, 0.035], [0.001, 0.045]]), mat.tunic, 0, 0, 0, 1, 1, 0.92);
      part(sh, lathe([[0.059, -0.285], [0.06, -0.255]], 14), mat.tunicDark);
      const el = joint(sh, 0, -0.27, 0);
      part(el, lathe([[0.04, -0.235], [0.047, -0.15], [0.056, -0.05], [0.052, 0.02]]), mat.skin);
      part(el, lathe([[0.048, -0.22], [0.058, -0.17], [0.06, -0.09]], 14), mat.leather);
      const hand = joint(el, 0, -0.25, 0);
      part(hand, sph(0.045, 12, 10), mat.skin, 0, -0.03, 0.008, 0.85, 1.15, 0.7);
      part(hand, sph(0.018, 8, 6), mat.skin, side * -0.03, -0.015, 0.02, 1, 1.4, 1);
      return { sh, el, hand };
    };
    const L = arm(1), R = arm(-1);
    Object.assign(J, { shL: L.sh, elL: L.el, handL: L.hand, shR: R.sh, elR: R.el, handR: R.hand });

    // ---------------- Jambes ----------------
    const leg = (side) => {
      const th = joint(J.hips, 0.092 * side, -0.035, 0);
      part(th, lathe([[0.058, -0.45], [0.066, -0.38], [0.082, -0.25], [0.097, -0.1], [0.1, -0.02], [0.08, 0.05]]), mat.pants, 0, 0, 0, 0.95, 1, 1);
      const kn = joint(th, 0, -0.42, 0);
      part(kn, sph(0.06, 12, 10), mat.pants, 0, 0, 0.004);
      part(kn, lathe([[0.05, -0.22], [0.062, -0.1], [0.064, -0.04], [0.058, 0.02]]), mat.pants);
      // Botte avec revers
      part(kn, lathe([[0.058, -0.42], [0.056, -0.36], [0.062, -0.26], [0.07, -0.17], [0.079, -0.13], [0.074, -0.12]], 16), mat.boots);
      part(kn, new THREE.TorusGeometry(0.075, 0.012, 6, 16), mat.boots, 0, -0.13, 0, 1, 1, 1).rotation.x = Math.PI / 2;
      const ft = joint(kn, 0, -0.41, 0);
      const foot = new THREE.CapsuleGeometry(0.052, 0.13, 4, 12);
      foot.rotateX(Math.PI / 2);
      part(ft, foot, mat.boots, 0, -0.025, 0.055, 1.08, 0.78, 1);
      part(ft, new THREE.BoxGeometry(0.11, 0.022, 0.25), mat.sole, 0, -0.058, 0.055);
      return { th, kn, ft };
    };
    const LL = leg(1), RL = leg(-1);
    Object.assign(J, { thL: LL.th, knL: LL.kn, ftL: LL.ft, thR: RL.th, knR: RL.kn, ftR: RL.ft });

    // ---------------- Outils dans la main droite (vers +z) ----------------
    this.tools = {};
    const grip = (len, z) => { const g = new THREE.CylinderGeometry(0.019, 0.021, len, 8); g.rotateX(Math.PI / 2); g.translate(0, 0, z); return g; };
    // Épée
    const sword = joint(J.handR, 0, -0.03, 0);
    part(sword, grip(0.16, 0), mat.leather);
    part(sword, sph(0.035, 10, 8), mat.gold, 0, 0, -0.1);
    part(sword, new THREE.BoxGeometry(0.22, 0.035, 0.04), mat.gold, 0, 0, 0.095);
    part(sword, new THREE.BoxGeometry(0.055, 0.012, 0.8), mat.steel, 0, 0, 0.52);
    const tip = new THREE.ConeGeometry(0.039, 0.1, 4); tip.rotateX(Math.PI / 2); tip.rotateZ(Math.PI / 4);
    part(sword, tip, mat.steel, 0, 0, 0.97, 1, 0.3, 1);
    this.tools.sword = sword;
    // Hache
    const axe = joint(J.handR, 0, -0.03, 0);
    part(axe, grip(0.78, 0.25), mat.wood);
    const blade = new THREE.CylinderGeometry(0.11, 0.11, 0.022, 16, 1, false, -0.9, 1.8);
    blade.rotateZ(Math.PI / 2);
    part(axe, blade, mat.iron, 0, 0.0, 0.55);
    part(axe, new THREE.BoxGeometry(0.04, 0.06, 0.07), mat.iron, 0, 0, 0.58);
    this.tools.axe = axe;
    // Pioche
    const pick = joint(J.handR, 0, -0.03, 0);
    part(pick, grip(0.8, 0.26), mat.wood);
    for (const sy of [1, -1]) {
      const c = new THREE.ConeGeometry(0.028, 0.24, 6);
      c.translate(0, 0.12, 0);
      const m = part(pick, c, mat.iron, 0, 0, 0.62);
      m.rotation.x = sy > 0 ? 0.25 : Math.PI - 0.25;
    }
    part(pick, new THREE.BoxGeometry(0.05, 0.06, 0.06), mat.iron, 0, 0, 0.62);
    this.tools.pick = pick;
    // Marteau
    const hammer = joint(J.handR, 0, -0.03, 0);
    part(hammer, grip(0.45, 0.13), mat.wood);
    part(hammer, new THREE.BoxGeometry(0.075, 0.17, 0.08), mat.iron, 0, 0.02, 0.36);
    this.tools.hammer = hammer;
    this.tool = 'sword';
    this.toolPop = 1;
    for (const k in this.tools) this.tools[k].visible = k === 'sword';
    this.bladeBase = new THREE.Vector3(0, 0, 0.15);
    this.bladeTip = new THREE.Vector3(0, 0, 1.0);

    // ---------------- Cape ----------------
    const capeGeo = new THREE.PlaneGeometry(0.5, 0.95, 4, 10);
    capeGeo.translate(0, -0.475, 0);
    this.capeBase = capeGeo.attributes.position.array.slice();
    this.cape = part(J.chest, capeGeo, mat.cape, 0, 0.3, -0.14);

    this.tag = makeNameTag(name);
    this.root.add(this.tag);
    this.root.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });

    this.trail = new SwordTrail();
    this.time = Math.random() * 10;
    this.phase = 0;
    this.speedSm = 0;
    this.air = 0;
    this.land = 0;
    this.wasGrounded = true;
    this.blink = 2;
    this.atk = null;
    this.carry = 0; this.carrying = false;
    this.dead = false; this.deadT = 0;
    this.hurtT = 9;
    this.hp = 1;
    this.stepCb = null; this.lastStep = 0;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  get attacking() { return !!this.atk; }

  setTool(name) {
    if (this.tool === name || !this.tools[name]) return;
    this.tool = name;
    for (const k in this.tools) this.tools[k].visible = k === name;
    this.toolPop = 0;
  }

  setHp(frac) {
    if (Math.abs(frac - this.hp) < 0.001) return;
    this.hp = frac;
    drawTag(this.tag, frac);
  }

  hurt() { this.hurtT = 0; }

  die() { this.dead = true; this.deadT = 0; this.atk = null; }
  revive() { this.dead = false; this.body.rotation.set(0, 0, 0); this.body.position.set(0, 0, 0); }

  attack(kind) {
    if (this.atk || this.dead) return false;
    const def = ATTACKS[kind] || ATTACKS.slash;
    this.atk = { kind, t: 0, def, hitDone: false };
    this.setTool(def.tool);
    return true;
  }

  // speed en m/s ; renvoie true au moment où l'outil frappe
  update(dt, { speed = 0, grounded = true, wind = 0.5, lookYaw = 0 } = {}) {
    const t = (this.time += dt);
    if (this.dead) speed = 0;
    this.speedSm += (speed - this.speedSm) * (1 - Math.exp(-dt * 10));
    const sp = this.speedSm;
    const move = clamp(sp / 3.5, 0, 1), run = clamp((sp - 5) / 3.5, 0, 1);
    const prevPhase = this.phase;
    this.phase += sp * dt * (Math.PI * 2 / lerp(2.1, 3.1, run));
    // Bruit de pas à chaque fois qu'un pied touche le sol
    if (this.stepCb && grounded && move > 0.3 && Math.floor(prevPhase / Math.PI) !== Math.floor(this.phase / Math.PI)) this.stepCb(run);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const br = Math.sin(t * 2.2);
    this.air += ((grounded ? 0 : 1) - this.air) * (1 - Math.exp(-dt * 12));
    if (grounded && !this.wasGrounded) this.land = 1;
    this.wasGrounded = grounded;
    this.land = Math.max(0, this.land - dt * 4);
    this.carry += ((this.carrying ? 1 : 0) - this.carry) * (1 - Math.exp(-dt * 8));

    // Repos : respiration, balancement du poids, regard qui se promène
    let P = {
      hipsY: 0.93 + br * 0.004, hipsRx: 0, hipsRy: 0, hipsRz: Math.sin(t * 0.5) * 0.025,
      spineRx: 0.03 + br * 0.012, spineRy: 0, spineRz: -Math.sin(t * 0.5) * 0.02,
      chestRx: -br * 0.025, chestRy: 0, breath: br,
      headRx: Math.sin(t * 0.6) * 0.04 - 0.02, headRy: Math.sin(t * 0.31) * 0.15 + Math.sin(t * 1.7) * 0.02,
      lShX: 0.05 + br * 0.03, lShY: 0, lShZ: 0.1 + br * 0.02, lEl: -0.25 - br * 0.03, lWr: 0,
      rShX: -0.25 + br * 0.02, rShY: 0.1, rShZ: -0.1, rEl: -0.65, rWr: 1.35,
      lThX: -0.04, lThZ: 0.04 + Math.sin(t * 0.5) * 0.015, lKn: 0.08,
      rThX: 0.04, rThZ: -0.04 + Math.sin(t * 0.5) * 0.015, rKn: 0.06,
    };

    // Marche / course : tout le corps bouge
    if (move > 0.001) {
      const A = lerp(0.5, 0.9, run), armA = lerp(0.45, 0.95, run), K = lerp(0.9, 1.6, run);
      P = mix(P, {
        hipsY: 0.91 - run * 0.05 + (Math.abs(c) - 0.5) * lerp(0.05, 0.1, run),
        hipsRx: 0, hipsRy: s * lerp(0.12, 0.18, run), hipsRz: s * 0.04,
        spineRx: lerp(0.08, 0.32, run), spineRy: -s * lerp(0.18, 0.3, run), spineRz: 0,
        chestRx: 0, chestRy: -s * 0.08, breath: br * 0.5 + Math.sin(t * 6) * run * 0.6,
        headRx: -lerp(0.05, 0.2, run), headRy: s * 0.08,
        lShX: armA * s, lShY: 0, lShZ: 0.1 + run * 0.1, lEl: -lerp(0.35, 1.4, run) - Math.max(0, -s) * 0.3, lWr: 0,
        rShX: -armA * s - 0.15, rShY: 0.1, rShZ: -0.1 - run * 0.1, rEl: -lerp(0.6, 1.4, run) - Math.max(0, s) * 0.3, rWr: 1.35,
        lThX: -A * s, lThZ: 0.03, lKn: 0.12 + Math.max(0, c) * K,
        rThX: A * s, rThZ: -0.03, rKn: 0.12 + Math.max(0, -c) * K,
      }, move);
    }

    // Porter le joyau à deux mains
    if (this.carry > 0.01) {
      P = mix(P, {
        lShX: -1.05, lShY: 0.25, lShZ: 0.18, lEl: -0.75, lWr: 0,
        rShX: -1.05, rShY: -0.25, rShZ: -0.18, rEl: -0.75, rWr: 0.2,
        spineRx: P.spineRx - 0.08, headRx: 0.1,
      }, this.carry);
    }

    // En l'air
    if (this.air > 0.01) {
      P = mix(P, {
        hipsY: 0.93, spineRx: 0.12, headRx: -0.1,
        lThX: -0.75, lKn: 1.15, rThX: 0.2, rKn: 0.65,
        lShX: -0.5, lShZ: 0.55, lEl: -0.6, rShX: -0.7, rShZ: -0.5, rEl: -0.9,
      }, this.air * (1 - this.carry * 0.7));
    }
    // Réception du saut
    if (this.land > 0) {
      const l = Math.sin(this.land * Math.PI) * 0.8;
      P.hipsY -= l * 0.1; P.lKn += l * 0.5; P.rKn += l * 0.5; P.lThX -= l * 0.25; P.rThX -= l * 0.25; P.spineRx += l * 0.15;
    }

    // Coup reçu : recul du buste
    this.hurtT += dt;
    if (this.hurtT < 0.35) {
      const h = Math.sin(this.hurtT / 0.35 * Math.PI);
      P.spineRx -= h * 0.35; P.headRx -= h * 0.4; P.lShX -= h * 0.4; P.hipsY -= h * 0.03;
    }

    // Attaque (surtout le haut du corps, les jambes continuent de marcher)
    let hitNow = false;
    let trailOn = false;
    if (this.atk) {
      const a = this.atk;
      a.t += dt;
      const p = a.t / a.def.dur;
      const fr = a.def.frames;
      let i = 0;
      while (i < fr.length - 2 && p > fr[i + 1][0]) i++;
      const [p0, f0] = fr[i], [p1, f1] = fr[i + 1];
      const k = ss(p0, p1, p);
      const target = {};
      for (const key of new Set([...Object.keys(f0), ...Object.keys(f1)])) target[key] = lerp(f0[key] ?? P[key], f1[key] ?? P[key], k);
      const w = ss(0, 0.1, p) * (1 - ss(0.82, 1, p));
      P = mix(P, target, w);
      if (!a.hitDone && p >= a.def.hit) { a.hitDone = true; hitNow = true; }
      trailOn = a.kind === 'slash' && p > a.def.hit - 0.16 && p < a.def.hit + 0.1;
      if (p >= 1) this.atk = null;
    }

    // Mort : le personnage s'effondre
    if (this.dead) {
      this.deadT += dt;
      const k = ss(0, 0.7, this.deadT);
      P = mix(P, { lKn: 1.2, rKn: 1.0, lThX: -0.6, rThX: -0.4, spineRx: 0.5, headRx: 0.4, lShX: -0.6, rShX: -0.8, lEl: -0.4, rEl: -0.4 }, ss(0, 0.3, this.deadT));
      this.body.rotation.x = -k * 1.45;
      this.body.position.y = -k * 0.05;
    }

    // Application de la pose
    const J = this.J;
    J.hips.position.y = P.hipsY;
    J.hips.rotation.set(P.hipsRx, P.hipsRy, P.hipsRz);
    J.spine.rotation.set(P.spineRx, P.spineRy, P.spineRz);
    J.chest.rotation.set(P.chestRx, P.chestRy, 0);
    J.chest.scale.set(1 + P.breath * 0.012, 1 + P.breath * 0.008, 1 + P.breath * 0.02);
    J.head.rotation.set(P.headRx, P.headRy + lookYaw, 0);
    J.shL.rotation.set(P.lShX, P.lShY, P.lShZ);
    J.elL.rotation.x = P.lEl; J.handL.rotation.x = P.lWr;
    J.shR.rotation.set(P.rShX, P.rShY, P.rShZ);
    J.elR.rotation.x = P.rEl; J.handR.rotation.x = P.rWr;
    J.thL.rotation.set(P.lThX, 0, P.lThZ); J.knL.rotation.x = P.lKn; J.ftL.rotation.x = -(P.lThX + P.lKn) * 0.85;
    J.thR.rotation.set(P.rThX, 0, P.rThZ); J.knR.rotation.x = P.rKn; J.ftR.rotation.x = -(P.rThX + P.rKn) * 0.85;

    // Outil : petite apparition quand on change, caché quand on porte le joyau
    this.toolPop = Math.min(1, this.toolPop + dt * 6);
    const tl = this.tools[this.tool];
    tl.scale.setScalar(ss(0, 1, this.toolPop) * (1 - this.carry));
    tl.visible = this.carry < 0.95;

    // Flash rouge quand on est touché
    const flash = this.hurtT < 0.2 ? 1 - this.hurtT / 0.2 : 0;
    if (flash > 0 || this.flashing) {
      this.allMats.forEach((m, i) => { m.emissive.copy(this.baseEm[i]); m.emissive.r += flash * 0.6; });
      this.flashing = flash > 0;
    }

    // Clignement des yeux
    this.blink -= dt;
    if (this.blink < 0) this.blink = 2.5 + Math.random() * 3.5;
    J.eyes.scale.y = this.blink < 0.13 || this.dead ? 0.15 : 1;

    // Cape qui flotte avec la vitesse et le vent
    const cp = this.cape.geometry.attributes.position, base = this.capeBase;
    const spN = clamp(sp / 8, 0, 1);
    for (let i = 0; i < cp.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1];
      const v = -by / 0.95;
      const back = v * v * (0.06 + spN * 0.5 + this.air * 0.2) + v * 0.05;
      const flutter = Math.sin(t * 7 + v * 5 + bx * 6) * v * (0.02 + spN * 0.07 + wind * 0.03);
      cp.setXYZ(i, bx * (1 + v * 0.25) + Math.sin(t * 3 + v * 3) * 0.01 * v, by + v * v * (spN * 0.28 + this.air * 0.15), -back + flutter + bx * bx * 1.4 * (1 - v * 0.5));
    }
    cp.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();

    // Traînée de l'épée (en coordonnées du monde)
    this.root.updateMatrixWorld(true);
    const sw = this.tools.sword;
    this._a.copy(this.bladeBase).applyMatrix4(sw.matrixWorld);
    this._b.copy(this.bladeTip).applyMatrix4(sw.matrixWorld);
    this.trail.update(t, this._a, this._b, trailOn);

    return hitNow;
  }

  // Position du joyau porté (devant la poitrine)
  carryPoint(out) {
    out.set(0, 1.18, 0.42);
    return this.root.localToWorld(out);
  }

  dispose(scene) {
    scene.remove(this.root);
    scene.remove(this.trail.mesh);
  }
}
