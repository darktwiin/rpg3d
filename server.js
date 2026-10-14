// ============================================================================
// Serveur du jeu : lobby et groupes (max 4 joueurs), et pour chaque partie :
// cycle jour/nuit, arbres et rochers, inventaires, constructions, joyau,
// monstres (IA), dégâts, chat et commandes admin (/god).
// ============================================================================
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as W from './public/js/world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const TICK = 0.1;                       // 10 mises à jour par seconde
const RES_RESPAWN_S = 25;               // délai avant qu'un nouvel arbre / rocher pousse ailleurs
const MONSTER_SPEED = 2.7;
const MONSTER_ATK_CD = 1.7;
const MONSTER_HIT_AT = 0.5;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lib/three', express.static(path.join(__dirname, 'node_modules', 'three')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const COLORS = [0x2e6fd8, 0xc0392b, 0x27ae60, 0xd4a017];
const rooms = new Map();
let nextPlayerId = 1;

const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

// ============================================================================
class Room {
  constructor(code, solo) {
    this.code = code;
    this.solo = solo;
    this.players = new Map();
    this.hostId = null;
    this.started = false;
    this.interval = null;
    this.gen = 0;
    this.reset();
  }

  reset() {
    this.gen++;
    this.seed = Math.floor(Math.random() * 1e9);
    this.resources = new Map(W.generateResources(this.seed).map((r) => [r.id, { ...r, hp: r.k === 't' ? W.TREE_HP : W.ROCK_HP }]));
    this.resN = 10000;
    this.rand = W.seededRandom(this.seed + 7);
    this.buildings = new Map();
    this.bN = 1;
    this.monsters = new Map();
    this.mN = 1;
    this.gem = { x: W.GEM_HOME.x, z: W.GEM_HOME.z, y: null, carrier: null, hp: W.GEM_HP };
    this.time = W.START_TIME;
    this.night = 0;
    this.survived = 0;
    this.toSpawn = 0; this.spawnT = 0;
    this.over = false;
    this.syncT = 0; this.gemSyncT = 0; this.lastGemHp = this.gem.hp;
    for (const p of this.players.values()) this.resetPlayer(p);
  }

  resetPlayer(p) {
    p.hp = W.PLAYER_HP; p.dead = false;
    p.inv = { wood: 0, stone: 0 };
    const a = Math.random() * Math.PI * 2;
    p.x = Math.cos(a) * 3; p.z = Math.sin(a) * 3; p.y = W.heightAt(p.x, p.z);
    p.lastDamage = 0;
  }

  isNight() { return this.time >= W.DAY_LEN; }

  broadcast(obj, except) {
    const msg = JSON.stringify(obj);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(msg);
  }
  sys(text, kind = 'sys') { this.broadcast({ type: 'chat', sys: kind, text }); }

