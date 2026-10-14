// Le Rôdeur : créature de la nuit. Modèle articulé + animations (marche, attaque,
// coup reçu, mort, apparition, brûlure au lever du soleil).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, MONSTERS, isWater } from './world.js';

// Couleurs de chaque sorte de monstre
const LOOK = {
  brute: { skin: '#56465f', light: '#8a7488', eye: 0xffb030, eyeCol: '#ffd23a', mouth: '#ff3015', vein: '#ff5a1f' },
  runner: { skin: '#6e3a32', light: '#a8665a', eye: 0xff3020, eyeCol: '#ff6040', mouth: '#ff2010', vein: '#ffb020' },
  spitter: { skin: '#3c5a48', light: '#6f9a74', eye: 0x8aff40, eyeCol: '#c8ff60', mouth: '#7aff30', vein: '#9aff40' },
};

// Fusionne les morceaux immobiles les uns par rapport aux autres (moins d'objets à dessiner)
function mergeStatic(root) {
  const groups = [];
  root.traverse((o) => { if (o.isGroup) groups.push(o); });
  for (const g of groups) {
    const byMat = new Map();
    for (const c of g.children) if (c.isMesh && !c.userData.keep) { if (!byMat.has(c.material)) byMat.set(c.material, []); byMat.get(c.material).push(c); }
    for (const [mat, meshes] of byMat) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        geo.applyMatrix4(m.matrix);
        return geo;
      });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      for (const m of meshes) g.remove(m);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      g.add(mesh);
    }
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function mix(a, b, w) {
  if (w <= 0) return a;
  const o = { ...a };
  for (const k in b) o[k] = lerp(a[k] ?? b[k], b[k], w);
  return o;
}
function lathe(profile, seg = 12) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}
function roughen(geo, amp, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 23.1 + seed) * Math.sin(y * 17.3 + seed * 2) * Math.sin(z * 19.7 + seed * 3);
    const k = 1 + n * amp;
    p.setXYZ(i, x * k, y, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// Matériaux partagés par tous les monstres (le flash utilise des copies)
const SHARED = {};
function sharedMats() {
  if (SHARED.skin) return SHARED;
  // Peau tachetée et cicatrisée
  const sc = document.createElement('canvas');
  sc.width = sc.height = 256;
  const sx = sc.getContext('2d');
  sx.fillStyle = '#d8d0d8'; sx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const v = 120 + Math.random() * 110;
    sx.fillStyle = `rgba(${v * 0.7},${v * 0.6},${v * 0.7},${0.25 + Math.random() * 0.35})`;
    sx.beginPath(); sx.ellipse(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 14, 2 + Math.random() * 8, Math.random() * 3, 0, Math.PI * 2); sx.fill();
  }
  sx.strokeStyle = 'rgba(255,240,240,0.45)'; sx.lineWidth = 2;
  for (let i = 0; i < 18; i++) { sx.beginPath(); const x = Math.random() * 256, y = Math.random() * 256; sx.moveTo(x, y); sx.lineTo(x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 50); sx.stroke(); }
  SHARED.skinTex = new THREE.CanvasTexture(sc);
  SHARED.skinTex.wrapS = SHARED.skinTex.wrapT = THREE.RepeatWrapping;
  SHARED.skinTex.repeat.set(2, 2);
  SHARED.skinTex.colorSpace = THREE.SRGBColorSpace;
  SHARED.skin = new THREE.MeshStandardMaterial({ color: '#56465f', roughness: 0.75, flatShading: true, map: SHARED.skinTex });
  SHARED.cloth = new THREE.MeshStandardMaterial({ color: '#3a2a22', roughness: 1, side: THREE.DoubleSide, flatShading: true });
  SHARED.metal = new THREE.MeshStandardMaterial({ color: '#5a5550', metalness: 0.7, roughness: 0.5, flatShading: true });
  SHARED.skinLight = new THREE.MeshStandardMaterial({ color: '#8a7488', roughness: 0.7, flatShading: true });
  SHARED.bone = new THREE.MeshStandardMaterial({ color: '#d9ceb4', roughness: 0.6, flatShading: true });
  SHARED.mouth = new THREE.MeshStandardMaterial({ color: '#3a0a08', emissive: '#ff3015', emissiveIntensity: 0.6 });
  SHARED.eye = new THREE.MeshBasicMaterial({ color: '#ffd23a' });
  SHARED.vein = new THREE.MeshBasicMaterial({ color: '#ff5a1f' });
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,220,120,1)'); g.addColorStop(0.3, 'rgba(255,140,40,0.5)'); g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  SHARED.glowTex = new THREE.CanvasTexture(c);
  return SHARED;
}

