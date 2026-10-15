// Les monstres de la nuit : squelettes du pack KayKit Skeletons, animés.
// Rôdeur = squelette de base avec une lame, Griffu = squelette encapuchonné (rapide),
// Mage = squelette au chapeau qui lance des sorts avec son bâton,
// Tank = guerrier en armure avec hache et bouclier (à partir de la nuit 8).
// Ils sortent du sol en apparaissant ; à leur mort, la tête se détache, tombe et roule.
import * as THREE from 'three';
import { heightAt, MONSTERS, isWater } from './world.js';
import { skinnedModel, staticGeometry, modelMaterial, KK } from './models.js';
import { getClip } from './character.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Apparence de chaque sorte de monstre
// atk : animation d'attaque (t0 = début joué, strike = seconde du coup, t1 = fin)
const LOOK = {
  brute: { model: 'Skeleton_Minion', size: 1.0, right: 's_Blade', left: null, idle: 'Skeletons_Idle', move: 'Skeletons_Walking', gait: 2.0,
    atk: { clip: 'Melee_1H_Attack_Slice_Diagonal', t0: 0.1, strike: 0.42, t1: 0.95 } },
  runner: { model: 'Skeleton_Rogue', size: 0.83, right: 's_Blade', left: null, idle: 'Idle_B', move: 'Running_A', gait: 6.0,
    atk: { clip: 'Melee_1H_Attack_Stab', t0: 0.05, strike: 0.38, t1: 0.95 } },
  spitter: { model: 'Skeleton_Mage', size: 1.0, right: 's_Staff', left: null, idle: 'Skeletons_Idle', move: 'Skeletons_Walking', gait: 1.8,
    atk: { clip: 'Ranged_Magic_Shoot', t0: 0.0, strike: 0.42, t1: 0.92 } },
  tank: { model: 'Skeleton_Warrior', size: 1.38, right: 's_Axe', left: 's_Shield_Large_A', idle: 'Melee_Blocking', move: 'Walking_A', gait: 2.4,
    atk: { clip: 'Melee_1H_Attack_Chop', t0: 0.15, strike: 0.58, t1: 1.05 } },
};

// Lueur ronde (sorts)
const SHARED = {};
function sharedMats() {
  if (SHARED.glowTex) return SHARED;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  SHARED.glowTex = new THREE.CanvasTexture(c);
  return SHARED;
}

// Morceaux de la tête (triangles portés par l'os « head »), exprimés dans le repère de cet os
function headPieces(scene, headBone) {
  const out = [];
  scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const sk = mesh.skeleton;
    const hi = sk.bones.indexOf(headBone);
    if (hi < 0) return;
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const sj = src.attributes.skinIndex, sw = src.attributes.skinWeight, pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv;
    const dom = (i) => { let b = -1, bw = 0; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; b = sj.getComponent(i, k); } } return b; };
    const P = [], N = [], U = [];
    const toBone = new THREE.Matrix4().multiplyMatrices(sk.boneInverses[hi], mesh.bindMatrix);
    const nm = new THREE.Matrix3().getNormalMatrix(toBone);
    const v = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      if (dom(t) !== hi || dom(t + 1) !== hi || dom(t + 2) !== hi) continue;
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, t + k).applyMatrix4(toBone); P.push(v.x, v.y, v.z);
        v.fromBufferAttribute(nor, t + k).applyMatrix3(nm).normalize(); N.push(v.x, v.y, v.z);
        U.push(uv ? uv.getX(t + k) : 0, uv ? uv.getY(t + k) : 0);
      }
    }
    if (!P.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.computeBoundingSphere();
    out.push({ geo: g, mat: mesh.material, src: mesh });
  });
  return out;
}
// une fois par modèle
const headCache = new Map();

// Arme tenue dans une main (poignée à l'origine)
function weapon(name, mat) {
  const m = new THREE.Mesh(staticGeometry(name), mat);
  m.castShadow = true;
  return m;
}