  pub(p) {
    return { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, ry: p.ry || 0, s: 0, g: true, tl: p.tl || 0, hp: p.hp, dead: p.dead };
  }
  lobbyState() {
    return {
      type: 'room', code: this.code, solo: this.solo, started: this.started, host: this.hostId,
      members: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })),
    };
  }
  sendLobby() { this.broadcast(this.lobbyState()); }

  welcome(p) {
    send(p.ws, {
      type: 'welcome', you: this.pub(p), code: this.code, solo: this.solo, host: this.hostId,
      players: [...this.players.values()].filter((o) => o !== p).map((o) => this.pub(o)),
      resources: [...this.resources.values()],
      buildings: [...this.buildings.values()],
      monsters: [...this.monsters.values()].filter((m) => !m.dead).map((m) => ({ id: m.id, x: m.x, z: m.z, ry: m.ry, hp: m.hp })),
      gem: this.gem, clock: { time: this.time, night: this.night }, inv: p.inv, survived: this.survived,
    });
  }

  addPlayer(p) {
    const used = new Set([...this.players.values()].map((o) => o.color));
    p.color = COLORS.find((c) => !used.has(c)) ?? COLORS[0];
    p.room = this;
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    this.resetPlayer(p);
    if (this.started) {
      this.welcome(p);
      this.broadcast({ type: 'join', player: this.pub(p) }, p);
      this.sys(`${p.name} a rejoint la partie`);
    }
    this.sendLobby();
  }

  removePlayer(p) {
    this.players.delete(p.id);
    if (this.gem.carrier === p.id) this.dropGem(p.x, p.z, null);
    if (this.hostId === p.id) this.hostId = this.players.keys().next().value ?? null;
    if (this.started) {
      this.broadcast({ type: 'leave', id: p.id });
      this.sys(`${p.name} a quitté la partie`);
      this.broadcast({ type: 'host', host: this.hostId });
    }
    this.sendLobby();
    if (this.players.size === 0) {
      setTimeout(() => { if (this.players.size === 0) this.destroy(); }, 30000);
    }
  }

  destroy() {
    clearInterval(this.interval);
    rooms.delete(this.code);
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const p of this.players.values()) this.welcome(p);
    this.sendLobby();
    this.interval = setInterval(() => this.tick(TICK), TICK * 1000);
    this.sys('La partie commence ! Récoltez du bois et de la pierre, et protégez le Joyau avant la nuit.', 'info');
  }

  // ---------------- Boucle principale ----------------
  tick(dt) {
    if (this.over) return;
    const now = Date.now() / 1000;
    const wasNight = this.isNight();
    this.time += dt;
    if (!wasNight && this.isNight()) this.startNight();
    if (this.time >= W.CYCLE) { this.time -= W.CYCLE; this.startDay(); }

    // Apparition progressive des monstres pendant la nuit
    if (this.toSpawn > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.toSpawn--;
        this.spawnT = this.spawnGap;
        this.spawnMonsterEdge();
      }
    }

    // Joueurs : régénération
    for (const p of this.players.values()) {
      if (p.dead || p.hp >= W.PLAYER_HP) continue;
      if (now - p.lastDamage > 6) {
        p.hp = Math.min(W.PLAYER_HP, p.hp + 4 * dt);
        p.regenT = (p.regenT || 0) - dt;
        if (p.regenT <= 0 || p.hp >= W.PLAYER_HP) { p.regenT = 1; this.broadcast({ type: 'pHp', id: p.id, hp: Math.round(p.hp) }); }
      }
    }
    // Le joyau se répare doucement le jour
    if (!this.isNight() && this.gem.hp < W.GEM_HP) this.gem.hp = Math.min(W.GEM_HP, this.gem.hp + 2 * dt);
    this.gemSyncT -= dt;
    if (this.gemSyncT <= 0 && Math.round(this.gem.hp) !== Math.round(this.lastGemHp)) {
      this.gemSyncT = 1;
      this.lastGemHp = this.gem.hp;
      this.broadcast({ type: 'gem', gem: this.gem });
    }

    this.updateMonsters(dt, now);

    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 5; this.broadcast({ type: 'clock', time: this.time, night: this.night }); }
  }

  startNight() {
    this.night++;
    const n = this.players.size;
    const count = Math.round((3 + this.night * 2) * (0.7 + 0.3 * n));
    this.toSpawn = count;
    this.spawnGap = (W.NIGHT_LEN * 0.45) / count;
    this.spawnT = 3;
    this.broadcast({ type: 'clock', time: this.time, night: this.night });
    this.broadcast({ type: 'phase', phase: 'night', night: this.night });
    this.sys(`🌙 Nuit ${this.night} — ${count} monstres approchent. Défendez le Joyau !`, 'night');
  }

  startDay() {
    this.toSpawn = 0;
    if (this.night > 0) this.survived = this.night;
    for (const m of this.monsters.values()) if (!m.dead) this.killMonster(m, true);
    this.broadcast({ type: 'clock', time: this.time, night: this.night });
    this.broadcast({ type: 'phase', phase: 'day', night: this.night, survived: this.survived });
    if (this.night > 0) this.sys(`☀️ Le jour se lève. Vous avez survécu à la nuit ${this.night} !`, 'day');
  }

  // ---------------- Ressources ----------------
  hitResource(p, id) {
    const r = this.resources.get(String(id));
    if (!r || p.dead) return;
    const now = Date.now();
    if (now - (p.lastHit || 0) < 300) return;
    p.lastHit = now;
    if (Math.hypot(p.x - r.x, p.z - r.z) > 4 + W.resourceRadius(r)) return;
    r.hp--;
    const kind = r.k === 't' ? 'wood' : 'stone';
    let gain = 1;
    if (r.hp <= 0) gain += r.k === 't' ? 3 : 2;
    p.inv[kind] += gain;
    send(p.ws, { type: 'inv', inv: p.inv, gain: { [kind]: gain } });
    this.broadcast({ type: 'resHit', id: r.id, hp: r.hp, by: p.id, fx: p.x, fz: p.z });
    if (r.hp <= 0) {
      this.resources.delete(r.id);
      this.broadcast({ type: 'resDestroy', id: r.id, dx: r.x - p.x, dz: r.z - p.z });
      const gen = this.gen;
      setTimeout(() => { if (this.gen === gen) this.spawnResource(r.k); }, RES_RESPAWN_S * 1000);
    }
  }

  spawnResource(kind) {
    const list = [...this.resources.values()];
    const extra = [];
    for (const b of this.buildings.values()) extra.push({ x: b.x, z: b.z, r: 3 });
    for (const p of this.players.values()) extra.push({ x: p.x, z: p.z, r: 6 });
    extra.push({ x: this.gem.x, z: this.gem.z, r: 10 });
    for (let i = 0; i < 300; i++) {
      const x = (this.rand() * 2 - 1) * (W.WORLD_LIMIT - 4), z = (this.rand() * 2 - 1) * (W.WORLD_LIMIT - 4);
      if (!W.isFreeSpot(x, z, list, 2.2, extra)) continue;
      const r = W.makeResource(this.rand, 'n' + this.resN++, kind, x, z);
      r.hp = kind === 't' ? W.TREE_HP : W.ROCK_HP;
      this.resources.set(r.id, r);
      this.broadcast({ type: 'resSpawn', res: r });
      return;
    }
  }

  // ---------------- Construction ----------------
  build(p, d) {
    const type = String(d.piece);
    const piece = W.PIECES[type];
    if (!piece || p.dead) return;
    const x = num(d.x), z = num(d.z), y = num(d.y), rot = d.rot ? 1 : 0;
    if (Math.abs(x) > W.WORLD_LIMIT || Math.abs(z) > W.WORLD_LIMIT) return;
    if (Math.hypot(x - p.x, z - p.z) > W.BUILD_RANGE + 3) return;
    const key = W.slotKey(type, x, z, rot);
    for (const b of this.buildings.values()) if (W.slotKey(b.type, b.x, b.z, b.rot) === key) return;
    if (!p.free) {
      if (p.inv.wood < piece.cost.wood || p.inv.stone < piece.cost.stone) return;
      p.inv.wood -= piece.cost.wood; p.inv.stone -= piece.cost.stone;
      send(p.ws, { type: 'inv', inv: p.inv });
    }
    const b = { id: 'b' + this.bN++, type, x, z, y, rot, hp: piece.hp, max: piece.hp, state: 'building', by: p.id };
    this.buildings.set(b.id, b);
    this.broadcast({ type: 'bAdd', b });
    const gen = this.gen;
    setTimeout(() => {
      if (this.gen !== gen || !this.buildings.has(b.id)) return;
      b.state = 'done';
      this.broadcast({ type: 'bDone', id: b.id });
    }, W.BUILD_TIME * 1000);
  }

  demolish(p, id) {
    const b = this.buildings.get(String(id));
    if (!b || p.dead) return;
    if (Math.hypot(b.x - p.x, b.z - p.z) > W.BUILD_RANGE + 3) return;
    this.buildings.delete(b.id);
    const c = W.PIECES[b.type].cost;
    p.inv.wood += Math.floor(c.wood / 2); p.inv.stone += Math.floor(c.stone / 2);
    send(p.ws, { type: 'inv', inv: p.inv });
    this.broadcast({ type: 'bDel', id: b.id, broken: false });
  }

  damageBuilding(b, dmg) {
    b.hp -= dmg;
    if (b.hp <= 0) {
      this.buildings.delete(b.id);
      this.broadcast({ type: 'bDel', id: b.id, broken: true });
    } else this.broadcast({ type: 'bHit', id: b.id, hp: b.hp });
  }

  // ---------------- Joyau ----------------
  gemPos() {
    if (this.gem.carrier) {
      const c = this.players.get(this.gem.carrier);
      if (c) return { x: c.x, z: c.z };
    }
    return { x: this.gem.x, z: this.gem.z };
  }
  pickGem(p) {
    if (this.gem.carrier || p.dead) return;
    if (Math.hypot(p.x - this.gem.x, p.z - this.gem.z) > 3) return;
    this.gem.carrier = p.id;
    this.broadcast({ type: 'gem', gem: this.gem, ev: 'pick', by: p.id });
  }
  dropGem(x, z, y, p) {
    if (p && this.gem.carrier !== p.id) return;
    if (p && Math.hypot(x - p.x, z - p.z) > 3) { x = p.x; z = p.z; y = null; }
    this.gem.x = clamp(num(x), -W.WORLD_LIMIT, W.WORLD_LIMIT);
    this.gem.z = clamp(num(z), -W.WORLD_LIMIT, W.WORLD_LIMIT);
    this.gem.y = typeof y === 'number' && isFinite(y) ? y : null;
    this.gem.carrier = null;
    this.broadcast({ type: 'gem', gem: this.gem, ev: 'drop' });
  }
  damageGem(dmg) {
    this.gem.hp -= dmg;
    this.broadcast({ type: 'gemHit', hp: Math.max(0, Math.round(this.gem.hp)) });
    if (this.gem.hp <= 0 && !this.over) this.gameOver();
  }
  gameOver() {
    this.over = true;
    this.toSpawn = 0;
    this.broadcast({ type: 'gameOver', survived: this.survived });
    const gen = this.gen;
    setTimeout(() => {
      if (this.gen !== gen) return;
      this.reset();
      for (const p of this.players.values()) this.welcome(p);
      this.sys('Nouvelle partie ! Le Joyau est revenu à sa place.', 'info');
    }, 10000);
  }

  // ---------------- Joueurs ----------------
  damagePlayer(p, dmg, from) {
    if (p.dead || p.invuln || Date.now() < (p.protectUntil || 0)) return;
    p.hp -= dmg;
    p.lastDamage = Date.now() / 1000;
    this.broadcast({ type: 'pHp', id: p.id, hp: Math.max(0, Math.round(p.hp)), hurt: true, fx: from?.x, fz: from?.z });
    if (p.hp <= 0) {
      p.dead = true;
      if (this.gem.carrier === p.id) this.dropGem(p.x, p.z, null);
      this.broadcast({ type: 'pDie', id: p.id });
      this.sys(`💀 ${p.name} est tombé au combat`, 'warn');
      const gen = this.gen;
      setTimeout(() => {
        if (this.gen !== gen || !this.players.has(p.id)) return;
        const g = this.gemPos(), a = Math.random() * Math.PI * 2;
        p.x = g.x + Math.cos(a) * 2.5; p.z = g.z + Math.sin(a) * 2.5;
        p.hp = W.PLAYER_HP; p.dead = false;
        p.protectUntil = Date.now() + 3000;
        this.broadcast({ type: 'pRespawn', id: p.id, x: p.x, z: p.z });
      }, W.RESPAWN_DELAY * 1000);
    }
  }

  // ---------------- Monstres ----------------
  spawnMonsterEdge() {
    const g = this.gemPos();
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, d = 55 + Math.random() * 20;
      const x = clamp(g.x + Math.cos(a) * d, -W.WORLD_LIMIT + 2, W.WORLD_LIMIT - 2);
      const z = clamp(g.z + Math.sin(a) * d, -W.WORLD_LIMIT + 2, W.WORLD_LIMIT - 2);
      if (Math.hypot(x - g.x, z - g.z) < 35) continue;
      if ([...this.players.values()].some((p) => Math.hypot(p.x - x, p.z - z) < 15)) continue;
      return this.spawnMonster(x, z);
    }
  }
  spawnMonster(x, z) {
    const m = { id: 'm' + this.mN++, x, z, ry: 0, hp: W.MONSTER_HP, st: 0, cd: 2, hitAt: 0, atk: null, aggro: null, wake: 1.6, dead: false };
    this.monsters.set(m.id, m);
    this.broadcast({ type: 'mSpawn', m: { id: m.id, x, z, ry: 0, hp: m.hp } });
    return m;
  }
  killMonster(m, burn) {
    m.dead = true;
    this.monsters.delete(m.id);
    this.broadcast({ type: 'mDie', id: m.id, burn: !!burn });
  }
  hitMonster(p, id) {
    const m = this.monsters.get(String(id));
    if (!m || m.dead || p.dead) return;
    const now = Date.now();
    if (now - (p.lastSword || 0) < 300) return;
    p.lastSword = now;
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz);
    if (d > 3.4) return;
    m.hp -= W.SWORD_DMG;
    if (d > 0.01) { m.x += dx / d * 0.45; m.z += dz / d * 0.45; }
    m.aggro = p.id;
    m.cd = Math.max(m.cd, 0.4);
    this.broadcast({ type: 'mHurt', id: m.id, hp: Math.max(0, m.hp), by: p.id });
    if (m.hp <= 0) this.killMonster(m, false);
  }

  updateMonsters(dt, now) {
    if (!this.monsters.size) return;
    const alive = [...this.players.values()].filter((p) => !p.dead);
    const gp = this.gemPos();
    const walls = [...this.buildings.values()].filter((b) => b.type === 'wall');
    const list = [];
    for (const m of this.monsters.values()) {
      if (m.dead) continue;
      if (m.wake > 0) { m.wake -= dt; list.push([m.id, +m.x.toFixed(2), +m.z.toFixed(2), +m.ry.toFixed(2), 0]); continue; }
      m.cd -= dt;

      // Coup en cours : appliqué au milieu de l'animation
      if (m.atk && now >= m.hitAt) {
        const a = m.atk;
        m.atk = null;
        if (a.kind === 'gem') {
          const g = this.gemPos();
          if (Math.hypot(g.x - m.x, g.z - m.z) < 2.8) this.damageGem(W.MONSTER_DMG_GEM);
        } else if (a.kind === 'player') {
          const p = this.players.get(a.id);
          if (p && Math.hypot(p.x - m.x, p.z - m.z) < 2.4) this.damagePlayer(p, W.MONSTER_DMG_PLAYER, m);
        } else if (a.kind === 'wall') {
          const b = this.buildings.get(a.id);
          if (b) this.damageBuilding(b, W.MONSTER_DMG_BUILD);
        }
      }

      // Cible : le joyau, sauf si un joueur passe trop près
      let tx = gp.x, tz = gp.z, tr = 1.3, tk = { kind: 'gem' };
      let aggroP = m.aggro ? this.players.get(m.aggro) : null;
      if (aggroP && (aggroP.dead || Math.hypot(aggroP.x - m.x, aggroP.z - m.z) > 12)) { aggroP = null; m.aggro = null; }
      if (!aggroP) {
        let bd = 7;
        for (const p of alive) { const d = Math.hypot(p.x - m.x, p.z - m.z); if (d < bd) { bd = d; aggroP = p; } }
        if (aggroP) m.aggro = aggroP.id;
      }
      if (aggroP && this.gem.carrier !== aggroP.id) { tx = aggroP.x; tz = aggroP.z; tr = 0.4; tk = { kind: 'player', id: aggroP.id }; }

      const dx = tx - m.x, dz = tz - m.z, dist = Math.hypot(dx, dz);
      let st = 0;
      if (!m.atk) {
        if (dist <= 1.5 + tr) {
          if (m.cd <= 0) this.monsterAttack(m, tk, now);
          m.ry = Math.atan2(dx, dz);
        } else if (dist > 0.01) {
          const inWater = W.isWater(m.x, m.z);
          const sp = MONSTER_SPEED * (inWater ? 0.55 : 1);
          let nx = m.x + dx / dist * sp * dt, nz = m.z + dz / dist * sp * dt;
          // Un mur bloque le chemin : on le casse
          let blocking = null;
          for (const b of walls) {
            if (W.distToBox(nx, nz, W.wallBox(b)) < 0.5) { blocking = b; break; }
          }
          if (blocking) {
            if (m.cd <= 0) this.monsterAttack(m, { kind: 'wall', id: blocking.id }, now);
            const bx = blocking.x - m.x, bz = blocking.z - m.z;
            m.ry = Math.atan2(bx, bz);
          } else {
            m.x = nx; m.z = nz; st = 1;
            m.ry = Math.atan2(dx, dz);
          }
        }
      }
      // Contourne arbres et rochers, s'écarte des autres monstres
      for (const r of this.resources.values()) {
        const rr = W.resourceRadius(r) + 0.45;
        const ex = m.x - r.x, ez = m.z - r.z;
        if (Math.abs(ex) > rr || Math.abs(ez) > rr) continue;
        const d = Math.hypot(ex, ez);
        if (d < rr && d > 0.001) { m.x = r.x + ex / d * rr; m.z = r.z + ez / d * rr; }
      }
      for (const o of this.monsters.values()) {
        if (o === m || o.dead) continue;
        const ex = m.x - o.x, ez = m.z - o.z, d = Math.hypot(ex, ez);
        if (d < 1.0 && d > 0.001) { m.x += ex / d * (1.0 - d) * 0.5; m.z += ez / d * (1.0 - d) * 0.5; }
      }
      m.x = clamp(m.x, -W.WORLD_LIMIT, W.WORLD_LIMIT); m.z = clamp(m.z, -W.WORLD_LIMIT, W.WORLD_LIMIT);
      list.push([m.id, +m.x.toFixed(2), +m.z.toFixed(2), +m.ry.toFixed(2), m.atk ? 2 : st]);
    }
    this.broadcast({ type: 'm', l: list });
  }
  monsterAttack(m, target, now) {
    m.atk = target;
    m.hitAt = now + MONSTER_HIT_AT;
    m.cd = MONSTER_ATK_CD;
    this.broadcast({ type: 'mAtk', id: m.id });
  }

  // ---------------- Chat et admin ----------------
  chat(p, text) {
    text = String(text || '').trim().slice(0, 200);
    if (!text) return;
    if (text.startsWith('/')) return this.command(p, text);
    this.broadcast({ type: 'chat', from: p.name, color: p.color, text });
  }
  command(p, text) {
    const cmd = text.split(/\s+/)[0].toLowerCase();
    if (cmd === '/god') {
      if (!(this.solo || p.id === this.hostId)) return send(p.ws, { type: 'chat', sys: 'warn', text: "Seul l'hôte de la partie peut utiliser /god." });
      p.god = true;
      send(p.ws, { type: 'god', on: true, invuln: !!p.invuln, free: !!p.free });
      return;
    }
    if (cmd === '/aide' || cmd === '/help') {
      return send(p.ws, { type: 'chat', sys: 'info', text: 'Commandes : /god (hôte : panneau admin), /aide' });
    }
    send(p.ws, { type: 'chat', sys: 'warn', text: `Commande inconnue : ${cmd}` });
  }
  admin(p, d) {
    if (!p.god) return;
    switch (d.cmd) {
      case 'spawn': {
        const n = clamp(Math.floor(num(d.n, 1)), 1, 10);
        for (let i = 0; i < n; i++) this.spawnMonster(clamp(num(d.x) + (Math.random() - 0.5) * 3, -93, 93), clamp(num(d.z) + (Math.random() - 0.5) * 3, -93, 93));
        break;
      }
      case 'day':
        this.time = W.START_TIME;
        this.startDay();
        break;
      case 'dusk':
        if (this.isNight()) { this.time = W.START_TIME; this.startDay(); }
        this.time = W.DAY_LEN - W.DUSK_WARN;
        this.broadcast({ type: 'clock', time: this.time, night: this.night });
        break;
      case 'night':
        if (!this.isNight()) { this.time = W.DAY_LEN; this.startNight(); }
        break;
      case 'invuln': p.invuln = !p.invuln; break;
      case 'free': p.free = !p.free; break;
      case 'give': p.inv.wood += 50; p.inv.stone += 50; send(p.ws, { type: 'inv', inv: p.inv, gain: { wood: 50, stone: 50 } }); break;
      case 'kill': for (const m of [...this.monsters.values()]) this.killMonster(m, false); break;
      case 'heal': this.gem.hp = W.GEM_HP; this.broadcast({ type: 'gem', gem: this.gem }); break;
      case 'tp': p.x = clamp(num(d.x), -93, 93); p.z = clamp(num(d.z), -93, 93); send(p.ws, { type: 'tp', x: p.x, z: p.z }); break;
    }
    send(p.ws, { type: 'god', on: true, invuln: !!p.invuln, free: !!p.free });
  }
}

