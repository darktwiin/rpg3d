// Personnage du joueur : aventuriers du pack KayKit Adventurers (chevalier, barbare, mage,
// voleur, voleur encapuchonné), avec leurs animations (repos, marche, course, saut, coup,
// coup reçu, mort) et les outils du pack KayKit RPG Tools tenus en main droite.
import * as THREE from 'three';
import { skinnedModel, staticGeometry, modelMaterial, prop, KK } from './models.js';
import { classOf } from './world.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const TOOLS = ['sword', 'axe', 'pick', 'hammer', 'waraxe', 'staff', 'bow', 'fist'];

// Durée de chaque geste et moment du coup (0..1). Chaque geste joue une animation du pack
// KayKit Character Animations, recalée pour que l'outil frappe exactement au moment « hit » :
// t0 = début du morceau joué, strike = seconde où l'outil touche, t1 = fin (en secondes de l'animation).
export const ATTACKS = {
  slash: { dur: 0.5, hit: 0.46, tool: 'sword', variants: [
    { clip: 'Melee_1H_Attack_Slice_Diagonal', t0: 0.12, strike: 0.42, t1: 0.85 },
    { clip: 'Melee_1H_Attack_Slice_Horizontal', t0: 0.0, strike: 0.3, t1: 0.85 },
  ] },
  chop: { dur: 0.62, hit: 0.5, tool: 'axe', variants: [{ clip: 'Chopping', t0: -0.45, strike: 0.32, t1: 0.8 }] },
  mine: { dur: 0.7, hit: 0.53, tool: 'pick', variants: [{ clip: 'Pickaxing', t0: 1.2, strike: 1.98, t1: 2.6 }] },
  hammer: { dur: 0.45, hit: 0.55, tool: 'hammer', variants: [{ clip: 'Hammering', t0: 0.8, strike: 1.45, t1: 1.95 }] },
  // styles de combat
  // barbare : hache à une main, coups rapides
  cleave: { dur: 0.48, hit: 0.5, tool: 'waraxe', variants: [
    { clip: 'Melee_1H_Attack_Chop', t0: 0.15, strike: 0.58, t1: 1.0 },
    { clip: 'Melee_1H_Attack_Slice_Diagonal', t0: 0.12, strike: 0.42, t1: 0.85 },
    { clip: 'Melee_1H_Attack_Slice_Horizontal', t0: 0.0, strike: 0.3, t1: 0.85 },
  ] },
  // mage : il lance une boule de feu avec son bâton
  staff: { dur: 0.62, hit: 0.5, tool: 'staff', variants: [{ clip: 'Ranged_Magic_Shoot', t0: 0.05, strike: 0.36, t1: 0.9 }] },
  // coup de poing (pour rire, entre alliés)
  punch: { dur: 0.45, hit: 0.5, tool: 'fist', variants: [{ clip: 'Melee_1H_Attack_Stab', t0: 0.1, strike: 0.4, t1: 0.8 }] },
  // l'arc : on bande (Draw) puis on lâche la flèche (Release)
  shoot: { dur: 0.95, hit: 0.78, tool: 'bow', variants: [{ clip: 'Ranged_Bow_Release', t0: 0.0, strike: 0.07, t1: 0.75, pre: { clip: 'Ranged_Bow_Draw', t0: 0.1, t1: 1.15 } }] },
};

// os du haut du corps (noms des os KayKit, sans les points)
export const UPPER = /^(spine|chest|head|upperarm|lowerarm|wrist|hand|handslot)/;

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
      fragmentShader: 'uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol * vA, vA); }',
      uniforms: { uCol: { value: new THREE.Color(0.85, 0.93, 1.0) } },
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

// Garde seulement les pistes du haut du corps (pour frapper tout en marchant)
const clipCache = new Map();
const AURA = { rage: [0.75, 0.05, 0, true], blood: [0.45, 0, 0.08], bulwark: [0.55, 0.45, 0.1], taunt: [0.6, 0.28, 0] };