export class MonsterRig {
  constructor(kind = 'brute') {
    sharedMats();
    const look = LOOK[kind] || LOOK.brute;
    this.kind = kind;
    this.look = look;
    const base = MONSTERS[kind] || MONSTERS.brute;
    // taille à l'écran (le Griffu reste assez grand pour être bien vu)
    this.T = { ...base, scale: look.size };
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    const { scene, animations } = skinnedModel(look.model);
    this.model = scene;
    scene.scale.setScalar(KK * look.size);
    this.body.add(scene);

    // matériaux propres à ce monstre (flash quand il est touché, brûlure, givre)
    this.mats = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.isSkinnedMesh) o.frustumCulled = false;
      o.material = o.material.clone();
      if (o.material.name !== 'Glow') this.mats.push(o.material);
    });
    this.headBone = scene.getObjectByName('head');
    if (!headCache.has(look.model)) headCache.set(look.model, headPieces(scene, this.headBone).map((p) => ({ geo: p.geo, name: p.src.name })));
    // les morceaux de tête de CE monstre (avec ses matériaux)
    this.head = headCache.get(look.model).map((p) => ({ geo: p.geo, mesh: scene.getObjectByName(p.name) }));

    // armes
    this.weaponMat = modelMaterial('s_Blade').clone();
    this.mats.push(this.weaponMat);
    const hr = scene.getObjectByName('handslotr'), hl = scene.getObjectByName('handslotl');
    if (look.right && hr) hr.add(weapon(look.right, this.weaponMat));
    if (look.left && hl) hl.add(weapon(look.left, this.weaponMat));
    // bout du bâton du mage (d'où partent les sorts)
    if (kind === 'spitter' && hr) {
      const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: SHARED.glowTex, color: 0xc070ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      staticGeometry(look.right).computeBoundingBox();
      orb.position.set(0, staticGeometry(look.right).boundingBox.max.y * 0.92, 0);
      orb.scale.setScalar(0.7);
      hr.add(orb);
      this.orb = orb;
    }

    // animations
    this.mixer = new THREE.AnimationMixer(scene);
    const act = (clip, loop = true) => { const a = this.mixer.clipAction(clip); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.play(); a.weight = 0; return a; };
    this.A = {
      idle: act(getClip(animations, look.idle)),
      move: act(getClip(animations, look.move)),
      attack: act(getClip(animations, look.atk.clip), false),
      hit: act(getClip(animations, 'Hit_A', true), false),
      death: act(getClip(animations, 'Death_A'), false),
      spawn: act(getClip(animations, 'Spawn_Ground'), false),
    };
    this.A.idle.weight = 1;
    for (const k of ['attack', 'hit', 'death']) this.A[k].paused = true;
    this.atkDur = this.A.attack.getClip().duration;
    this.hitDur = this.A.hit.getClip().duration;
    this.spawnDur = this.A.spawn.getClip().duration;
    this.A.idle.time = Math.random() * 2;
    this.A.move.time = Math.random() * 2;

    // barre de vie
    const c = document.createElement('canvas');
    c.width = 128; c.height = 16;
    this.barCtx = c.getContext('2d');
    this.barTex = new THREE.CanvasTexture(c);
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, depthTest: false, transparent: true }));
    this.bar.position.y = 2.3 * look.size;
    this.bar.scale.set(1.0, 0.125, 1);
    this.bar.renderOrder = 10;
    this.bar.visible = false;
    this.root.add(this.bar);

    this.time = Math.random() * 10;
    this.speedSm = 0;
    this.lastFoot = 0;
    this.atkT = 9; this.hurtT = 9; this.deadT = -1; this.spawnT = 0; this.burn = 0;
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
  hurt() {
    this.hurtT = 0;
    if (this.deadT >= 0) return;
    const h = this.A.hit; h.reset(); h.paused = false; h.play();
  }
  die(burn) {
    this.deadT = 0; this.burn = burn ? 0.01 : 0; this.bar.visible = false;
    const d = this.A.death; d.reset(); d.paused = false; d.play();
    this.headOff = false;
  }

  // La tête (et son chapeau / sa capuche / son casque) se détache et tombe en roulant
  dropHead() {
    this.headOff = true;
    const parent = this.root.parent;
    if (!this.head.length || !parent) return;
    const skull = new THREE.Group();
    this.headBone.updateWorldMatrix(true, false);
    this.headBone.matrixWorld.decompose(skull.position, skull.quaternion, skull.scale);
    for (const p of this.head) {
      const m = new THREE.Mesh(p.geo, p.mesh.material);
      m.castShadow = true;
      skull.add(m);
    }
    // objets accrochés à la tête (chapeau, capuche, casque)
    for (const ch of [...this.headBone.children]) if (ch.isMesh) skull.add(ch);
    parent.add(skull);
    const box = new THREE.Box3().setFromObject(skull);
    const yaw = this.root.rotation.y, side = Math.random() < 0.5 ? -1 : 1;
    this.skull = {
      mesh: skull,
      vel: new THREE.Vector3(Math.cos(yaw) * side * 1.2 - Math.sin(yaw) * 0.8, 3.4, -Math.sin(yaw) * side * 1.2 - Math.cos(yaw) * 0.8),
      spin: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 10),
      r: Math.max(0.12, (box.max.y - box.min.y) * 0.35),
      base: skull.scale.x,
      bounces: 0,
    };
  }

  updateSkull(dt, sink) {
    const s = this.skull;
    if (!s) return null;
    const m = s.mesh;
    s.vel.y -= 16 * dt;
    m.position.addScaledVector(s.vel, dt);
    const gy = heightAt(m.position.x, m.position.z) + s.r - sink * 0.6;
    let thump = false;
    if (m.position.y < gy) {
      m.position.y = gy;
      if (s.vel.y < -1) { s.vel.y *= -0.35; thump = s.bounces++ === 0; } else s.vel.y = 0;
      s.vel.x *= 0.75; s.vel.z *= 0.75;
      // roule sur le sol
      s.spin.set(s.vel.z / s.r, s.spin.y * 0.8, -s.vel.x / s.r);
    }
    m.rotation.x += s.spin.x * dt; m.rotation.y += s.spin.y * dt; m.rotation.z += s.spin.z * dt;
    if (sink > 0) m.scale.setScalar(s.base * (1 - sink * 0.6));
    return thump;
  }

  disposeSkull() {
    if (this.skull) { this.skull.mesh.parent?.remove(this.skull.mesh); this.skull = null; }
  }

  // Renvoie des événements pour les sons : { step, strike, spit, deathThud, skull, gone, smoke }
  update(dt, speed) {
    this.time += dt;
    const ev = {};
    const A = this.A, look = this.look;
    this.speedSm += (speed - this.speedSm) * (1 - Math.exp(-dt * 6));
    const sp = this.speedSm;
    const move = clamp(sp / 1.2, 0, 1);
    const slow = this.frost ? 0.55 : 1;

    // sortie du sol
    this.spawnT += dt;
    const spawning = this.spawnT < this.spawnDur;
    A.spawn.weight = spawning ? 1000 : 0;
    if (spawning) A.spawn.time = Math.min(this.spawnT, this.spawnDur - 0.001);
    A.spawn.paused = true;

    // marche / course
    A.idle.weight = 1 - move;
    A.move.weight = move;
    A.move.timeScale = clamp(sp / (look.gait * look.size), 0.5, 1.8) * slow;
    const foot = Math.floor(A.move.time / A.move.getClip().duration * 2);
    if (move > 0.5 && this.deadT < 0 && foot !== this.lastFoot) ev.step = true;
    this.lastFoot = foot;

    // attaque (le moment du coup est calé sur celui du serveur pour chaque sorte de monstre)
    const prevAtk = this.atkT;
    this.atkT += dt * (0.5 / this.T.hitAt) * slow;
    if (this.atkT < 1.1 && this.deadT < 0) {
      const p = this.atkT;
      const k = look.atk;
      A.attack.time = Math.min(this.atkDur - 0.001, p < 0.5 ? k.t0 + (p / 0.5) * (k.strike - k.t0) : k.strike + Math.min(1, (p - 0.5) / 0.6) * (k.t1 - k.strike));
      A.attack.weight = ss(0, 0.12, p) * (1 - ss(0.85, 1.1, p)) * 30;
      if (prevAtk < 0.5 && p >= 0.5) { if (this.kind === 'spitter') ev.spit = true; else ev.strike = true; }
    } else A.attack.weight = 0;

    // coup reçu
    this.hurtT += dt;
    A.hit.weight = this.deadT < 0 && this.hurtT < this.hitDur ? Math.sin(Math.min(1, this.hurtT / this.hitDur) * Math.PI) * 4 : 0;

    // brûlure au lever du jour
    if (this.burn > 0) this.burn = Math.min(1, this.burn + dt * 0.8);

    // mort : s'effondre, la tête tombe, puis il s'enfonce dans le sol
    let sink = 0;
    if (this.deadT >= 0) {
      this.deadT += dt;
      const d = this.deadT;
      A.death.weight = 2000;
      if (!this.headOff && d > 0.2) { this.dropHead(); if (this.skull) ev.skullOff = true; }
      if (d - dt < 0.6 && d >= 0.6) ev.deathThud = true;
      sink = ss(2.2, 3.6, d);
    } else A.death.weight = 0;

    this.mixer.update(dt);
    // tête cachée sur le corps une fois tombée
    if (this.headOff && this.skull) this.headBone.scale.setScalar(0.001);

    this.body.position.y = -sink * 1.0;

    // couleurs : flash blanc quand touché, rougeoiement quand il brûle, bleu quand gelé
    const flash = this.hurtT < 0.25 ? Math.pow(1 - this.hurtT / 0.25, 1.5) : 0;
    const ice = this.frost ? 0.2 : 0;
    // en feu (bâton du mage) : lueur orange qui vacille
    this.fireT = Math.max(0, (this.fireT || 0) - dt);
    const fire = this.fireT > 0 ? 0.35 + Math.sin(this.time * 17) * 0.12 : 0;
    for (const m of this.mats) m.emissive.setRGB(flash * 0.9 + this.burn * 0.9 + fire, flash * 0.9 + this.burn * 0.3 + ice * 0.5 + fire * 0.35, flash * 0.9 + ice);
    if (this.orb) this.orb.material.opacity = this.deadT >= 0 ? 0 : 0.55 + Math.sin(this.time * 5) * 0.15 + (this.atkT < 0.6 ? Math.sin(this.atkT / 0.6 * Math.PI) * 0.4 : 0);

    if (this.updateSkull(dt, sink)) ev.skull = true;

    ev.gone = this.deadT > 3.6;
    ev.smoke = (this.deadT > 2.0 && this.deadT < 3.5) || this.burn > 0.2 || this.spawnT < 1.0;
    if (ev.gone) this.disposeSkull();
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
    for (const m of this.map.values()) { this.scene.remove(m.rig.root); m.rig.disposeSkull(); }
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

  // Monstre visé par la caméra (tir à l'arc) : le plus proche de la ligne de visée
  findAlongAim(pos, camera, range) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const o = camera.position, v = new THREE.Vector3();
    let best = null, bs = Infinity;
    for (const m of this.map.values()) {
      if (m.dead || m.rig.spawnT < 1) continue;
      const p = m.rig.root.position;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) > range) continue;
      v.set(p.x - o.x, p.y + 1.0 - o.y, p.z - o.z);
      const along = v.dot(dir);
      if (along <= 0) continue;
      const perp = Math.sqrt(Math.max(0, v.lengthSq() - along * along));
      if (perp > 1.0 + along * 0.06) continue;
      const score = perp + along * 0.02;
      if (score < bs) { bs = score; best = m; }
    }
    return best;
  }

  // Monstre enflammé par le mage
  ignite(id, t) {
    const m = this.map.get(id);
    if (!m || m.dead) return;
    m.rig.fireT = Math.max(m.rig.fireT || 0, t);
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
      this.ballMat = new THREE.MeshBasicMaterial({ color: 0xd8a0ff });
      this.dropMat = new THREE.MeshBasicMaterial({ color: 0xa050ff, transparent: true, opacity: 0.8 });
    }
    const ball = new THREE.Mesh(this.ballGeo, this.ballMat);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedMats().glowTex, color: 0xb060ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
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
        this.fx.puff(p, 0x9a50e0, 5, 0.6);
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
      if (m.rig.fireT > 0 && Math.random() < dt * 30) {
        const r = root.position;
        this.fx.spawn({
          geo: this.fx.box, mat: (this.flameMats ||= ['#ffd060', '#ff8a20', '#ff4a10'].map((c) => new THREE.MeshBasicMaterial({ color: c })))[Math.floor(Math.random() * 3)],
          pos: new THREE.Vector3(r.x + (Math.random() - 0.5) * 0.6, r.y + 0.3 + Math.random() * 1.3, r.z + (Math.random() - 0.5) * 0.6),
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2 + Math.random(), (Math.random() - 0.5) * 0.4),
          size: 0.06 + Math.random() * 0.06, life: 0.5, gravity: -1.5, drag: 1, spin: 5,
        });
      }
      if (ev.step) {
        this.audio?.play(isWater(root.position.x, root.position.z) ? 'splashStep' : 'monsterStep', root.position);
      }
      if (ev.deathThud) this.audio?.play('thud', root.position);
      if (ev.skull && m.rig.skull) this.audio?.play('skullDrop', m.rig.skull.mesh.position);
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