export class MonsterRig {
  constructor(kind = 'brute') {
    const S0 = sharedMats();
    const look = LOOK[kind] || LOOK.brute;
    this.kind = kind;
    this.T = MONSTERS[kind] || MONSTERS.brute;
    if (!S0[kind]) {
      S0[kind] = {
        ...S0,
        mouth: new THREE.MeshStandardMaterial({ color: '#3a0a08', emissive: look.mouth, emissiveIntensity: 0.6 }),
        eye: new THREE.MeshBasicMaterial({ color: look.eyeCol }),
        vein: new THREE.MeshBasicMaterial({ color: look.vein }),
      };
    }
    const S = S0[kind];
    // Chaque monstre a ses propres copies pour pouvoir clignoter / brûler seul
    this.skin = S0.skin.clone();
    this.skin.color.set(look.skin);
    this.skinLight = S0.skinLight.clone();
    this.skinLight.color.set(look.light);
    this.eyeColor = look.eye;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const part = (parent, geo, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const J = this.J = {};
    const claw = (parent, x, y, z, len = 0.16, rx = 0.4) => {
      const g = new THREE.ConeGeometry(0.018, len, 5);
      g.translate(0, -len / 2, 0);
      const m = part(parent, g, S.bone, x, y, z);
      m.rotation.x = rx;
      return m;
    };

    // Bassin
    J.hips = joint(this.body, 0, 0.98, 0);
    part(J.hips, roughen(lathe([[0.05, -0.12], [0.17, -0.06], [0.2, 0.05], [0.16, 0.12]]), 0.06, 1), this.skin, 0, 0, 0, 1.15, 1, 0.85);

    // Colonne courbée
    J.spine = joint(J.hips, 0, 0.1, 0);
    part(J.spine, roughen(lathe([[0.16, 0], [0.18, 0.12], [0.24, 0.3], [0.27, 0.42]], 14), 0.07, 2), this.skin, 0, 0, 0, 1.2, 1, 0.9);
    // Côtes saillantes
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.TorusGeometry(0.2 + i * 0.02, 0.014, 5, 14, Math.PI * 0.9);
      const m = part(J.spine, rib, this.skinLight, 0, 0.16 + i * 0.09, 0.02, 1.25, 1, 1);
      m.rotation.set(Math.PI / 2 + 0.2, 0, Math.PI * 0.05);
    }

    // Poitrine massive
    J.chest = joint(J.spine, 0, 0.42, 0);
    part(J.chest, roughen(lathe([[0.26, -0.05], [0.31, 0.08], [0.3, 0.2], [0.2, 0.3], [0.08, 0.34]], 16), 0.08, 3), this.skin, 0, 0, 0, 1.35, 1, 1.0);
    // Veines lumineuses
    for (const sx of [1, -1]) part(J.chest, new THREE.BoxGeometry(0.02, 0.22, 0.02), S.vein, sx * 0.12, 0.1, 0.27).rotation.z = sx * 0.4;
    // Épines dorsales
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.ConeGeometry(0.035 - i * 0.003, 0.2 - i * 0.015, 5);
      const parent = i < 3 ? J.chest : J.spine;
      const y = i < 3 ? 0.28 - i * 0.12 : 0.38 - (i - 3) * 0.13;
      const m = part(parent, sp, S.bone, 0, y, -0.24 - (i < 3 ? 0.04 : 0));
      m.rotation.x = -1.1;
    }