export function getClip(anims, name, upper = false) {
  const key = name + (upper ? '_u' : '');
  if (!clipCache.has(key)) {
    const src = anims.find((a) => a.name === name);
    if (!src) return null;
    const c = src.clone();
    // pas de déplacement de la racine ni d'échelle animée (évite les glissements)
    c.tracks = c.tracks.filter((t) => {
      const [bone, prop] = t.name.split('.');
      if (prop === 'scale') return false;
      if (upper) return UPPER.test(bone);
      return true;
    });
    clipCache.set(key, c);
  }
  return clipCache.get(key);
}

// Fait tourner un os autour d'un axe exprimé dans le repère du monde
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
function rotateBoneWorld(bone, axis, angle) {
  bone.parent.getWorldQuaternion(_pq);
  bone.getWorldQuaternion(_wq);
  _q.setFromAxisAngle(axis, angle).multiply(_wq);
  bone.quaternion.copy(_pq.invert().multiply(_q));
}
// Oriente un os pour que son axe Y (vers l'os suivant) pointe dans une direction du monde
const _cur = new THREE.Vector3(), _sq = new THREE.Quaternion();
function aimBone(bone, dirWorld, w) {
  bone.getWorldQuaternion(_wq);
  _cur.set(0, 1, 0).applyQuaternion(_wq);
  _q.setFromUnitVectors(_cur, dirWorld).multiply(_wq);
  bone.parent.getWorldQuaternion(_pq);
  _sq.copy(_pq.invert().multiply(_q));
  bone.quaternion.slerp(_sq, w);
  bone.updateMatrixWorld(true);
}

// Outil du pack dans la main : les modèles KayKit ont déjà la poignée à l'origine
function toolMesh(name, mat, scale = 1) {
  const geo = staticGeometry(name);
  const m = new THREE.Mesh(geo, mat);
  m.scale.setScalar(scale);
  m.castShadow = true;
  const g = new THREE.Group();
  g.add(m);
  g.userData.len = geo.boundingBox.max.y * scale;
  return g;
}