// ============================================================================
wss.on('connection', (ws) => {
  const p = { id: nextPlayerId++, ws, name: 'Aventurier', room: null, x: 0, y: 0, z: 0, inv: { wood: 0, stone: 0 }, hp: W.PLAYER_HP };

  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }
    const R = p.room;
    switch (d.type) {
      // ----- Lobby -----
      case 'create': {
        if (R) return;
        p.name = String(d.name || 'Aventurier').slice(0, 16);
        const room = new Room(makeCode(), !!d.solo);
        rooms.set(room.code, room);
        room.addPlayer(p);
        send(ws, { type: 'you', id: p.id });
        room.sendLobby();
        if (room.solo) room.start();
        console.log(`[${room.code}] ${room.solo ? 'partie solo' : 'groupe'} créé par ${p.name}`);
        return;
      }
      case 'joinRoom': {
        if (R) return;
        p.name = String(d.name || 'Aventurier').slice(0, 16);
        const room = rooms.get(String(d.code || '').toUpperCase().trim());
        if (!room || room.solo) return send(ws, { type: 'lobbyError', text: 'Groupe introuvable. Vérifie le code.' });
        if (room.players.size >= W.MAX_PLAYERS) return send(ws, { type: 'lobbyError', text: 'Ce groupe est complet (4 joueurs maximum).' });
        send(ws, { type: 'you', id: p.id });
        room.addPlayer(p);
        console.log(`[${room.code}] ${p.name} a rejoint (${room.players.size}/${W.MAX_PLAYERS})`);
        return;
      }
      case 'start':
        if (R && R.hostId === p.id) R.start();
        return;
      case 'leaveRoom':
        if (R) { R.removePlayer(p); p.room = null; }
        return;
    }
    if (!R || !R.started) return;
    // ----- En jeu -----
    switch (d.type) {
      case 'move':
        if (p.dead) return;
        p.x = clamp(num(d.x), -100, 100); p.y = num(d.y); p.z = clamp(num(d.z), -100, 100); p.ry = num(d.ry);
        p.tl = clamp(Math.floor(num(d.tl)), 0, 3);
        R.broadcast({ type: 'move', id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, s: clamp(num(d.s), 0, 12), g: d.g !== false, tl: p.tl }, p);
        break;
      case 'act':
        R.broadcast({ type: 'act', id: p.id, k: ['slash', 'chop', 'mine', 'hammer'].includes(d.k) ? d.k : 'slash' }, p);
        break;
      case 'hit': R.hitResource(p, d.id); break;
      case 'hitM': R.hitMonster(p, d.id); break;
      case 'build': R.build(p, d); break;
      case 'demolish': R.demolish(p, d.id); break;
      case 'gemPick': R.pickGem(p); break;
      case 'gemDrop': R.dropGem(d.x, d.z, d.y, p); break;
      case 'chat': R.chat(p, d.text); break;
      case 'admin': R.admin(p, d); break;
    }
  });

  ws.on('close', () => { if (p.room) p.room.removePlayer(p); });
});

server.listen(PORT, () => console.log(`Jeu lancé sur http://localhost:${PORT}`));