    // Tête
    J.neck = joint(J.chest, 0, 0.3, 0.1);
    part(J.neck, roughen(lathe([[0.1, -0.05], [0.09, 0.08], [0.1, 0.16]]), 0.06, 4), this.skin);
    J.head = joint(J.neck, 0, 0.16, 0.04);
    const skull = roughen(new THREE.SphereGeometry(0.15, 14, 10), 0.08, 5);
    part(J.head, skull, this.skin, 0, 0.06, 0.04, 1, 0.85, 1.35);
    // Arcade sourcilière
    part(J.head, new THREE.BoxGeometry(0.24, 0.05, 0.08), this.skinLight, 0, 0.1, 0.17).rotation.x = 0.3;
    // Yeux brillants + halo
    this.eyes = [];
    for (const sx of [1, -1]) {
      part(J.head, new THREE.SphereGeometry(0.024, 8, 6), S.eye, sx * 0.065, 0.065, 0.2, 1.3, 0.7, 0.6);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: S.glowTex, color: this.eyeColor, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(0.22);
      glow.position.set(sx * 0.065, 0.065, 0.23);
      J.head.add(glow);
      this.eyes.push(glow);
    }
    // Cornes recourbées
    for (const sx of [1, -1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx * 0.08, 0.1, -0.05),
        new THREE.Vector3(sx * 0.14, 0.16, -0.18), new THREE.Vector3(sx * 0.13, 0.12, -0.32),
      ]);
      const tube = new THREE.TubeGeometry(curve, 10, 0.03, 6);
      const p = tube.attributes.position;
      // affiner vers la pointe
      for (let i = 0; i < p.count; i++) {
        const seg = Math.floor(i / 7) / 10;
        const c = curve.getPoint(Math.min(1, seg));
        const k = 1 - seg * 0.85;
        p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
      }
      tube.computeVertexNormals();
      part(J.head, tube, S.bone, sx * 0.08, 0.14, 0.02);
    }
    // Mâchoire qui s'ouvre
    J.jaw = joint(J.head, 0, -0.01, -0.02);
    part(J.jaw, roughen(new THREE.SphereGeometry(0.11, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0.05, 6), this.skin, 0, 0.02, 0.1, 1.05, 0.8, 1.6);
    part(J.jaw, new THREE.CircleGeometry(0.1, 10), S.mouth, 0, 0.018, 0.1, 1, 1, 1.5).rotation.x = -Math.PI / 2;
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2.2;
      const tooth = new THREE.ConeGeometry(0.012, 0.05, 4);
      part(J.jaw, tooth, S.bone, Math.sin(a) * 0.085, 0.04, 0.1 + Math.cos(a) * 0.15);
      const top = new THREE.ConeGeometry(0.013, 0.055, 4);
      const m = part(J.head, top, S.bone, Math.sin(a) * 0.09, 0.0, 0.1 + Math.cos(a) * 0.16);
      m.rotation.x = Math.PI;
    }

    // Bras très longs
    const arm = (side) => {
      const sh = joint(J.chest, side * 0.36, 0.16, 0.02);
      sh.rotation.order = 'YXZ';
      part(sh, roughen(new THREE.SphereGeometry(0.12, 10, 8), 0.1, 7 + side), this.skin, 0, 0, 0, 1.1, 1, 1);
      part(sh, roughen(lathe([[0.065, -0.48], [0.085, -0.3], [0.1, -0.12], [0.09, 0.02]]), 0.07, 8 + side), this.skin);
      const el = joint(sh, 0, -0.46, 0);
      part(el, roughen(lathe([[0.05, -0.46], [0.075, -0.3], [0.085, -0.12], [0.07, 0.03]]), 0.07, 9 + side), this.skin);
      // Pique au coude
      const spike = new THREE.ConeGeometry(0.025, 0.14, 5);
      part(el, spike, S.bone, 0, 0.0, -0.08).rotation.x = -2.2;
      const hand = joint(el, 0, -0.46, 0);
      part(hand, roughen(new THREE.SphereGeometry(0.07, 8, 6), 0.1, 10 + side), this.skin, 0, -0.03, 0.02, 1, 1.2, 0.8);
      const claws = [];
      for (let i = 0; i < 3; i++) claws.push(claw(hand, (i - 1) * 0.04, -0.08, 0.05, 0.2, 0.5));
      claws.push(claw(hand, side * -0.06, -0.04, 0.0, 0.12, 0.2));
      return { sh, el, hand };
    };
    const L = arm(1), R = arm(-1);
    Object.assign(J, { shL: L.sh, elL: L.el, haL: L.hand, shR: R.sh, elR: R.el, haR: R.hand });

    // Jambes de bête (genou vers l'arrière)
    const leg = (side) => {
      const th = joint(J.hips, side * 0.16, -0.04, 0);
      part(th, roughen(lathe([[0.07, -0.44], [0.1, -0.3], [0.13, -0.12], [0.12, 0.04]]), 0.07, 12 + side), this.skin);
      const kn = joint(th, 0, -0.42, 0);
      part(kn, roughen(lathe([[0.05, -0.4], [0.065, -0.25], [0.085, -0.05], [0.08, 0.03]]), 0.07, 13 + side), this.skin);
      const an = joint(kn, 0, -0.4, 0);
      part(an, roughen(lathe([[0.04, -0.26], [0.05, -0.1], [0.06, 0.02]]), 0.07, 14 + side), this.skin);
      const ft = joint(an, 0, -0.26, 0);
      part(ft, new THREE.SphereGeometry(0.06, 8, 6), this.skin, 0, 0, 0.04, 1.2, 0.6, 1.4);
      for (let i = 0; i < 3; i++) claw(ft, (i - 1) * 0.04, -0.01, 0.12, 0.1, 1.9);
      return { th, kn, an, ft };
    };
    const LL = leg(1), RL = leg(-1);
    Object.assign(J, { thL: LL.th, knL: LL.kn, anL: LL.an, ftL: LL.ft, thR: RL.th, knR: RL.kn, anR: RL.an, ftR: RL.ft });

    // ---------- Détails : épaulières d'os, pagne en lambeaux, défenses, crinière, chaînes, queue ----------
    const S1 = S0;
    if (kind !== 'spitter') {
      for (const [sh, side] of [[J.shL, 1], [J.shR, -1]]) {
        const pad = part(sh, new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), S.bone, 0, 0.04, 0, 1.15, 0.8, 1.1);
        pad.rotation.z = side * 0.3;
        for (let i = 0; i < 3; i++) {
          const sp = part(sh, new THREE.ConeGeometry(0.03, 0.2 - i * 0.03, 5), S.bone, side * (0.04 + i * 0.05), 0.14 - i * 0.02, -0.04 + i * 0.05);
          sp.rotation.z = -side * (0.5 + i * 0.2);
        }
      }
    }
    // pagne en lambeaux
    for (let i = 0; i < 5; i++) {
      const a = (i / 5 - 0.4) * 2.4;
      const strip = new THREE.PlaneGeometry(0.12, 0.34 + (i % 2) * 0.1, 1, 3);
      strip.translate(0, -0.17, 0);
      const pp = strip.attributes.position;
      for (let k = 0; k < pp.count; k++) if (pp.getY(k) < -0.3) pp.setX(k, pp.getX(k) * (0.4 + Math.random() * 0.6));
      const m = part(J.hips, strip, S1.cloth, Math.sin(a) * 0.2, -0.05, Math.cos(a) * 0.16);
      m.rotation.y = a;
      m.rotation.x = -0.1;
    }
    part(J.hips, new THREE.TorusGeometry(0.21, 0.025, 5, 16), S1.cloth, 0, -0.02, 0, 1.1, 1, 0.82).rotation.x = Math.PI / 2;
    // défenses (dents qui sortent de la mâchoire)
    for (const sx of [1, -1]) {
      const tusk = part(J.jaw, new THREE.ConeGeometry(0.022, 0.13, 5), S.bone, sx * 0.07, 0.07, 0.2);
      tusk.rotation.set(-0.3, 0, sx * 0.25);
    }
    // crinière d'épines derrière la tête
    for (let i = 0; i < 5; i++) {
      const a = (i / 4 - 0.5) * 1.6;
      const sp = part(J.head, new THREE.ConeGeometry(0.025, 0.2, 4), S.bone, Math.sin(a) * 0.1, 0.14, -0.1 - Math.cos(a) * 0.04);
      sp.rotation.set(-1.9, a * 0.5, 0);
    }
    // bracelets de fer avec bout de chaîne (Rôdeur)
    if (kind === 'brute') {
      for (const ha of [J.elL, J.elR]) {
        part(ha, new THREE.TorusGeometry(0.085, 0.025, 6, 12), S1.metal, 0, -0.36, 0).rotation.x = Math.PI / 2;
        for (let k = 0; k < 3; k++) {
          const link = part(ha, new THREE.TorusGeometry(0.03, 0.009, 4, 8), S1.metal, 0.07, -0.42 - k * 0.05, 0);
          link.rotation.y = k % 2 ? Math.PI / 2 : 0;
        }
      }
      // fissures lumineuses sur le dos
      for (let i = 0; i < 4; i++) part(J.chest, new THREE.BoxGeometry(0.015, 0.16, 0.015), S.vein, (i - 1.5) * 0.08, 0.18 + (i % 2) * 0.05, -0.27).rotation.z = (i - 1.5) * 0.4;
    }
    // queue articulée (Griffu : longue, Rôdeur : courte)
    this.tail = [];
    const segs = kind === 'runner' ? 7 : kind === 'brute' ? 4 : 0;
    let parentT = J.hips;
    for (let i = 0; i < segs; i++) {
      const jt = joint(parentT, 0, i === 0 ? 0.02 : 0, i === 0 ? -0.16 : -0.13);
      const rr = (kind === 'runner' ? 0.07 : 0.09) * (1 - i / (segs + 1));
      const seg = new THREE.CylinderGeometry(rr * 0.8, rr, 0.15, 6).rotateX(Math.PI / 2);
      seg.translate(0, 0, -0.07);
      part(jt, seg, this.skin);
      if (i % 2 === 0) part(jt, new THREE.ConeGeometry(0.02, 0.1, 4), S.bone, 0, rr, -0.06).rotation.x = -0.6;
      jt.userData.keepJoint = true;
      this.tail.push(jt);
      parentT = jt;
    }
    // Cracheur : pustules lumineuses sur le corps
    if (kind === 'spitter') {
      this.pustules = [];
      const pm = new THREE.MeshStandardMaterial({ color: '#9aff60', emissive: '#4adf20', emissiveIntensity: 0.8, roughness: 0.3 });
      for (const [par, x, y, z, r0] of [[J.shL, 0.06, -0.1, 0.08, 0.05], [J.shR, -0.05, -0.2, 0.07, 0.045], [J.spine, 0.12, 0.25, 0.2, 0.06], [J.spine, -0.15, 0.15, 0.18, 0.05], [J.head, 0.08, 0.15, 0.05, 0.04], [J.thL, 0.08, -0.15, 0.08, 0.05], [J.elR, 0.05, -0.15, 0.04, 0.04]]) {
        const pu = part(par, new THREE.SphereGeometry(r0, 8, 6), pm, x, y, z);
        pu.userData.keep = true;
        this.pustules.push(pu);
      }
      // capuchon de peau autour de la tête
      const hood = part(J.neck, new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), this.skinLight, 0, 0.2, -0.06, 1.1, 1, 1);
      hood.rotation.x = -0.4;
    }

    // Cracheur : poche de poison lumineuse sur le dos et à la gorge
    if (kind === 'spitter') {
      this.sac = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshStandardMaterial({ color: '#7aff40', emissive: '#4aff20', emissiveIntensity: 0.9, roughness: 0.3, transparent: true, opacity: 0.85 }));
      this.sac.position.set(0, 0.2, -0.3);
      this.sac.scale.set(1.1, 1.2, 0.9);
      this.sac.userData.keep = true;
      J.chest.add(this.sac);
      const throat = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), this.sac.material);
      throat.position.set(0, 0.0, 0.05);
      throat.userData.keep = true;
      J.neck.add(throat);
      this.throat = throat;
    }
    // Griffu : crête d'épines supplémentaire
    if (kind === 'runner') {
      for (let i = 0; i < 4; i++) {
        const sp = new THREE.ConeGeometry(0.03, 0.18, 5);
        const m = part(J.head, sp, S.bone, 0, 0.18 - i * 0.04, -0.05 - i * 0.07);
        m.rotation.x = -0.9 - i * 0.2;
      }
    }
    mergeStatic(this.root);
    this.root.scale.setScalar(this.T.scale);

    // Barre de vie
    const c = document.createElement('canvas');
    c.width = 128; c.height = 16;
    this.barCtx = c.getContext('2d');
    this.barTex = new THREE.CanvasTexture(c);
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, depthTest: false, transparent: true }));
    this.bar.position.y = 2.45;
    this.bar.scale.set(1.0 / this.T.scale, 0.125 / this.T.scale, 1);
    this.bar.renderOrder = 10;
    this.bar.visible = false;
    this.root.add(this.bar);

    this.time = Math.random() * 10;
    this.phase = Math.random() * 6;
    this.speedSm = 0;
    this.atkT = 9; this.hurtT = 9; this.deadT = -1; this.spawnT = 0; this.burn = 0;
    this.twitch = 0; this.twitchT = 1;
    this.root.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  }

  setHp(frac) {
    const ctx = this.barCtx;
    ctx.clearRect(0, 0, 128, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, 128, 16);
    ctx.fillStyle = '#d23a2a'; ctx.fillRect(2, 2, 124 * clamp(frac, 0, 1), 12);
    this.barTex.needsUpdate = true;
    this.bar.visible = frac < 0.999 && frac > 0;
  }

  attack() { this.atkT = 0; }
  hurt() { this.hurtT = 0; }
  die(burn) { this.deadT = 0; this.burn = burn ? 0.01 : 0; this.bar.visible = false; }

  // Renvoie des événements pour les sons : { step, strike, deathThud }
  update(dt, speed) {
    const t = (this.time += dt);
    const ev = {};
    this.speedSm += (speed - this.speedSm) * (1 - Math.exp(-dt * 6));
    const sp = this.speedSm;
    const move = clamp(sp / 2, 0, 1);
    const prev = this.phase;
    this.phase += sp * dt * 2.3 / this.T.scale;

    if (move > 0.3 && Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) ev.step = true;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const br = Math.sin(t * 1.6);
    this.twitchT -= dt;
    if (this.twitchT < 0) { this.twitchT = 0.6 + Math.random() * 2; this.twitch = (Math.random() - 0.5) * 0.9; }

    // Repos : respiration lourde, tête qui tressaille
    let P = {
      hipsY: 0.98 + br * 0.01, hipsRx: 0, hipsRz: 0,
      spineRx: 0.38 + br * 0.04, spineRz: 0, chestRx: 0.1 + br * 0.03, breath: br,
      neckRx: -0.4, headRx: -0.1, headRy: this.twitch * 0.6, headRz: this.twitch * 0.2, jaw: 0.1 + Math.max(0, br) * 0.1,
      lShX: 0.25, lShZ: 0.25, lEl: -0.3, rShX: 0.25, rShZ: -0.25, rEl: -0.3, lHa: 0.2, rHa: 0.2,
      lTh: -0.45, lKn: 0.95, lAn: -0.85, rTh: -0.4, rKn: 0.9, rAn: -0.8, lFt: 0.35, rFt: 0.3, lean: 0,
    };
    if (move > 0.01) {
      P = mix(P, {
        hipsY: 0.94 + Math.abs(c) * 0.08, hipsRz: s * 0.08,
        spineRx: 0.5, spineRz: -s * 0.12, chestRx: 0.15,
        neckRx: -0.6 + Math.abs(s) * 0.1, headRx: -0.05 + Math.abs(c) * 0.15, headRy: this.twitch * 0.3 + s * 0.15, headRz: -s * 0.15, jaw: 0.25 + Math.abs(s) * 0.15,
        lShX: 0.3 - s * 0.7, lShZ: 0.3, lEl: -0.4 - Math.max(0, s) * 0.6, rShX: 0.3 + s * 0.7, rShZ: -0.3, rEl: -0.4 - Math.max(0, -s) * 0.6,
        lTh: -0.45 - s * 0.6, lKn: 0.95 + Math.max(0, c) * 0.7, lAn: -0.85 - Math.max(0, c) * 0.4,
        rTh: -0.45 + s * 0.6, rKn: 0.95 + Math.max(0, -c) * 0.7, rAn: -0.85 - Math.max(0, -c) * 0.4,
        lFt: 0.35 + s * 0.3, rFt: 0.35 - s * 0.3,
      }, move);
    }

    // Attaque : se cabre, rugit, puis frappe des deux bras en bondissant
    // (le moment du coup est calé sur celui du serveur pour chaque sorte de monstre)
    this.atkT += dt * (0.5 / this.T.hitAt) * (this.frost ? 0.55 : 1);
    if (this.kind === 'spitter' && this.atkT < 1.1) {
      const p = this.atkT;
      const charge = ss(0, 0.48, p) * (1 - ss(0.5, 0.6, p));
      const spit = ss(0.48, 0.56, p) * (1 - ss(0.7, 1.1, p));
      P = mix(P, { spineRx: -0.15, chestRx: -0.35, neckRx: 0.1, headRx: -0.7, jaw: 0.3, breath: 3, lShX: 0.4, rShX: 0.4, lShZ: 0.6, rShZ: -0.6, hipsY: 1.0 }, charge);
      P = mix(P, { spineRx: 0.7, chestRx: 0.3, neckRx: -0.9, headRx: 0.25, jaw: 1, lShX: 0.6, rShX: 0.6, lean: 0.15 }, spit);
      if (this.sac) this.sac.scale.setScalar(1 + charge * 0.5 - spit * 0.25);
      if (p - dt * (0.5 / this.T.hitAt) < 0.5 && p >= 0.5) ev.spit = true;
    } else if (this.atkT < 1.1) {
      const p = this.atkT;
      const up = ss(0, 0.45, p) * (1 - ss(0.45, 0.58, p));
      const down = ss(0.45, 0.58, p) * (1 - ss(0.75, 1.1, p));
      P = mix(P, {
        spineRx: 0.05, chestRx: -0.25, neckRx: -0.2, headRx: -0.45, jaw: 0.75,
        lShX: -2.6, lShZ: 0.5, lEl: -0.9, rShX: -2.6, rShZ: -0.5, rEl: -0.9, hipsY: 1.05,
      }, up);
      P = mix(P, {
        spineRx: 0.95, chestRx: 0.35, neckRx: -0.6, headRx: 0.1, jaw: 0.6,
        lShX: -0.9, lShZ: 0.15, lEl: -0.1, rShX: -0.9, rShZ: -0.15, rEl: -0.1, hipsY: 0.86,
        lTh: -0.9, lKn: 1.2, rTh: -0.1, rKn: 0.7, lean: 0.35,
      }, down);
      if (p - dt * (0.5 / this.T.hitAt) < 0.5 && p >= 0.5) ev.strike = true;
    }

    // Coup reçu
    this.hurtT += dt;
    if (this.hurtT < 0.35) {
      const h = Math.sin(this.hurtT / 0.35 * Math.PI);
      P.spineRx -= h * 0.4; P.headRx -= h * 0.5; P.jaw += h * 0.4; P.lean -= h * 0.15;
      P.lShX -= h * 0.6; P.rShX -= h * 0.6;
    }

    // Brûlure au lever du jour
    if (this.burn > 0) this.burn = Math.min(1, this.burn + dt * 0.8);

    // Mort : titube, tombe à genoux, s'effondre, puis se dissout
    let sink = 0;
    if (this.deadT >= 0) {
      this.deadT += dt;
      const d = this.deadT;
      P = mix(P, { spineRx: 0.0, headRx: -0.6, jaw: 0.9, lShX: -1.0, rShX: -0.6, lean: -0.2 }, ss(0, 0.35, d) * (1 - ss(0.4, 0.8, d)));
      P = mix(P, { hipsY: 0.45, lTh: -1.5, lKn: 2.0, rTh: -1.4, rKn: 2.1, lAn: -0.3, rAn: -0.3, spineRx: 0.5, neckRx: -0.3, headRx: 0.3, jaw: 0.4, lShX: 0.2, rShX: 0.3, lEl: -0.2, rEl: -0.2 }, ss(0.4, 0.9, d));
      this.body.rotation.x = ss(0.9, 1.5, d) * 1.35;
      this.body.position.y = -ss(0.9, 1.5, d) * 0.35;
      if (d - dt < 1.45 && d >= 1.45) ev.deathThud = true;
      sink = ss(2.0, 3.5, d);
    }

    // Apparition : sort du sol
    this.spawnT += dt;
    const rise = 1 - ss(0, 1.6, this.spawnT);

    // Application
    const J = this.J;
    J.hips.position.y = P.hipsY - rise * 1.6 - sink * 0.9;
    J.hips.rotation.set(P.hipsRx, 0, P.hipsRz);
    J.spine.rotation.set(P.spineRx, 0, P.spineRz);
    J.chest.rotation.x = P.chestRx;
    J.chest.scale.set(1 + P.breath * 0.025, 1, 1 + P.breath * 0.03);
    J.neck.rotation.x = P.neckRx;
    J.head.rotation.set(P.headRx, P.headRy, P.headRz);
    J.jaw.rotation.x = clamp(P.jaw, 0, 1) * 0.6;
    for (let i = 0; i < this.tail.length; i++) {
      const tj = this.tail[i];
      tj.rotation.y = Math.sin(t * (move > 0.1 ? 6 : 1.8) - i * 0.7) * (0.15 + move * 0.2);
      tj.rotation.x = (i === 0 ? 0.35 : -0.08) + Math.sin(t * 1.3 - i * 0.5) * 0.05 + (this.deadT >= 0 ? 0.1 : 0);
    }
    if (this.pustules) this.pustules.forEach((pu, i) => pu.scale.setScalar(1 + Math.sin(t * 3 + i * 1.7) * 0.15));
    J.shL.rotation.set(P.lShX, 0, P.lShZ); J.elL.rotation.x = P.lEl; J.haL.rotation.x = P.lHa;
    J.shR.rotation.set(P.rShX, 0, P.rShZ); J.elR.rotation.x = P.rEl; J.haR.rotation.x = P.rHa;
    J.thL.rotation.x = P.lTh; J.knL.rotation.x = P.lKn; J.anL.rotation.x = P.lAn; J.ftL.rotation.x = P.lFt;
    J.thR.rotation.x = P.rTh; J.knR.rotation.x = P.rKn; J.anR.rotation.x = P.rAn; J.ftR.rotation.x = P.rFt;
    this.body.position.z = P.lean;

    // Couleurs : flash blanc quand touché, rougeoiement quand il brûle
    const flash = this.hurtT < 0.25 ? Math.pow(1 - this.hurtT / 0.25, 1.5) : 0;
    const er = flash * 1.1 + this.burn * 0.9, eg = flash * 1.1 + this.burn * 0.3, eb = flash * 1.1;
    const ice = this.frost ? 0.12 : 0;
    this.skin.emissive.setRGB(er, eg + ice * 0.5, eb + ice);
    this.skinLight.emissive.setRGB(er, eg, eb);
    if (this.sac) this.sac.material.emissiveIntensity = 0.9 + flash;
    const eyeK = this.deadT >= 0 ? 1 - ss(0.5, 2.0, this.deadT) : 1;
    for (const e of this.eyes) e.material.opacity = eyeK * (0.75 + Math.sin(t * 9) * 0.1);
    if (sink > 0) this.body.scale.setScalar(1 - sink * 0.6);

    ev.gone = this.deadT > 3.5;
    ev.smoke = (this.deadT > 1.8 && this.deadT < 3.4) || this.burn > 0.2 || this.spawnT < 1.3;
    return ev;
  }
}