export class CharacterRig {
  constructor(color, name, skin = 'Knight') {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.skinName = skin;

    const { scene, animations } = skinnedModel(skin);
    this.model = scene;
    scene.scale.setScalar(KK);
    this.body.add(scene);
    const bone = (n) => scene.getObjectByName(n);
    this.B = {
      hips: bone('hips'), chest: bone('chest'), head: bone('head'),
      upL: bone('upperarml'), upR: bone('upperarmr'), loL: bone('lowerarml'), loR: bone('lowerarmr'),
      handR: bone('handslotr'),
    };

    // un matériau par personnage (flash rouge quand il est touché)
    this.mats = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      o.material = o.material.clone();
      this.mats.push(o.material);
    });

    // ---- Outils dans la main droite ----
    this.cls = classOf(skin);
    this.weapon = this.cls.weapon;
    this.toolMat = modelMaterial('t_axe').clone();
    this.swordMat = modelMaterial('a_sword_1handed').clone();
    this.glowMats = [this.swordMat];
    // arme du pack Adventurers (matériaux copiés : elle peut briller avec la Larme)
    const weaponProp = (name, sc = 1) => {
      const o = prop(name, sc);
      o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); this.glowMats.push(m.material); } });
      const g = new THREE.Group(); g.add(o);
      o.updateMatrixWorld(true);
      g.userData.len = new THREE.Box3().setFromObject(o).max.y;
      return g;
    };
    this.tools = {
      sword: toolMesh('a_sword_1handed', this.swordMat, 1),
      axe: toolMesh('t_axe', this.toolMat, 1.2),
      pick: toolMesh('t_pickaxe', this.toolMat, 0.95),
      hammer: toolMesh('t_hammer', this.toolMat, 1.2),
      waraxe: weaponProp('x_waraxe', 0.82),
      staff: weaponProp('x_staff'),
      bow: weaponProp('x_bow'),
      fist: new THREE.Group(),
    };
    this.tools.fist.userData.len = 0.2;
    // l'arc était tenu à l'envers (corde vers l'extérieur) : demi-tour autour de sa longueur
    this.tools.bow.children[0].rotation.y = Math.PI;
    // la hache de bûcheron aussi : le tranchant doit regarder l'arbre
    this.tools.axe.children[0].rotation.y = Math.PI;
    this.B.handL = bone('handslotl');
    for (const k in this.tools) (k === 'bow' ? this.B.handL : this.B.handR).add(this.tools[k]);
    // le guerrier porte toujours son bouclier au bras gauche
    if (this.cls.block) {
      this.shield = weaponProp('x_shield');
      this.B.handL.add(this.shield);
    }
    this.tool = this.weapon;
    this.toolPop = 1;
    for (const k in this.tools) this.tools[k].visible = k === this.tool;
    // bâton du mage : boule de feu au bout
    if (this.weapon === 'staff') {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.35, 'rgba(255,140,40,0.6)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.flame.position.y = this.tools.staff.userData.len * 0.92;
      this.flame.scale.setScalar(0.55);
      this.tools.staff.add(this.flame);
    }
    this.bladeBase = new THREE.Vector3(0, 0.3, 0);
    this.bladeTip = new THREE.Vector3(0, this.tools.sword.userData.len * 0.85, 0);

    // ---- Animations ----
    this.mixer = new THREE.AnimationMixer(scene);
    this.animations = animations;
    const act = (c, loop = true) => { const a = this.mixer.clipAction(c); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.play(); a.weight = 0; return a; };
    this.A = {
      idle: act(getClip(animations, 'Idle_A')), walk: act(getClip(animations, 'Walking_A')), run: act(getClip(animations, 'Running_A')),
      air: act(getClip(animations, 'Jump_Idle')),
      hit: act(getClip(animations, 'Hit_A', true), false),
      death: act(getClip(animations, 'Death_A'), false),
    };
    this.A.idle.weight = 1;
    // une animation (haut du corps) par geste d'attaque
    this.atkActs = {};
    for (const def of Object.values(ATTACKS)) for (const v of def.variants) {
      if (this.atkActs[v.clip]) continue;
      for (const c of [v.clip, v.pre?.clip]) {
        if (!c || this.atkActs[c]) continue;
        const a = act(getClip(animations, c, true), true);
        a.paused = true;
        this.atkActs[c] = a;
      }
    }
    // parade du guerrier (haut du corps, en boucle)
    this.blockAct = act(getClip(animations, 'Melee_Blocking', true), true);
    // dash (corps entier) et salto du double saut
    this.dodgeActs = ['Dodge_Forward', 'Dodge_Backward', 'Dodge_Left', 'Dodge_Right'].map((n) => { const a = act(getClip(animations, n), false); a.paused = true; return a; });
    this.dodge = null; this.flipT = 9;
    this.blocking = false; this.blockK = 0;
    this.atkN = 0;
    this.A.hit.paused = true; this.A.death.paused = true;
    this.hitDur = this.A.hit.getClip().duration;

    this.tag = makeNameTag(name);
    this.tag.position.y = 2.25;
    this.root.add(this.tag);
    this.trail = new SwordTrail();
    this.time = Math.random() * 10;
    this.speedSm = 0;
    this.air = 0;
    this.atk = null;
    this.carry = 0; this.carrying = false;
    this.dead = false; this.deadT = 0;
    this.hurtT = 9;
    this.hp = 1;
    this.stepCb = null; this.lastFoot = 0;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._dir = new THREE.Vector3();
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

  hurt() {
    this.hurtT = 0;
    if (this.dead) return;
    const h = this.A.hit;
    h.reset(); h.paused = false; h.play();
  }

  // Mage (voie Élémentaire) : la flamme du bâton devient bleue en mode glace
  setElement(el) {
    this.element = el;
    if (this.flame) this.flame.material.color.set(el === 'ice' ? '#7fd8ff' : '#ffffff');
  }
  // Voleuse (voie Sentinelle) : une orbe tourne autour du personnage
  setSentinel(on) {
    if (!!this.sentOrb === on) return;
    if (!on) { this.root.remove(this.sentOrb); this.sentOrb = null; return; }
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(170,120,255,0.95)'); g.addColorStop(1, 'rgba(110,60,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    this.sentOrb = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sentOrb.scale.setScalar(0.45);
    this.root.add(this.sentOrb);
  }
  // Larme de la cascade : l'épée brille en bleu
  setPower(on) {
    if (this.power === on) return;
    this.power = on;
    for (const m of this.glowMats) { m.emissive.set(on ? '#2ab4ff' : '#000000'); m.emissiveIntensity = on ? 0.9 : 1; }
    this.trail.mesh.material.uniforms.uCol.value.set(on ? 0x40c8ff : 0xd9edff);
  }

  die() {
    this.dead = true; this.deadT = 0; this.atk = null;
    const d = this.A.death;
    d.reset(); d.paused = false; d.play();
  }
  revive() {
    this.dead = false;
    this.A.death.stop(); this.A.death.weight = 0;
    this.A.death.play(); this.A.death.paused = true;
    this.body.rotation.set(0, 0, 0); this.body.position.set(0, 0, 0);
  }

  // Dash : petite roulade dans la direction (0 avant, 1 arrière, 2 gauche, 3 droite)
  startDodge(dir = 0) {
    const a = this.dodgeActs[dir] || this.dodgeActs[0];
    this.dodge = { a, t: 0 };
    a.reset(); a.paused = false; a.timeScale = 1.6; a.play();
  }
  flip() { this.flipT = 0; }
  // assommé par un coup de poing : tombe et roule par terre
  knock(dur = 2) {
    this.knockT = 0; this.knockDur = dur;
    const d = this.knockAct || (this.knockAct = this.mixer.clipAction(getClip(this.animations, 'Death_B')));
    d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true;
    d.reset(); d.timeScale = 1.6; d.play();
  }

  attack(kind, speed = 1) {
    if (this.atk || this.dead) return false;
    const def = ATTACKS[kind] || ATTACKS.slash;
    const v = def.variants[this.atkN++ % def.variants.length];
    this.atk = { kind, t: 0, def, v, act: this.atkActs[v.clip], pre: v.pre ? this.atkActs[v.pre.clip] : null, hitDone: false, sp: speed };
    this.setTool(def.tool);
    return true;
  }

  // speed en m/s ; renvoie true au moment où l'outil frappe
  update(dt, { speed = 0, grounded = true, lookYaw = 0 } = {}) {
    const t = (this.time += dt);
    if (this.dead) speed = 0;
    this.speedSm += (speed - this.speedSm) * (1 - Math.exp(-dt * 10));
    const sp = this.speedSm;
    this.air += ((grounded ? 0 : 1) - this.air) * (1 - Math.exp(-dt * 12));
    this.carry += ((this.carrying ? 1 : 0) - this.carry) * (1 - Math.exp(-dt * 8));

    // ---- Marche / course : poids des animations selon la vitesse ----
    const A = this.A;
    const move = clamp(sp / 1.5, 0, 1), run = clamp((sp - 4.6) / 2.6, 0, 1);
    const ground = 1 - this.air;
    A.idle.weight = (1 - move) * ground;
    A.walk.weight = move * (1 - run) * ground;
    A.run.weight = move * run * ground;
    A.air.weight = this.air;
    // les pieds suivent la vitesse réelle
    A.walk.timeScale = clamp(sp / 3.0, 0.6, 1.7);
    A.run.timeScale = clamp(sp / 7.0, 0.8, 1.4);
    // bruit de pas : deux fois par cycle
    const ref = run > 0.5 ? A.run : A.walk;
    const foot = Math.floor(ref.time / ref.getClip().duration * 2);
    if (this.stepCb && grounded && move > 0.5 && !this.dead && foot !== this.lastFoot) this.stepCb(run);
    this.lastFoot = foot;

    // ---- Coup reçu (haut du corps) ----
    this.hurtT += dt;
    A.hit.weight = this.dead ? 0 : (this.hurtT < this.hitDur ? Math.sin(Math.min(1, this.hurtT / this.hitDur) * Math.PI) * 4 : 0);

    // ---- Attaque : animation recalée sur le moment du coup ----
    let hitNow = false, trailOn = false;
    if (this.atk) {
      const a = this.atk;
      a.t += dt * a.sp;
      const p = a.t / a.def.dur;
      const h = a.def.hit, v = a.v, D = a.act.getClip().duration;
      for (const k in this.atkActs) this.atkActs[k].weight = 0;
      const w = ss(0, 0.1, p) * (1 - ss(0.85, 1, p)) * 30;
      if (a.pre && p < h) {
        // préparation (bander l'arc) avant le geste principal
        a.pre.time = v.pre.t0 + (p / h) * (v.pre.t1 - v.pre.t0);
        a.pre.weight = w;
      } else {
        const ct = p < h ? v.t0 + (p / h) * (v.strike - v.t0) : v.strike + Math.min(1, (p - h) / (1 - h)) * (v.t1 - v.strike);
        a.act.time = ((ct % D) + D) % D;
        a.act.weight = w;
      }
      if (!a.hitDone && p >= h) { a.hitDone = true; hitNow = true; }
      trailOn = (a.kind === 'slash' || a.kind === 'chop' || a.kind === 'cleave' || a.kind === 'staff') && p > h - 0.2 && p < h + 0.1;
      if (p >= 1) { this.atk = null; a.act.weight = 0; if (a.pre) a.pre.weight = 0; }
    } else for (const k in this.atkActs) this.atkActs[k].weight = 0;
    // parade
    this.blockK += ((this.blocking && !this.atk && !this.dead ? 1 : 0) - this.blockK) * Math.min(1, dt * 12);
    this.blockAct.weight = this.blockK * 30;

    // ---- Dash ----
    if (this.dodge) {
      this.dodge.t += dt;
      const k = this.dodge.t / 0.3;
      this.dodge.a.weight = k < 1 ? Math.sin(Math.min(1, k) * Math.PI) * 60 + 1 : 0;
      if (k >= 1) { this.dodge.a.weight = 0; this.dodge = null; }
    }
    // ---- Salto du double saut ----
    this.flipT += dt;
    // ---- Assommé ----
    if (this.knockAct) {
      if (this.knockT != null && this.knockT < this.knockDur) {
        this.knockT += dt;
        const k = this.knockT, D = this.knockDur;
        this.knockAct.weight = (k < 0.15 ? k / 0.15 : k > D - 0.4 ? Math.max(0, (D - k) / 0.4) : 1) * 200;
        // roule sur le côté pendant la première seconde
        this.body.rotation.z = k < 0.9 ? ss(0, 0.9, k) * Math.PI * 2 : 0;
        this._knocked = true;
      } else if (this._knocked) { this.knockAct.weight = 0; this.body.rotation.z = 0; this._knocked = false; }
    }
    if (this.flipT < 0.5 || this._flipping) {
      // rotation autour des hanches (≈ 0,9 m)
      const ang = this.flipT < 0.42 && !this.dead ? ss(0, 0.42, this.flipT) * Math.PI * 2 : 0, c = 0.9;
      this.body.rotation.x = ang;
      this.body.position.set(0, c - c * Math.cos(ang), -c * Math.sin(ang));
      this._flipping = ang !== 0;
    }

    // ---- Mort ----
    if (this.dead) {
      this.deadT += dt;
      A.death.weight = 1000;
    } else A.death.weight = 0;

    // la tête repart toujours de sa pose animée (sinon la rotation du regard s'accumule)
    if (this._headQ) this.B.head.quaternion.copy(this._headQ);
    this.mixer.update(dt);
    (this._headQ ||= new THREE.Quaternion()).copy(this.B.head.quaternion);
    this.root.updateMatrixWorld(true);

    // ---- Retouches après l'animation ----
    this.lookSm = (this.lookSm || 0) + ((this.dead ? 0 : clamp(lookYaw, -0.8, 0.8)) - (this.lookSm || 0)) * Math.min(1, dt * 8);
    if (Math.abs(this.lookSm) > 0.001) {
      rotateBoneWorld(this.B.head, this._up, this.lookSm);
      this.B.head.updateMatrixWorld(true);
    }
    // porter le Joyau à deux mains, devant soi
    if (this.carry > 0.01 && !this.dead) {
      const yaw = this.root.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      for (const s of [1, -1]) {
        const up = s > 0 ? this.B.upL : this.B.upR, lo = s > 0 ? this.B.loL : this.B.loR;
        aimBone(up, this._dir.set(fx * 0.8 + rx * s * 0.25, -0.5, fz * 0.8 + rz * s * 0.25).normalize(), this.carry);
        aimBone(lo, this._dir.set(fx * 0.75 - rx * s * 0.5, 0.2, fz * 0.75 - rz * s * 0.5).normalize(), this.carry);
      }
    }

    // ---- Outil : petite apparition quand on change, caché quand on porte le joyau ----
    this.toolPop = Math.min(1, this.toolPop + dt * 6);
    const tl = this.tools[this.tool];
    tl.scale.setScalar(Math.max(0.001, ss(0, 1, this.toolPop) * (1 - this.carry)));
    tl.visible = this.carry < 0.95;
    if (this.shield) this.shield.visible = this.carry < 0.5;
    if (this.flame) this.flame.scale.setScalar(0.45 + Math.sin(t * 13) * 0.05 + Math.sin(t * 7.1) * 0.05);
    if (this.sentOrb) {
      const fast = this.skillFx?.s === 'sentinel' && performance.now() < this.skillFx.until;
      this.orbA = (this.orbA || 0) + dt * (fast ? 7 : 2.5);
      this.sentOrb.position.set(Math.cos(this.orbA) * 0.95, 1.75 + Math.sin(t * 3) * 0.12, Math.sin(this.orbA) * 0.95);
      this.sentOrb.scale.setScalar(fast ? 0.6 : 0.45);
    }

    // ---- Flash rouge quand on est touché ----
    const flash = this.hurtT < 0.2 ? 1 - this.hurtT / 0.2 : 0;
    // aura de la compétence de classe active (skillFx = { s, until } posé par main.js)
    const AU = this.skillFx && performance.now() < this.skillFx.until ? AURA[this.skillFx.s] : null;
    if (flash > 0 || this.flashing || AU || this.auraOn) {
      const k = AU && AU[3] ? 0.5 + 0.5 * Math.sin(t * 18) : 1;   // la Rage clignote
      for (const m of this.mats) {
        if (flash > 0) m.emissive.setRGB(flash * 0.6, 0, 0);
        else if (AU) m.emissive.setRGB(AU[0] * k, AU[1] * k, AU[2] * k);
        else m.emissive.setRGB(0, 0, 0);
      }
      this.flashing = flash > 0; this.auraOn = !!AU;
    }

    // ---- Traînée de l'arme (en coordonnées du monde) ----
    tl.updateMatrixWorld(true);
    this._a.copy(this.bladeBase).applyMatrix4(tl.matrixWorld);
    this._b.set(0, (tl.userData.len || 1) * 0.85, 0).applyMatrix4(tl.matrixWorld);
    this.trail.update(t, this._a, this._b, trailOn);

    return hitNow;
  }

  // Position du joyau porté (devant la poitrine)
  carryPoint(out) {
    out.set(0, 1.12, 0.5);
    return this.root.localToWorld(out);
  }

  dispose(scene) {
    scene.remove(this.root);
    scene.remove(this.trail.mesh);
    this.mixer.stopAllAction();
    for (const m of this.mats) m.dispose();
  }
}
