// Personnage articulé (hanches, colonne, poitrine, tête, épaules, coudes, poignets,
// cuisses, genoux, pieds), avec épée, cape et animations calculées en temps réel.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Attaques : images-clés (p = progression 0..1). Les valeurs absentes gardent la pose normale.
export const ATTACKS = {
  slash: {
    dur: 0.5, hit: 0.46, frames: [
      [0.0, { rShX: -1.0, rShY: -0.6, rShZ: -0.3, rEl: -1.2, rWr: 0.3, spineRy: -0.3, chestRy: -0.2 }],
      [0.36, { rShX: -2.5, rShY: -0.9, rShZ: -0.2, rEl: -1.3, rWr: -0.2, spineRy: -0.6, chestRy: -0.3, spineRx: -0.05 }],
      [0.5, { rShX: -0.6, rShY: 0.9, rShZ: -0.2, rEl: -0.15, rWr: 1.0, spineRy: 0.5, chestRy: 0.3, spineRx: 0.2 }],
      [1.0, { rShX: -0.5, rShY: 0.6, rShZ: -0.15, rEl: -0.4, rWr: 1.1, spineRy: 0.3, chestRy: 0.1, spineRx: 0.1 }],
    ],
  },
  chop: { // coupe de bois : grand coup horizontal
    dur: 0.62, hit: 0.5, frames: [
      [0.0, { rShX: -1.2, rShY: -0.6, rShZ: -0.2, rEl: -0.9, rWr: 1.0, spineRy: -0.3, lShX: -0.4, lEl: -0.6 }],
      [0.38, { rShX: -1.45, rShY: -1.5, rShZ: -0.1, rEl: -0.7, rWr: 1.2, spineRy: -0.85, chestRy: -0.35, hipsRy: -0.2, lShX: -0.9, lShY: 0.6, lEl: -0.5, lThX: -0.25, rThX: 0.2, lKn: 0.25, rKn: 0.25 }],
      [0.52, { rShX: -1.45, rShY: 0.5, rShZ: -0.1, rEl: -0.1, rWr: 1.45, spineRy: 0.55, chestRy: 0.25, hipsRy: 0.15, lShX: -0.3, lShY: 0.0, lEl: -0.7, lThX: -0.25, rThX: 0.2, lKn: 0.3, rKn: 0.3 }],
      [1.0, { rShX: -1.0, rShY: 0.4, rShZ: -0.15, rEl: -0.4, rWr: 1.2, spineRy: 0.25, lShX: -0.2, lEl: -0.5 }],
    ],
  },
  mine: { // casse-pierre : frappe à deux mains au-dessus de la tête
    dur: 0.7, hit: 0.53, frames: [
      [0.0, { rShX: -1.6, rShY: 0.5, rEl: -1.0, rWr: 0.6, lShX: -1.5, lShY: -0.5, lEl: -1.0 }],
      [0.4, { rShX: -3.0, rShY: 0.4, rEl: -0.9, rWr: 0.2, lShX: -2.9, lShY: -0.4, lEl: -0.9, spineRx: -0.25, headRx: -0.25, hipsY: 0.95 }],
      [0.55, { rShX: -0.55, rShY: 0.35, rEl: -0.15, rWr: 1.25, lShX: -0.6, lShY: -0.35, lEl: -0.2, spineRx: 0.55, headRx: 0.25, hipsY: 0.82, lThX: -0.45, lKn: 0.75, rThX: 0.15, rKn: 0.55 }],
      [1.0, { rShX: -0.6, rShY: 0.3, rEl: -0.5, rWr: 1.2, lShX: -0.4, lShY: -0.2, lEl: -0.4, spineRx: 0.15, hipsY: 0.9 }],
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
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, 128, 42);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.2;
  sprite.renderOrder = 10;
  return sprite;
}

// Traînée lumineuse de l'épée
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

export class CharacterRig {
  constructor(color, name) {
    this.root = new THREE.Group();
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, ...o });
    const tunicCol = new THREE.Color(color);
    const mat = {
      skin: M('#f1c9a5'),
      tunic: M(tunicCol, { side: THREE.DoubleSide }),
      cape: M(tunicCol.clone().multiplyScalar(0.55), { side: THREE.DoubleSide, roughness: 0.9 }),
      pants: M('#4a3a2e'),
      boots: M('#3a2618', { roughness: 0.6 }),
      leather: M('#6b4423', { roughness: 0.6 }),
      gold: M('#d6a93a', { metalness: 0.7, roughness: 0.35 }),
      hair: M('#4b2f1a', { roughness: 0.9 }),
      dark: M('#1d1a1a'),
      steel: M('#dfe4ea', { metalness: 0.55, roughness: 0.25, emissive: 0x1a1d22 }),
    };
    this.mat = mat;
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
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 12);
    const sph = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);

    // Bassin et ventre
    J.hips = joint(this.root, 0, 0.93, 0);
    part(J.hips, sph(0.17), mat.pants, 0, 0.02, 0, 1.15, 0.75, 0.85);
    J.spine = joint(J.hips, 0, 0.07, 0);
    part(J.spine, cap(0.15, 0.12), mat.tunic, 0, 0.1, 0, 1.2, 1, 0.82);
    part(J.spine, new THREE.CylinderGeometry(0.19, 0.19, 0.06, 18), mat.leather, 0, 0.02, 0, 1, 1, 0.74);
    part(J.spine, new THREE.BoxGeometry(0.06, 0.05, 0.02), mat.gold, 0, 0.02, 0.145);
    part(J.spine, new THREE.CylinderGeometry(0.19, 0.25, 0.24, 18, 1, true), mat.tunic, 0, -0.11, 0, 1, 1, 0.76);

    // Buste
    J.chest = joint(J.spine, 0, 0.22, 0);
    part(J.chest, cap(0.17, 0.16), mat.tunic, 0, 0.1, 0, 1.3, 1, 0.8);
    part(J.chest, new THREE.TorusGeometry(0.1, 0.025, 8, 16), mat.leather, 0, 0.27, 0, 1, 1, 1).rotation.x = Math.PI / 2;
    // Bandoulière
    part(J.chest, new THREE.BoxGeometry(0.05, 0.5, 0.29), mat.leather, 0, 0.1, 0, 1, 1, 1).rotation.z = 0.7;

    // Tête
    J.neck = joint(J.chest, 0, 0.3, 0);
    part(J.neck, new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10), mat.skin, 0, 0.03, 0);
    J.head = joint(J.neck, 0, 0.08, 0);
    part(J.head, sph(0.15, 24, 18), mat.skin, 0, 0.12, 0, 1, 1.1, 1.02);
    part(J.head, new THREE.SphereGeometry(0.16, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.4), mat.hair, 0, 0.135, -0.015, 1.04, 1.12, 1.08);
    // Mèche sur le front
    part(J.head, sph(0.06, 10, 8), mat.hair, 0.04, 0.215, 0.11, 1.3, 0.6, 0.7).rotation.z = -0.4;
    part(J.head, sph(0.15), mat.hair, 0, 0.1, -0.06, 1, 1, 0.8);
    part(J.head, sph(0.03, 8, 6), mat.skin, 0.15, 0.11, 0, 0.5, 1, 0.8);
    part(J.head, sph(0.03, 8, 6), mat.skin, -0.15, 0.11, 0, 0.5, 1, 0.8);
    part(J.head, sph(0.022, 8, 6), mat.skin, 0, 0.1, 0.15, 0.8, 1, 1);
    part(J.head, new THREE.BoxGeometry(0.05, 0.008, 0.01), M('#8a3a35'), 0, 0.055, 0.143);
    J.eyes = joint(J.head, 0, 0.13, 0.13);
    const white = M('#f4f1ea', { roughness: 0.4 });
    for (const sx of [0.055, -0.055]) {
      part(J.eyes, sph(0.028, 12, 10), white, sx, 0, 0.005, 1, 1, 0.55);
      part(J.eyes, sph(0.016, 10, 8), M('#3b2a1c', { roughness: 0.3 }), sx, 0, 0.018, 1, 1, 0.6);
      part(J.eyes, sph(0.005, 6, 4), white, sx + 0.005, 0.006, 0.027);
    }
    part(J.head, new THREE.BoxGeometry(0.06, 0.012, 0.015), mat.hair, 0.055, 0.175, 0.14).rotation.z = -0.1;
    part(J.head, new THREE.BoxGeometry(0.06, 0.012, 0.015), mat.hair, -0.055, 0.175, 0.14).rotation.z = 0.1;

    // Bras (la droite du personnage est en -x)
    const arm = (side) => {
      const sh = joint(J.chest, 0.25 * side, 0.23, 0, 'YXZ');
      part(sh, sph(0.085), mat.tunic);
      part(sh, cap(0.055, 0.17), mat.tunic, 0, -0.13, 0);
      const el = joint(sh, 0, -0.27, 0);
      part(el, cap(0.048, 0.15), mat.skin, 0, -0.11, 0);
      part(el, new THREE.CylinderGeometry(0.056, 0.062, 0.11, 10), mat.leather, 0, -0.14, 0);
      const hand = joint(el, 0, -0.25, 0);
      part(hand, sph(0.05, 10, 8), mat.skin, 0, -0.02, 0.01, 0.9, 1.1, 1);
      return { sh, el, hand };
    };
    const L = arm(1), R = arm(-1);
    Object.assign(J, { shL: L.sh, elL: L.el, handL: L.hand, shR: R.sh, elR: R.el, handR: R.hand });

    // Jambes
    const leg = (side) => {
      const th = joint(J.hips, 0.1 * side, -0.04, 0);
      part(th, cap(0.075, 0.24), mat.pants, 0, -0.2, 0);
      const kn = joint(th, 0, -0.42, 0);
      part(kn, cap(0.065, 0.2), mat.pants, 0, -0.14, 0);
      part(kn, new THREE.CylinderGeometry(0.078, 0.07, 0.24, 12), mat.boots, 0, -0.26, 0);
      const ft = joint(kn, 0, -0.4, 0);
      const foot = new THREE.CapsuleGeometry(0.05, 0.14, 4, 10);
      foot.rotateX(Math.PI / 2);
      part(ft, foot, mat.boots, 0, -0.035, 0.05, 1.15, 1, 1);
      return { th, kn, ft };
    };
    const LL = leg(1), RL = leg(-1);
    Object.assign(J, { thL: LL.th, knL: LL.kn, ftL: LL.ft, thR: RL.th, knR: RL.kn, ftR: RL.ft });

    // Épée dans la main droite (lame vers +z)
    const sword = joint(J.handR, 0, -0.03, 0);
    const grip = new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8); grip.rotateX(Math.PI / 2);
    part(sword, grip, mat.leather);
    part(sword, sph(0.035, 10, 8), mat.gold, 0, 0, -0.1);
    part(sword, new THREE.BoxGeometry(0.22, 0.035, 0.04), mat.gold, 0, 0, 0.095);
    part(sword, new THREE.BoxGeometry(0.055, 0.012, 0.8), mat.steel, 0, 0, 0.52);
    const tip = new THREE.ConeGeometry(0.039, 0.1, 4); tip.rotateX(Math.PI / 2); tip.rotateZ(Math.PI / 4);
    part(sword, tip, mat.steel, 0, 0, 0.97, 1, 0.3, 1);
    this.sword = sword;
    this.bladeBase = new THREE.Vector3(0, 0, 0.15);
    this.bladeTip = new THREE.Vector3(0, 0, 1.0);

    // Cape
    const capeGeo = new THREE.PlaneGeometry(0.48, 0.95, 4, 10);
    capeGeo.translate(0, -0.475, 0);
    this.capeBase = capeGeo.attributes.position.array.slice();
    this.cape = part(J.chest, capeGeo, mat.cape, 0, 0.36, -0.15);

    this.root.add(makeNameTag(name));
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
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  get attacking() { return !!this.atk; }

  attack(kind) {
    if (this.atk) return false;
    this.atk = { kind, t: 0, def: ATTACKS[kind] || ATTACKS.slash, hitDone: false };
    return true;
  }

  // speed en m/s ; renvoie true au moment où la lame frappe
  update(dt, { speed = 0, grounded = true, wind = 0.5, lookYaw = 0 } = {}) {
    const t = (this.time += dt);
    this.speedSm += (speed - this.speedSm) * (1 - Math.exp(-dt * 10));
    const sp = this.speedSm;
    const move = clamp(sp / 3.5, 0, 1), run = clamp((sp - 5) / 3.5, 0, 1);
    this.phase += sp * dt * (Math.PI * 2 / lerp(2.1, 3.1, run));
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const br = Math.sin(t * 2.2);
    this.air += ((grounded ? 0 : 1) - this.air) * (1 - Math.exp(-dt * 12));
    if (grounded && !this.wasGrounded) this.land = 1;
    this.wasGrounded = grounded;
    this.land = Math.max(0, this.land - dt * 4);

    // Repos : respiration, balancement du poids, regard qui se promène
    let P = {
      hipsY: 0.93 + br * 0.004, hipsRx: 0, hipsRy: 0, hipsRz: Math.sin(t * 0.5) * 0.025,
      spineRx: 0.03 + br * 0.012, spineRy: 0, spineRz: -Math.sin(t * 0.5) * 0.02,
      chestRx: -br * 0.025, chestRy: 0, breath: br,
      headRx: Math.sin(t * 0.6) * 0.04 - 0.02, headRy: Math.sin(t * 0.31) * 0.15 + Math.sin(t * 1.7) * 0.02,
      lShX: 0.05 + br * 0.03, lShY: 0, lShZ: 0.13 + br * 0.02, lEl: -0.25 - br * 0.03, lWr: 0,
      rShX: -0.25 + br * 0.02, rShY: 0.1, rShZ: -0.13, rEl: -0.65, rWr: 1.35,
      lThX: -0.04, lThZ: 0.05 + Math.sin(t * 0.5) * 0.015, lKn: 0.08,
      rThX: 0.04, rThZ: -0.05 + Math.sin(t * 0.5) * 0.015, rKn: 0.06,
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
        lShX: armA * s, lShY: 0, lShZ: 0.12 + run * 0.1, lEl: -lerp(0.35, 1.4, run) - Math.max(0, -s) * 0.3, lWr: 0,
        rShX: -armA * s - 0.15, rShY: 0.1, rShZ: -0.12 - run * 0.1, rEl: -lerp(0.6, 1.4, run) - Math.max(0, s) * 0.3, rWr: 1.35,
        lThX: -A * s, lThZ: 0.03, lKn: 0.12 + Math.max(0, c) * K,
        rThX: A * s, rThZ: -0.03, rKn: 0.12 + Math.max(0, -c) * K,
      }, move);
    }

    // En l'air
    if (this.air > 0.01) {
      P = mix(P, {
        hipsY: 0.93, spineRx: 0.12, headRx: -0.1,
        lThX: -0.75, lKn: 1.15, rThX: 0.2, rKn: 0.65,
        lShX: -0.5, lShZ: 0.55, lEl: -0.6, rShX: -0.7, rShZ: -0.5, rEl: -0.9,
      }, this.air);
    }
    // Réception du saut
    if (this.land > 0) {
      const l = Math.sin(this.land * Math.PI) * 0.8;
      P.hipsY -= l * 0.1; P.lKn += l * 0.5; P.rKn += l * 0.5; P.lThX -= l * 0.25; P.rThX -= l * 0.25; P.spineRx += l * 0.15;
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
      trailOn = p > a.def.hit - 0.16 && p < a.def.hit + 0.1;
      if (p >= 1) this.atk = null;
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

    // Clignement des yeux
    this.blink -= dt;
    if (this.blink < 0) this.blink = 2.5 + Math.random() * 3.5;
    J.eyes.scale.y = this.blink < 0.13 ? 0.15 : 1;

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
    this._a.copy(this.bladeBase).applyMatrix4(this.sword.matrixWorld);
    this._b.copy(this.bladeTip).applyMatrix4(this.sword.matrixWorld);
    this.trail.update(t, this._a, this._b, trailOn);

    return hitNow;
  }

  dispose(scene) {
    scene.remove(this.root);
    scene.remove(this.trail.mesh);
  }
}