// ---------------- Gestion de tous les monstres ----------------
export class Monsters {
  constructor(scene, fx, audio) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.map = new Map();
    this.smokeMat = new THREE.MeshBasicMaterial({ color: 0x1a1020, transparent: true, opacity: 0.5, depthWrite: false });
    this.growlT = 2;
  }

  clear() {
    for (const s of this.shots || []) this.scene.remove(s.ball);
    this.shots = [];
    for (const m of this.map.values()) this.scene.remove(m.rig.root);
    this.map.clear();
  }

  spawn(d, quiet) {
    if (this.map.has(d.id)) return;
    const kind = MONSTERS[d.k] ? d.k : 'brute';
    const rig = new MonsterRig(kind);
    rig.root.position.set(d.x, heightAt(d.x, d.z), d.z);
    rig.root.rotation.y = d.ry || 0;
    if (quiet) rig.spawnT = 5;
    this.scene.add(rig.root);
    const max = MONSTERS[kind].hp;
    const m = { id: d.id, kind, rig, tx: d.x, tz: d.z, ry: d.ry || 0, st: 0, hp: d.hp ?? max, max, dead: false, lastX: d.x, lastZ: d.z };
    rig.setHp(m.hp / max);
    this.map.set(d.id, m);
    if (!quiet) this.audio?.play('monsterSpawn', rig.root.position);
  }

  sync(list) {
    for (const [id, x, z, ry, st, fr] of list) {
      const m = this.map.get(id);
      if (!m || m.dead) continue;
      m.tx = x; m.tz = z; m.ry = ry; m.st = st;
      if (!!fr !== !!m.rig.frost) {
        m.rig.frost = !!fr;
        if (fr) for (let i = 0; i < 6; i++) this.fx.spawn({ geo: this.fx.box, mat: this.iceMat ||= new THREE.MeshBasicMaterial({ color: 0xbfe8ff }), pos: m.rig.root.position.clone().add(new THREE.Vector3(0, 1, 0)), vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2), size: 0.05, life: 0.8, gravity: 4 });
      }
    }
  }

  attack(id) {
    const m = this.map.get(id);
    if (!m || m.dead) return;
    m.rig.attack();
    this.audio?.play(m.kind === 'spitter' ? 'spitCharge' : m.kind === 'runner' ? 'runnerAttack' : 'monsterAttack', m.rig.root.position);
  }

  hurt(id, hp) {
    const m = this.map.get(id);
    if (!m) return;
    m.hp = hp;
    m.rig.setHp(hp / m.max);
    m.rig.hurt();
    this.audio?.play('monsterHurt', m.rig.root.position);
    const p = m.rig.root.position;
    if (!this.sparkMat) this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    for (let i = 0; i < 8; i++) {
      this.fx.spawn({
        geo: this.fx.box, mat: this.sparkMat, pos: new THREE.Vector3(p.x, p.y + 1.1 * m.rig.T.scale, p.z),
        vel: new THREE.Vector3((Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6),
        size: 0.03, life: 0.25 + Math.random() * 0.15, gravity: 6, spin: 0,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.fx.spawn({
        geo: this.fx.box, mat: this.fx.mats.blood || (this.fx.mats.blood = new THREE.MeshBasicMaterial({ color: 0x5a1030 })),
        pos: new THREE.Vector3(p.x, p.y + 1.2, p.z),
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3),
        size: 0.04 + Math.random() * 0.04, life: 0.8, gravity: 14,
      });
    }
  }

  die(id, burn) {
    const m = this.map.get(id);
    if (!m || m.dead) return;
    m.dead = true;
    m.rig.die(burn);
    this.audio?.play(burn ? 'monsterBurn' : 'monsterDie', m.rig.root.position);
  }

  // Monstre touché par un coup d'épée devant le joueur
  findInFront(px, pz, fx, fz, reach) {
    let best = null, bd = Infinity;
    for (const m of this.map.values()) {
      if (m.dead || m.rig.spawnT < 1) continue;
      const p = m.rig.root.position;
      const dx = p.x - px, dz = p.z - pz, d = Math.hypot(dx, dz);
      if (d > reach + 0.6) continue;
      const dot = (dx * fx + dz * fz) / Math.max(d, 0.01);
      if (dot < 0.2 && d > 0.9) continue;
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  nearestDist(px, pz) {
    let bd = Infinity;
    for (const m of this.map.values()) if (!m.dead) bd = Math.min(bd, Math.hypot(m.rig.root.position.x - px, m.rig.root.position.z - pz));
    return bd;
  }

  // Boule de poison lancée par un Cracheur : vole en cloche puis éclabousse
  shot(d) {
    const m = this.map.get(d.id);
    const y0 = m ? m.rig.root.position.y + 1.6 * m.rig.T.scale : heightAt(d.x0, d.z0) + 1.5;
    if (!this.ballGeo) {
      this.ballGeo = new THREE.IcosahedronGeometry(0.18, 1);
      this.ballMat = new THREE.MeshBasicMaterial({ color: 0xa8ff50 });
      this.dropMat = new THREE.MeshBasicMaterial({ color: 0x7aff30, transparent: true, opacity: 0.8 });
    }
    const ball = new THREE.Mesh(this.ballGeo, this.ballMat);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedMats().glowTex, color: 0x8aff40, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.1);
    ball.add(glow);
    this.scene.add(ball);
    const dist = Math.hypot(d.x1 - d.x0, d.z1 - d.z0);
    (this.shots ||= []).push({ ball, x0: d.x0, z0: d.z0, y0, x1: d.x1, z1: d.z1, y1: heightAt(d.x1, d.z1) + 0.3, t: 0, dur: d.t, arc: 2 + dist * 0.18, trail: 0 });
    this.audio?.play('spit', new THREE.Vector3(d.x0, y0, d.z0));
  }

  updateShots(dt) {
    if (!this.shots) return;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const x = s.x0 + (s.x1 - s.x0) * k, z = s.z0 + (s.z1 - s.z0) * k;
      const y = s.y0 + (s.y1 - s.y0) * k + Math.sin(k * Math.PI) * s.arc;
      s.ball.position.set(x, y, z);
      s.ball.rotation.x += dt * 8;
      s.trail -= dt;
      if (s.trail <= 0) {
        s.trail = 0.03;
        this.fx.spawn({ geo: this.ballGeo, mat: this.dropMat, pos: s.ball.position.clone(), vel: new THREE.Vector3(0, -0.5, 0), size: 0.35, life: 0.35, gravity: 2, spin: 0 });
      }
      if (k >= 1) {
        this.scene.remove(s.ball);
        this.shots.splice(i, 1);
        const p = new THREE.Vector3(s.x1, s.y1, s.z1);
        for (let j = 0; j < 14; j++) {
          this.fx.spawn({
            geo: this.ballGeo, mat: this.dropMat, pos: p,
            vel: new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6),
            size: 0.2 + Math.random() * 0.2, life: 0.9, gravity: 12,
          });
        }
        this.fx.puff(p, 0x6adf30, 5, 0.6);
        this.audio?.play('spitHit', p);
      }
    }
  }

  update(dt) {
    this.updateShots(dt);
    this.growlT -= dt;
    let growled = false;
    for (const m of [...this.map.values()]) {
      const root = m.rig.root;
      if (!m.dead) {
        const k = 1 - Math.exp(-dt * 8);
        root.position.x += (m.tx - root.position.x) * k;
        root.position.z += (m.tz - root.position.z) * k;
        root.rotation.y += wrap(m.ry - root.rotation.y) * Math.min(1, dt * 8);
      }
      root.position.y = heightAt(root.position.x, root.position.z);
      const spd = m.dead ? 0 : Math.hypot(root.position.x - m.lastX, root.position.z - m.lastZ) / Math.max(dt, 1e-4);
      m.lastX = root.position.x; m.lastZ = root.position.z;
      const ev = m.rig.update(dt, spd);
      if (ev.step) {
        this.audio?.play(isWater(root.position.x, root.position.z) ? 'splashStep' : 'monsterStep', root.position);
      }
      if (ev.deathThud) this.audio?.play('thud', root.position);
      if (ev.smoke && Math.random() < dt * 25) {
        const burnCol = m.rig.burn > 0.2;
        this.fx.spawn({
          geo: this.fx.sphere, mat: burnCol ? (this.burnMat ||= new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.6, depthWrite: false })) : this.smokeMat,
          pos: new THREE.Vector3(root.position.x + (Math.random() - 0.5) * 0.8, root.position.y + 0.2 + Math.random() * (m.dead ? 0.6 : 1.6), root.position.z + (Math.random() - 0.5) * 0.8),
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, 1 + Math.random(), (Math.random() - 0.5) * 0.5),
          size: 0.12 + Math.random() * 0.15, life: 1.2, gravity: -0.5, drag: 1.5, spin: 0,
        });
      }
      if (!m.dead && !growled && this.growlT < 0 && Math.random() < 0.3) {
        this.audio?.play(m.kind === 'runner' ? 'runnerGrowl' : m.kind === 'spitter' ? 'spitterGrowl' : 'monsterGrowl', root.position);
        growled = true;
      }
      if (ev.gone) { this.scene.remove(root); this.map.delete(m.id); }
    }
    if (this.growlT < 0) this.growlT = 1.5 + Math.random() * 2.5;
  }
}
