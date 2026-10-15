// ============================================================================
// Serveur du jeu
//  - Village (lobby jouable) : joueurs qui se promènent, groupes, invitations
//  - Profils sauvegardés (éclats + compétences) et classement par taille d'équipe
//  - Parties : cycle jour/nuit, ressources, constructions, Joyau, monstres, chat, admin
// ============================================================================
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as W from './public/js/world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const TICK = 0.1;
const RES_RESPAWN_S = 25;
const DATA_DIR = path.join(__dirname, 'data');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lib/three', express.static(path.join(__dirname, 'node_modules', 'three')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

// ============================================================================
// Sauvegardes (profils et classement) dans le dossier data/
// ============================================================================
fs.mkdirSync(DATA_DIR, { recursive: true });
function loadJSON(name, def) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); } catch { return def; }
}
const saveTimers = {};
function saveJSON(name, data) {
  clearTimeout(saveTimers[name]);
  saveTimers[name] = setTimeout(() => {
    const file = path.join(DATA_DIR, name);
    fs.writeFile(file + '.tmp', JSON.stringify(data), (err) => { if (!err) fs.rename(file + '.tmp', file, () => {}); });
  }, 1000);
}
const profiles = loadJSON('profiles.json', {});
// Comptes : pseudo + mot de passe (haché avec scrypt) -> jeton du profil
const accounts = loadJSON('accounts.json', {});
const accKey = (name) => String(name || '').trim().toLowerCase();
const hashPass = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString('hex');
function checkPass(acc, pass) {
  const h = Buffer.from(hashPass(pass, acc.salt), 'hex'), ref = Buffer.from(acc.hash, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}
// Renvoie { token, name } ou { err }
function authenticate(d, p) {
  const name = String(d.name || '').replace(/[<>]/g, '').trim().slice(0, 16);
  const key = accKey(name), acc = accounts[key];
  const mode = d.auth;
  if (mode === 'register') {
    if (!/^[\p{L}\p{N} _.-]{3,16}$/u.test(name)) return { err: 'Pseudo : 3 à 16 lettres ou chiffres.' };
    if (String(d.pass || '').length < 4) return { err: 'Mot de passe : au moins 4 caractères.' };
    if (acc) return { err: 'Ce pseudo est déjà pris.' };
    // on garde la progression faite en invité sur ce navigateur
    const t = typeof d.token === 'string' && profiles[d.token] && !profiles[d.token].account ? d.token : crypto.randomBytes(16).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    accounts[key] = { name, salt, hash: hashPass(d.pass, salt), token: t, created: Date.now() };
    if (!profiles[t]) profiles[t] = { name, shards: 0, skills: [], best: 0, xp: 0, created: Date.now() };
    profiles[t].account = key;
    saveJSON('accounts.json', accounts);
    return { token: t, name, account: true };
  }
  if (mode === 'login') {
    p.tries = (p.tries || 0) + 1;
    if (p.tries > 8) return { err: 'Trop d’essais, recharge la page.' };
    if (!acc || !checkPass(acc, d.pass)) return { err: 'Pseudo ou mot de passe incorrect.' };
    return { token: acc.token, name: acc.name, account: true };
  }
  if (mode === 'session') {
    if (!acc || d.token !== acc.token) return { err: 'Session expirée : reconnecte-toi.' };
    return { token: acc.token, name: acc.name, account: true };
  }
  // invité : progression liée au navigateur, pseudo des comptes protégés
  if (acc) return { err: 'Ce pseudo appartient à un compte : connecte-toi avec ton mot de passe.' };
  let t = d.token;
  if (typeof t === 'string' && profiles[t]?.account) t = null;
  return { token: t, name: name || 'Aventurier', account: false };
}
const leaderboard = loadJSON('leaderboard.json', { 1: [], 2: [], 3: [], 4: [] });

function getProfile(token, name) {
  if (typeof token !== 'string' || !/^[a-z0-9]{16,48}$/.test(token)) token = crypto.randomBytes(12).toString('hex');
  if (!profiles[token]) profiles[token] = { name, shards: 0, skills: [], best: 0, xp: 0, created: Date.now() };
  profiles[token].name = name;
  // Compétences supprimées ou déplacées par une mise à jour : on rembourse
  const prof = profiles[token];
  for (const id of [...prof.skills]) {
    if (!W.SKILL_BY_ID[id]) { prof.shards += W.OLD_SKILLS[id] || 0; prof.skills = prof.skills.filter((s) => s !== id); }
  }
  saveJSON('profiles.json', profiles);
  return { token, prof: profiles[token] };
}
function sendProfile(p) {
  const pr = p.prof;
  send(p.ws, { type: 'profile', token: p.token, shards: pr.shards, skills: pr.skills, best: pr.best, xp: pr.xp || 0, account: pr.account ? accounts[pr.account]?.name : null,
    items: pr.items || [], equip: pr.equip || {}, skin: p.skin });
}
// Recalcule les caractéristiques (en partie : la vie max change aussi)
function refreshMods(p) {
  if (!p.room) return;
  const before = p.mods?.maxHp || W.PLAYER_HP;
  p.mods = computeMods(p);
  if (!p.dead) p.hp = clamp(p.hp + Math.max(0, p.mods.maxHp - before), 1, p.mods.maxHp);
  p.room.broadcast({ type: 'pHp', id: p.id, hp: Math.round(p.hp), max: p.mods.maxHp });
}
// Caractéristiques d'un joueur : compétences + niveau du héros + équipement porté
function computeMods(p) {
  return W.applyGear(W.skillMods(p.prof.skills, W.levelOf(p.prof.xp || 0)), p.prof.items || [], p.prof.equip || {}, p.skin);
}
function recordScore(room) {
  if (room.adminUsed || room.survived <= 0 || room.recorded) return;
  room.recorded = true;
  const size = clamp(room.teamSize, 1, 4);
  const list = leaderboard[size];
  list.push({ names: room.teamNames, nights: room.survived, date: Date.now() });
  list.sort((a, b) => b.nights - a.nights || a.date - b.date);
  leaderboard[size] = list.slice(0, 10);
  saveJSON('leaderboard.json', leaderboard);
  hub.broadcast({ type: 'leaderboard', board: leaderboard });
}

// ============================================================================
// Village (lobby jouable)
// ============================================================================
const HUB_COLORS = [0x2e6fd8, 0xc0392b, 0x27ae60, 0xd4a017, 0x8e44ad, 0xd35400, 0x16a085, 0xd6458f];
const hub = {
  players: new Map(),
  broadcast(obj, except) {
    const msg = JSON.stringify(obj);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(msg);
  },
  pub(p) { return { id: p.id, name: p.name, color: p.color, skin: p.skin, x: p.x, y: p.y, z: p.z, ry: p.ry, party: p.party?.id ?? null }; },
  enter(p) {
    p.where = 'hub';
    p.room = null;
    p.color = HUB_COLORS[p.id % HUB_COLORS.length];
    const a = Math.random() * Math.PI * 2;
    p.x = Math.cos(a) * 2.5; p.z = 9 + Math.sin(a) * 1.5; p.y = 0; p.ry = Math.PI;
    this.players.set(p.id, p);
    send(p.ws, { type: 'hubWelcome', you: this.pub(p), players: [...this.players.values()].filter((o) => o !== p).map((o) => this.pub(o)), board: leaderboard });
    sendProfile(p);
    this.broadcast({ type: 'hubJoin', player: this.pub(p) }, p);
    if (p.party) sendParty(p.party);
  },
  leave(p) {
    if (!this.players.delete(p.id)) return;
    this.broadcast({ type: 'hubLeave', id: p.id });
  },
};

// ---------------- Groupes ----------------
let nextPartyId = 1;
function sendParty(party) {
  const msg = { type: 'party', id: party.id, leader: party.leader, members: party.members.map((m) => ({ id: m.id, name: m.name, color: m.color, inGame: m.where === 'room' })) };
  for (const m of party.members) send(m.ws, msg);
  hub.broadcast({ type: 'hubParty', members: party.members.map((m) => m.id), party: party.id });
}
function leaveParty(p) {
  const party = p.party;
  if (!party) return;
  party.members = party.members.filter((m) => m !== p);
  p.party = null;
  send(p.ws, { type: 'party', id: null, leader: p.id, members: [{ id: p.id, name: p.name, color: p.color }] });
  hub.broadcast({ type: 'hubParty', members: [p.id], party: null });
  if (party.members.length <= 1) {
    for (const m of party.members) { m.party = null; send(m.ws, { type: 'party', id: null, leader: m.id, members: [{ id: m.id, name: m.name, color: m.color }] }); hub.broadcast({ type: 'hubParty', members: [m.id], party: null }); }
    return;
  }
  if (party.leader === p.id) party.leader = party.members[0].id;
  sendParty(party);
}
function joinParty(p, leaderP) {
  if (p === leaderP) return;
  let party = leaderP.party;
  if (!party) { party = leaderP.party = { id: nextPartyId++, leader: leaderP.id, members: [leaderP] }; }
  if (party.members.length >= W.MAX_PLAYERS) return send(p.ws, { type: 'toast', text: 'Ce groupe est complet (4 joueurs).' });
  if (p.party) leaveParty(p);
  party.members.push(p);
  p.party = party;
  sendParty(party);
}

// ============================================================================
// Partie
// ============================================================================
const COLORS = [0x2e6fd8, 0xc0392b, 0x27ae60, 0xd4a017];
const rooms = new Set();
let nextRoomId = 1;

class Room {
  constructor(members) {
    this.id = nextRoomId++;
    this.players = new Map();
    this.solo = members.length === 1;
    this.hostId = members[0].id;
    this.teamSize = members.length;
    this.teamNames = members.map((m) => m.name);
    this.adminUsed = false;
    this.seed = Math.floor(Math.random() * 1e9);
    this.resources = new Map(W.generateResources(this.seed).map((r) => [r.id, { ...r, hp: W.RES_HP[r.k] }]));
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
    this.spawnCd = 0;
    this.nightSpawned = { total: 0, runner: 0, spitter: 0, tank: 0 };
    this.over = false;
    this.syncT = 0; this.gemSyncT = 0; this.lastGemHp = this.gem.hp;
    this.shards = 0;
    this.shots = [];
    this.inv = { wood: 0, stone: 0, twig: 0 };   // inventaire commun au groupe
    this.relic = { taken: false, by: null };    // Larme de la cascade (une fois par partie)
    this.towerT = 0; this.frostT = 0; this.repairT = 0;
    rooms.add(this);
    members.forEach((m, i) => this.addPlayer(m, COLORS[i]));
    this.interval = setInterval(() => { try { this.tick(TICK); } catch (err) { console.error('Erreur partie', err); } }, TICK * 1000);
    this.sys('La partie commence ! Récoltez du bois et de la pierre, et protégez le Joyau avant la nuit.', 'info');
    console.log(`[partie ${this.id}] ${this.teamNames.join(', ')}`);
  }

  isNight() { return this.time >= W.DAY_LEN; }
  broadcast(obj, except) {
    const msg = JSON.stringify(obj);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(msg);
  }
  sys(text, kind = 'sys') { this.broadcast({ type: 'chat', sys: kind, text }); }
  pub(p) {
    return { id: p.id, name: p.name, color: p.color, skin: p.skin, x: p.x, y: p.y, z: p.z, ry: p.ry || 0, hp: p.hp, maxHp: p.mods.maxHp, dead: p.dead };
  }

  addPlayer(p, color) {
    hub.leave(p);
    p.where = 'room'; p.room = this; p.color = color;
    p.mods = computeMods(p);
    p.hp = p.mods.maxHp; p.dead = false;
    p.inv = this.inv;
    p.god = false; p.invuln = false; p.free = false;
    const a = Math.random() * Math.PI * 2;
    p.x = Math.cos(a) * 3; p.z = Math.sin(a) * 3; p.y = W.heightAt(p.x, p.z);
    p.lastDamage = 0;
    this.players.set(p.id, p);
  }
  welcomeAll() { for (const p of this.players.values()) this.welcome(p); }
  welcome(p) {
    send(p.ws, {
      type: 'welcome', you: this.pub(p), solo: this.solo, host: this.hostId,
      players: [...this.players.values()].filter((o) => o !== p).map((o) => this.pub(o)),
      resources: [...this.resources.values()],
      buildings: [...this.buildings.values()],
      monsters: [...this.monsters.values()].map((m) => ({ id: m.id, k: m.kind, x: m.x, z: m.z, ry: m.ry, hp: m.hp })),
      gem: this.gem, clock: { time: this.time, night: this.night }, inv: p.inv, survived: this.survived, relic: this.relic,
      power: [...this.players.values()].filter((o) => o.oneShot).map((o) => [o.id, o.oneShot]),
    });
  }

  removePlayer(p, toHub) {
    if (!this.players.delete(p.id)) return;
    if (this.gem.carrier === p.id) this.dropGem(p.x, p.z, null);
    if (this.hostId === p.id) this.hostId = this.players.keys().next().value ?? null;
    this.broadcast({ type: 'leave', id: p.id });
    this.broadcast({ type: 'host', host: this.hostId });
    if (!this.over) this.sys(`${p.name} a quitté la partie`);
    if (toHub) hub.enter(p);
    if (p.party) sendParty(p.party);
    if (this.players.size === 0) this.destroy();
  }

  destroy() {
    if (!this.over) recordScore(this);
    clearInterval(this.interval);
    rooms.delete(this);
    console.log(`[partie ${this.id}] terminée (${this.survived} nuit(s))`);
  }

  // ---------------- Boucle ----------------
  tick(dt) {
    if (this.over) return;
    const now = Date.now() / 1000;
    const wasNight = this.isNight();
    this.time += dt;
    if (!wasNight && this.isNight()) this.startNight();
    if (this.time >= W.CYCLE) { this.time -= W.CYCLE; this.startDay(); }

    // La nuit, les monstres arrivent en continu : dès qu'un meurt, un autre le remplace
    if (this.isNight()) {
      this.spawnCd -= dt;
      const target = W.nightTarget(this.night, this.players.size, (this.time - W.DAY_LEN) / W.NIGHT_LEN);
      let alive = 0;
      for (const m of this.monsters.values()) if (!m.dead) alive++;
      while (alive < target && this.spawnCd <= 0) {
        this.spawnMonsterEdge();
        alive++;
        if (!this.burst) this.spawnCd = 0.8;
      }
      this.burst = false;
    }

    for (const p of this.players.values()) {
      if (p.dead || p.hp >= p.mods.maxHp) continue;
      if (now - p.lastDamage > 6) {
        p.hp = Math.min(p.mods.maxHp, p.hp + 4 * p.mods.regen * dt);
        p.regenT = (p.regenT || 0) - dt;
        if (p.regenT <= 0 || p.hp >= p.mods.maxHp) { p.regenT = 1; this.broadcast({ type: 'pHp', id: p.id, hp: Math.round(p.hp), max: p.mods.maxHp }); }
      }
    }
    // le Joyau devient trop lourd : il tombe des mains au bout de 10 s
    if (this.gem.carrier && Date.now() > (this.gem.carryUntil || Infinity)) {
      const c = this.players.get(this.gem.carrier);
      if (c) { this.dropGem(c.x, c.z, c.y, null); send(c.ws, { type: 'toast', text: 'Le Joyau t’échappe des mains !' }); }
    }
    if (!this.isNight() && this.gem.hp < W.GEM_HP) this.gem.hp = Math.min(W.GEM_HP, this.gem.hp + 2 * dt);
    this.gemSyncT -= dt;
    if (this.gemSyncT <= 0 && Math.round(this.gem.hp) !== Math.round(this.lastGemHp)) {
      this.gemSyncT = 1; this.lastGemHp = this.gem.hp;
      this.broadcast({ type: 'gem', gem: this.gem });
    }

    this.updateShots(now);
    this.updateMonsters(dt, now);
    this.updateBurns(dt);
    this.updateSpikes(dt);
    this.updateTowers(dt);

    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 5; this.broadcast({ type: 'clock', time: this.time, night: this.night }); }
  }

  startNight() {
    this.night++;
    this.nightSpawned = { total: 0, runner: 0, spitter: 0, tank: 0 };
    this.spawnCd = 0;
    this.burst = true;   // première vague : tous en même temps
    const target = W.nightTarget(this.night, this.players.size);
    this.broadcast({ type: 'clock', time: this.time, night: this.night });
    this.broadcast({ type: 'phase', phase: 'night', night: this.night });
    this.sys(`🌙 Nuit ${this.night} — ${target} monstres pour commencer, puis de plus en plus jusqu'à l'aube. Défendez le Joyau !`, 'night');
  }

  pickRelic(p) {
    if (this.relic.taken || p.dead) return;
    if (Math.hypot(p.x - W.RELIC_POS.x, p.z - W.RELIC_POS.z) > 3) return;
    p.oneShot = this.isNight() ? this.night : this.night + 1;
    this.relic = { taken: true, by: p.id };
    this.broadcast({ type: 'relic', relic: this.relic, by: p.id, night: p.oneShot });
    this.sys(`💧 ${p.name} a trouvé la Larme de la cascade ! Ses coups tueront net les monstres pendant la nuit ${p.oneShot}.`, 'info');
  }

  startDay() {
    for (const m of [...this.monsters.values()]) this.killMonster(m, true);
    for (const p of this.players.values()) if (p.oneShot && p.oneShot <= this.night) { p.oneShot = 0; this.broadcast({ type: 'power', id: p.id, night: 0 }); }
    if (this.night > 0) {
      this.survived = this.night;
      const gain = W.shardsForNight(this.night);
      if (!this.adminUsed) {
        this.shards += gain;
        for (const p of this.players.values()) {
          p.prof.shards += gain;
          p.prof.best = Math.max(p.prof.best || 0, this.night);
          sendProfile(p);
          this.giveXp(p, W.xpForNight(this.night));
        }
        saveJSON('profiles.json', profiles);
      }
      this.broadcast({ type: 'phase', phase: 'day', night: this.night, survived: this.survived, shards: this.adminUsed ? 0 : gain });
      this.sys(`☀️ Le jour se lève. Vous avez survécu à la nuit ${this.night} !` + (this.adminUsed ? ' (partie admin : pas d’éclats)' : ` +${gain} éclat${gain > 1 ? 's' : ''}`), 'day');
    }
    this.broadcast({ type: 'clock', time: this.time, night: this.night });
  }

  // Inventaire partagé : celui qui récolte voit les ressources voler vers lui, les autres voient le total changer
  sendInv(by, gain, from) {
    for (const p of this.players.values()) {
      if (p === by) send(p.ws, { type: 'inv', inv: this.inv, gain, from });
      else send(p.ws, { type: 'inv', inv: this.inv, gain, by: by ? by.name : null });
    }
  }

  // ---------------- Ressources ----------------
  hitResource(p, id) {
    const r = this.resources.get(String(id));
    if (!r || p.dead) return;
    const now = Date.now();
    if (now - (p.lastHit || 0) < 280 / p.mods.harvestSpeed) return;
    p.lastHit = now;
    if (Math.hypot(p.x - r.x, p.z - r.z) > 4 + W.resourceRadius(r)) return;
    r.hp -= r.k === 'b' ? 1 : p.mods.hitPow;
    this.broadcast({ type: 'resHit', id: r.id, hp: Math.max(0, r.hp), by: p.id, fx: p.x, fz: p.z });
    if (r.hp > 0.001) return;
    // Ressource détruite : tout le butin d'un coup (1 à 3 + bonus)
    const kind = W.RES_KIND[r.k];
    const gain = { [kind]: W.rollYield(r.k, p.mods, Math.random, !!r.rich) };
    this.inv[kind] += gain[kind];
    this.sendInv(p, gain, { x: r.x, z: r.z, k: r.k });
    if (r.k === 'b' && !p.dead) {
      p.hp = Math.min(p.mods.maxHp, p.hp + W.BUSH_HEAL * (p.mods.bush ? 2 : 1));
      this.broadcast({ type: 'pHp', id: p.id, hp: Math.round(p.hp), max: p.mods.maxHp, heal: true });
    }
    this.resources.delete(r.id);
    this.broadcast({ type: 'resDestroy', id: r.id, dx: r.x - p.x, dz: r.z - p.z });
    setTimeout(() => { if (rooms.has(this)) this.spawnResource(r.k); }, RES_RESPAWN_S * 1000);
  }

  spawnResource(kind) {
    const list = [...this.resources.values()];
    const extra = [];
    for (const b of this.buildings.values()) extra.push({ x: b.x, z: b.z, r: 3 });
    for (const p of this.players.values()) extra.push({ x: p.x, z: p.z, r: 6 });
    extra.push({ x: this.gem.x, z: this.gem.z, r: 10 });
    for (let i = 0; i < 300; i++) {
      const x = (this.rand() * 2 - 1) * (W.WORLD_LIMIT - 4), z = (this.rand() * 2 - 1) * (W.WORLD_LIMIT - 4);
      if (!W.isFreeSpot(x, z, list, kind === 'b' ? 1.4 : 2.2, extra)) continue;
      const r = W.makeResource(this.rand, 'n' + this.resN++, kind, x, z);
      r.hp = W.RES_HP[kind];
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
    if (!p.free && !W.pieceUnlocked(type, p.mods)) return send(p.ws, { type: 'toast', text: 'Débloque cette construction à la forge du village.' });
    const x = num(d.x), z = num(d.z), y = num(d.y), rot = clamp(Math.floor(num(d.rot)), 0, 3);
    const lv = clamp(Math.floor(num(d.lv)), 0, W.MAX_LEVEL);
    if (Math.abs(x) > W.WORLD_LIMIT || Math.abs(z) > W.WORLD_LIMIT) return;
    if (Math.hypot(x - p.x, z - p.z) > W.BUILD_RANGE + 3) return;
    const ground = W.heightAt(x, z);
    if (y < ground - 1.5 || y > ground + (W.MAX_LEVEL + 1) * W.WALL_H + 1.5) return;
    const key = W.slotKey(type, x, z, rot, y);
    for (const b of this.buildings.values()) if (W.slotKey(b.type, b.x, b.z, b.rot, b.y) === key) return;
    if (!p.free) {
      const c = W.pieceCost(type, p.mods);
      if (!W.canAfford(this.inv, c)) return;
      for (const k of W.RES_KEYS) this.inv[k] -= c[k];
      this.sendInv(null);
    }
    const hp = Math.round(piece.hp * p.mods.buildHp);
    const dur = +(W.BUILD_TIME * p.mods.buildTime).toFixed(2);
    const b = { id: 'b' + this.bN++, type, x, z, y, rot, lv, hp, max: hp, state: 'building', dur, by: p.id, repair: p.mods.repair, towerDmg: p.mods.towerDmg, cd: 0 };
    this.buildings.set(b.id, b);
    this.broadcast({ type: 'bAdd', b });
    setTimeout(() => {
      if (!rooms.has(this) || !this.buildings.has(b.id)) return;
      b.state = 'done';
      this.broadcast({ type: 'bDone', id: b.id });
    }, dur * 1000);
  }

  demolish(p, id) {
    const b = this.buildings.get(String(id));
    if (!b || p.dead) return;
    if (Math.hypot(b.x - p.x, b.z - p.z) > W.BUILD_RANGE + 3) return;
    this.buildings.delete(b.id);
    const back = W.refundOf(b.type);
    for (const k of W.RES_KEYS) this.inv[k] += back[k];
    const gain = Object.fromEntries(W.RES_KEYS.filter((k) => back[k]).map((k) => [k, back[k]]));
    this.sendInv(null, Object.keys(gain).length ? gain : undefined);
    this.broadcast({ type: 'bDel', id: b.id, broken: false });
    this.collapse();
  }

  // Réparer au marteau : coûte la moitié du prix de la pièce × la part de vie perdue
  repair(p, id) {
    const b = this.buildings.get(String(id));
    if (!b || p.dead || b.state !== 'done' || b.hp >= b.max) return;
    if (Math.hypot(b.x - p.x, b.z - p.z) > W.BUILD_RANGE + 3) return;
    if (!p.free) {
      const c = W.repairCost(b, p.mods);
      if (!W.canAfford(this.inv, c)) return send(p.ws, { type: 'toast', text: 'Pas assez de matériaux pour réparer.' });
      for (const k of W.RES_KEYS) this.inv[k] -= c[k];
      this.sendInv(null);
    }
    b.hp = b.max;
    this.broadcast({ type: 'bHp', id: b.id, hp: b.hp, repaired: true });
  }

  // Les pièces en hauteur qui ne reposent plus sur rien s'écroulent
  collapse() {
    const list = [...this.buildings.values()];
    if (!list.some((b) => b.lv)) return;
    const ok = W.supportedSet(list);
    for (const b of list) {
      if (ok.has(b.id)) continue;
      this.buildings.delete(b.id);
      this.broadcast({ type: 'bDel', id: b.id, broken: true });
    }
  }

  damageBuilding(b, dmg) {
    if (!this.buildings.has(b.id)) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      this.buildings.delete(b.id);
      this.broadcast({ type: 'bDel', id: b.id, broken: true });
      this.collapse();
    } else this.broadcast({ type: 'bHit', id: b.id, hp: Math.round(b.hp) });
  }

  // Pieux : blessent les monstres qui marchent dessus et s'usent
  updateSpikes(dt) {
    for (const b of this.buildings.values()) {
      if (b.type !== 'spikes' || b.state !== 'done') continue;
      let used = false;
      for (const m of this.monsters.values()) {
        if (m.dead || m.wake > 0) continue;
        if (Math.abs(m.x - b.x) < 1.15 && Math.abs(m.z - b.z) < 1.15) {
          m.hp -= W.SPIKE_DPS * dt;
          m.slow = 0.45;
          used = true;
          m.spikeT = (m.spikeT || 0) - dt;
          if (m.spikeT <= 0) { m.spikeT = 0.5; this.broadcast({ type: 'mHurt', id: m.id, hp: Math.max(0, m.hp), by: 0, spike: 1 }); }
          if (m.hp <= 0) this.killMonster(m, false);
        }
      }
      if (used) {
        b.wear = (b.wear || 0) + dt * 8;
        if (b.wear >= 4) { this.damageBuilding(b, b.wear); b.wear = 0; }
      }
    }
  }

  // Tours : l'archer tire sur le monstre le plus proche, le givre ralentit tout autour
  updateTowers(dt) {
    const repairing = !this.isNight();
    this.repairT -= dt;
    const doRepair = this.repairT <= 0;
    if (doRepair) this.repairT = 1;
    for (const b of this.buildings.values()) {
      if (b.state !== 'done') continue;
      if (doRepair && repairing && b.repair && b.hp < b.max) {
        b.hp = Math.min(b.max, b.hp + b.max * 0.03);
        this.broadcast({ type: 'bHp', id: b.id, hp: Math.round(b.hp) });
      }
      if (b.type === 'tower') {
        b.cd -= dt;
        if (b.cd > 0) continue;
        let best = null, bd = W.TOWER.range;
        for (const m of this.monsters.values()) {
          if (m.dead || m.wake > 0) continue;
          const d = Math.hypot(m.x - b.x, m.z - b.z);
          if (d < bd) { bd = d; best = m; }
        }
        if (!best) continue;
        b.cd = W.TOWER.rate;
        best.hp -= b.towerDmg;
        this.broadcast({ type: 'tShot', id: b.id, m: best.id, hp: Math.max(0, best.hp) });
        if (best.hp <= 0) this.killMonster(best, false);
      } else if (b.type === 'frost') {
        b.cd -= dt;
        if (b.cd > 0) continue;
        b.cd = W.FROST.pulse;
        let any = false;
        for (const m of this.monsters.values()) {
          if (m.dead) continue;
          if (Math.hypot(m.x - b.x, m.z - b.z) < W.FROST.range) { m.frost = 1.3; any = true; }
        }
        if (any) this.broadcast({ type: 'frostPulse', id: b.id });
      }
    }
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
    if (Date.now() < (this.gem.readyAt || 0)) return send(p.ws, { type: 'toast', text: `Le Joyau doit se reposer encore ${Math.ceil((this.gem.readyAt - Date.now()) / 1000)} s.` });
    this.gem.carrier = p.id;
    this.gem.carryUntil = Date.now() + W.GEM_CARRY * 1000;
    this.broadcast({ type: 'gem', gem: this.gem, ev: 'pick', by: p.id });
  }
  dropGem(x, z, y, p) {
    if (p && this.gem.carrier !== p.id) return;
    if (p && Math.hypot(x - p.x, z - p.z) > 3) { x = p.x; z = p.z; y = null; }
    this.gem.x = clamp(num(x), -W.WORLD_LIMIT, W.WORLD_LIMIT);
    this.gem.z = clamp(num(z), -W.WORLD_LIMIT, W.WORLD_LIMIT);
    this.gem.y = typeof y === 'number' && isFinite(y) ? y : null;
    this.gem.carrier = null;
    this.gem.carryUntil = 0;
    this.gem.readyAt = Date.now() + W.GEM_REST * 1000;
    this.broadcast({ type: 'gem', gem: this.gem, ev: 'drop', now: Date.now() });
  }
  damageGem(dmg) {
    if (this.over) return;
    this.gem.hp -= dmg;
    this.broadcast({ type: 'gemHit', hp: Math.max(0, Math.round(this.gem.hp)) });
    if (this.gem.hp <= 0) this.gameOver();
  }
  gameOver() {
    this.over = true;
    recordScore(this);
    this.broadcast({ type: 'gameOver', survived: this.survived, shards: this.shards, admin: this.adminUsed });
    setTimeout(() => {
      for (const p of [...this.players.values()]) this.removePlayer(p, true);
    }, 3500);   // retour rapide au village (un panneau y explique comment devenir plus fort)
  }

  // ---------------- Joueurs ----------------
  damagePlayer(p, dmg, from) {
    if (p.dead || p.invuln || Date.now() < (p.protectUntil || 0) || Date.now() < (p.dodgeUntil || 0)) return;
    if (from && from.T) from.lastDmgT = Date.now() / 1000;   // le monstre a touché sa cible
    // parade du guerrier : le bouclier encaisse presque tout
    const blocked = p.blocking ? W.classOf(p.skin).block : 0;
    if (blocked) dmg *= blocked;
    p.hp -= dmg * p.mods.armor;
    p.lastDamage = Date.now() / 1000;
    this.broadcast({ type: 'pHp', id: p.id, hp: Math.max(0, Math.round(p.hp)), max: p.mods.maxHp, hurt: true, blocked: !!blocked });
    if (p.hp <= 0) {
      p.dead = true;
      if (this.gem.carrier === p.id) this.dropGem(p.x, p.z, null);
      this.broadcast({ type: 'pDie', id: p.id });
      this.sys(`💀 ${p.name} est tombé au combat`, 'warn');
      setTimeout(() => {
        if (!rooms.has(this) || !this.players.has(p.id)) return;
        const g = this.gemPos(), a = Math.random() * Math.PI * 2;
        p.x = g.x + Math.cos(a) * 2.5; p.z = g.z + Math.sin(a) * 2.5;
        p.hp = p.mods.maxHp; p.dead = false;
        p.protectUntil = Date.now() + 3000;
        this.broadcast({ type: 'pRespawn', id: p.id, x: p.x, z: p.z, hp: p.hp, max: p.mods.maxHp });
      }, W.RESPAWN_DELAY * 1000);
    }
  }

  // ---------------- Monstres ----------------
  pickKind() {
    const s = this.nightSpawned, n = this.night;
    // Colosses : 6% de la vague à partir de la nuit 8 (au moins 1)
    if (n >= W.TANK_NIGHT && s.tank < Math.max(1, Math.floor((s.total + 1) * 0.06))) return 'tank';
    // Cracheurs : 2% de la vague à partir de la nuit 5 (au moins 1)
    if (n >= 5 && s.spitter < Math.max(1, Math.floor((s.total + 1) * 0.02))) return 'spitter';
    // Griffus : 5% de la vague à partir de la nuit 2 (au moins 1)
    if (n >= 2 && s.runner < Math.max(1, Math.floor((s.total + 1) * 0.05))) return 'runner';
    return 'brute';
  }
  spawnMonsterEdge(kind) {
    const g = this.gemPos();
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, d = W.SPAWN_MIN + Math.random() * (W.SPAWN_MAX - W.SPAWN_MIN);
      const x = clamp(g.x + Math.cos(a) * d, -W.WORLD_LIMIT + 2, W.WORLD_LIMIT - 2);
      const z = clamp(g.z + Math.sin(a) * d, -W.WORLD_LIMIT + 2, W.WORLD_LIMIT - 2);
      if (Math.hypot(x - g.x, z - g.z) < 30) continue;
      if (W.caveAt(x, z)) continue;
      if ([...this.players.values()].some((p) => Math.hypot(p.x - x, p.z - z) < 14)) continue;
      return this.spawnMonster(x, z, kind);
    }
  }
  spawnMonster(x, z, kind) {
    kind = kind || this.pickKind();
    const T = W.MONSTERS[kind];
    this.nightSpawned.total++;
    if (kind !== 'brute') this.nightSpawned[kind]++;
    const m = { id: 'm' + this.mN++, kind, T, x, z, ry: 0, hp: T.hp, cd: 2, hitAt: 0, atk: null, aggro: null, wake: 1.6, dead: false, slow: 0 };
    this.monsters.set(m.id, m);
    this.broadcast({ type: 'mSpawn', m: { id: m.id, k: kind, x, z, ry: 0, hp: m.hp } });
    return m;
  }
  killMonster(m, burn) {
    if (m.dead) return;
    m.dead = true;
    this.monsters.delete(m.id);
    this.broadcast({ type: 'mDie', id: m.id, burn: !!burn });
    // 1 % de chance de lâcher un objet (rareté selon la nuit)
    if (!burn && Math.random() < W.DROP_CHANCE) this.dropLoot(m.x, m.z);
  }
  dropLoot(x, z, r = null) {
    const night = Math.max(1, this.night || 1);
    const owners = [...this.players.values()];
    const pref = owners.length ? owners[Math.floor(Math.random() * owners.length)].skin : null;
    const item = W.randomItem(night, pref);
    if (r != null) { const it2 = W.makeItem(item.slot, item.cls || pref || 'Knight', clamp(r, 0, 5), night); Object.assign(item, it2); }
    const loot = { id: 'l' + (this.lootN = (this.lootN || 0) + 1), x, z, y: W.heightAt(x, z), item };
    (this.loots ||= new Map()).set(loot.id, loot);
    this.broadcast({ type: 'lootAdd', loot });
  }
  takeLoot(p, id) {
    const l = this.loots?.get(String(id));
    if (!l || p.dead || Math.hypot(l.x - p.x, l.z - p.z) > 3) return;
    const items = (p.prof.items ||= []);
    if (items.length >= W.INV_MAX) return send(p.ws, { type: 'toast', text: 'Inventaire plein : jette des objets (touche I).' });
    this.loots.delete(l.id);
    items.push(l.item);
    saveJSON('profiles.json', profiles);
    sendProfile(p);
    this.broadcast({ type: 'lootDel', id: l.id, by: p.id, item: l.item, name: p.name });
  }
  // Coup d'un joueur : chaque style de combat a ses dégâts, son rythme et sa portée
  hitMonster(p, id, d = {}) {
    if (p.dead || Date.now() < (p.stunUntil || 0)) return;
    const cls = W.classOf(p.skin);
    const m = id != null ? this.monsters.get(String(id)) : null;
    if (id != null && (!m || m.dead)) return;
    const now = Date.now();
    if (now - (p.lastSword || 0) < cls.cd * 1000 * 0.85 / p.mods.atkSpeed) return;
    p.lastSword = now;
    // Larme de la cascade : tue en un coup pendant la nuit choisie
    const one = p.oneShot && this.isNight() && this.night === p.oneShot;
    const dmg = one ? 99999 : cls.dmg * p.mods.dmg;
    let targets = [];
    if (cls.aoe) {
      // mage : boule de feu autour du point d'impact (pas trop loin du joueur)
      let cx = d.x != null ? num(d.x, p.x) : m ? m.x : p.x, cz = d.z != null ? num(d.z, p.z) : m ? m.z : p.z;
      const dd = Math.hypot(cx - p.x, cz - p.z), maxR = (cls.range || cls.reach) + 4;
      if (dd > maxR) { cx = p.x + (cx - p.x) / dd * maxR; cz = p.z + (cz - p.z) / dd * maxR; }
      for (const o of this.monsters.values()) if (!o.dead && Math.hypot(o.x - cx, o.z - cz) < cls.aoe) targets.push(o);
    } else {
      if (!m) return;
      const dist = Math.hypot(m.x - p.x, m.z - p.z);
      if (dist > (cls.ranged ? cls.range + 2 : cls.reach + 0.6)) return;
      targets = [m];
      // barbare (ou compétence « balayage ») : tous les monstres devant lui
      const cl = cls.cleave || (p.mods.cleave ? 3.2 : 0);
      if (cl && !cls.ranged) {
        const fx = (m.x - p.x) / (dist || 1), fz = (m.z - p.z) / (dist || 1);
        for (const o of this.monsters.values()) {
          if (o === m || o.dead) continue;
          const ox = o.x - p.x, oz = o.z - p.z, od = Math.hypot(ox, oz);
          if (od < cl && (ox * fx + oz * fz) / (od || 1) > 0.1) targets.push(o);
        }
      }
    }
    for (const t of targets) {
      const dx = t.x - p.x, dz = t.z - p.z, dd = Math.hypot(dx, dz);
      t.hp -= dmg;
      const push = cls.ranged ? 0.25 : cls.cleave ? 0.6 : 0.45;
      if (dd > 0.01) { t.x += dx / dd * push / t.T.scale; t.z += dz / dd * push / t.T.scale; }
      if (!t.gemOnly) t.aggro = p.id;
      t.cd = Math.max(t.cd, 0.4);
      if (cls.burn && t.hp > 0) {
        t.burnT = cls.burn.dur; t.burnDps = cls.burn.dps * p.mods.dmg; t.burnBy = p.id;
        this.broadcast({ type: 'mBurn', id: t.id, t: cls.burn.dur });
      }
      this.broadcast({ type: 'mHurt', id: t.id, hp: Math.max(0, t.hp), by: p.id });
      if (t.hp <= 0) { this.killMonster(t, false); this.giveXp(p, W.XP_KILL[t.kind] || 3); }
    }
  }

  // Coup de poing entre alliés : la victime est assommée et roule par terre
  punch(p, id) {
    const t = this.players.get(num(id));
    const now = Date.now();
    if (!t || t === p || p.dead || t.dead || now - (p.lastPunch || 0) < W.PUNCH.cd * 1000) return;
    if (Math.hypot(t.x - p.x, t.z - p.z) > W.PUNCH.reach + 0.8) return;
    p.lastPunch = now;
    t.stunUntil = now + W.PUNCH.stun * 1000;
    if (this.gem.carrier === t.id) this.dropGem(t.x, t.z, t.y, null);
    this.broadcast({ type: 'punch', from: p.id, to: t.id, dir: Math.atan2(t.x - p.x, t.z - p.z), stun: W.PUNCH.stun });
  }

  // Expérience du héros (sauvegardée sur le compte)
  giveXp(p, n) {
    if (this.adminUsed || !p.prof || n <= 0) return;
    const before = W.levelOf(p.prof.xp || 0);
    p.prof.xp = (p.prof.xp || 0) + n;
    const lvl = W.levelOf(p.prof.xp);
    if (lvl > before) {
      p.mods = computeMods(p);
      p.hp = Math.min(p.mods.maxHp, p.hp + W.heroBonus(lvl).hp - W.heroBonus(before).hp);
      this.broadcast({ type: 'pHp', id: p.id, hp: Math.round(p.hp), max: p.mods.maxHp });
      this.sys(`⭐ ${p.name} passe au niveau ${lvl} !`, 'info');
      saveJSON('profiles.json', profiles);
    }
    send(p.ws, { type: 'xp', xp: p.prof.xp, gain: n, level: lvl });
  }
  // Dash « Charge » : blesse les monstres traversés
  dashHit(p, ids) {
    if (p.dead || !p.mods.charge || !Array.isArray(ids)) return;
    const now = Date.now();
    if (now - (p.lastDash || 0) > 600) return;   // seulement juste après un dash annoncé
    if (p.dashHits >= 6) return;
    const cls = W.classOf(p.skin);
    for (const id of ids.slice(0, 6)) {
      const m = this.monsters.get(String(id));
      if (!m || m.dead || Math.hypot(m.x - p.x, m.z - p.z) > 5) continue;
      p.dashHits++;
      m.hp -= cls.dmg * p.mods.dmg;
      if (!m.gemOnly) m.aggro = p.id;
      this.broadcast({ type: 'mHurt', id: m.id, hp: Math.max(0, m.hp), by: p.id });
      if (m.hp <= 0) { this.killMonster(m, false); this.giveXp(p, W.XP_KILL[m.kind] || 3); }
    }
  }

  // Brûlure (mage) : dégâts sur la durée
  updateBurns(dt) {
    for (const m of this.monsters.values()) {
      if (m.dead || !(m.burnT > 0)) continue;
      m.burnT -= dt;
      m.hp -= m.burnDps * dt;
      m.burnSync = (m.burnSync || 0) - dt;
      if (m.hp <= 0) {
        this.broadcast({ type: 'mHurt', id: m.id, hp: 0, by: m.burnBy, burn: true }); this.killMonster(m, false);
        const k = this.players.get(m.burnBy); if (k) this.giveXp(k, W.XP_KILL[m.kind] || 3);
        continue;
      }
      if (m.burnSync <= 0) { m.burnSync = 0.5; this.broadcast({ type: 'mHurt', id: m.id, hp: Math.round(m.hp), burn: true }); }
    }
  }

  // Projectiles du Cracheur (esquivables : les dégâts sont là où il atterrit)
  shoot(m, tx, tz, target) {
    const d = Math.hypot(tx - m.x, tz - m.z);
    const t = 0.35 + d / 14;
    this.shots.push({ at: Date.now() / 1000 + t, x: tx, z: tz, target, m });
    this.broadcast({ type: 'mShot', id: m.id, x0: m.x, z0: m.z, x1: tx, z1: tz, t });
  }
  updateShots(now) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      if (now < s.at) continue;
      this.shots.splice(i, 1);
      const T = W.MONSTERS.spitter;
      for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - s.x, p.z - s.z) < 1.4) this.damagePlayer(p, T.dmgP, s.m);
      if (s.target.kind === 'gem') { const g = this.gemPos(); if (Math.hypot(g.x - s.x, g.z - s.z) < 2) this.damageGem(T.dmgGem); }
      if (s.target.kind === 'wall') { const b = this.buildings.get(s.target.id); if (b) this.damageBuilding(b, T.dmgB); }
    }
  }

  // joueur en hauteur (sur un étage ou une tour) : hors d'atteinte des épées
  perched(p) { return (p.y ?? 0) > W.heightAt(p.x, p.z) + 1.6; }

  updateMonsters(dt, now) {
    if (!this.monsters.size) return;
    const alive = [...this.players.values()].filter((p) => !p.dead);
    const gp = this.gemPos();
    // seules les pièces du rez-de-chaussée barrent la route
    const walls = [...this.buildings.values()].filter((b) => !b.lv && (W.isWallType(b.type) || W.PIECES[b.type].tower));
    const list = [];
    for (const m of this.monsters.values()) {
      if (m.dead) continue;
      const T = m.T;
      if (m.wake > 0) { m.wake -= dt; list.push([m.id, +m.x.toFixed(2), +m.z.toFixed(2), +m.ry.toFixed(2), 0, 0]); continue; }
      const frosty = m.frost > 0;
      if (frosty) m.frost -= dt;
      const fk = frosty ? 1 - W.FROST.slow : 1;
      m.cd -= dt * fk;

      // Coup en cours : appliqué au bon moment de l'animation
      if (m.atk && now >= m.hitAt) {
        const a = m.atk;
        m.atk = null;
        if (T.ranged) {
          if (a.kind === 'gem') { const g = this.gemPos(); this.shoot(m, g.x, g.z, a); }
          else if (a.kind === 'player') { const p = this.players.get(a.id); if (p) this.shoot(m, p.x, p.z, a); }
          else if (a.kind === 'wall') { const b = this.buildings.get(a.id); if (b) this.shoot(m, b.x, b.z, a); }
        } else if (a.kind === 'gem') {
          const g = this.gemPos();
          if (Math.hypot(g.x - m.x, g.z - m.z) < T.reach + 1.4) this.damageGem(T.dmgGem);
        } else if (a.kind === 'player') {
          const p = this.players.get(a.id);
          if (p && !this.perched(p) && Math.hypot(p.x - m.x, p.z - m.z) < T.reach + 0.9) this.damagePlayer(p, T.dmgP, m);
        } else if (a.kind === 'wall') {
          const b = this.buildings.get(a.id);
          if (b) this.damageBuilding(b, T.dmgB);
        }
      }

      // Cible : le Joyau, sauf si un joueur passe trop près
      let tx = gp.x, tz = gp.z, tr = 1.3, tk = { kind: 'gem' };
      let aggroP = m.aggro ? this.players.get(m.aggro) : null;
      if (aggroP && (aggroP.dead || Math.hypot(aggroP.x - m.x, aggroP.z - m.z) > 14 || (!T.ranged && this.perched(aggroP))
        || (m.gemOnly && Math.hypot(aggroP.x - m.x, aggroP.z - m.z) > T.reach + 1.5))) { aggroP = null; m.aggro = null; }
      if (!aggroP) {
        // un monstre qui a abandonné la poursuite ne s'occupe plus que du Joyau
        // (il frappe seulement un joueur collé à lui, qui lui barre la route)
        let bd = m.gemOnly ? T.reach + 0.6 : T.ranged ? 12 : 7;
        for (const p of alive) {
          // un monstre de corps à corps ne peut pas atteindre un joueur perché en hauteur
          if (!T.ranged && this.perched(p)) continue;
          const d = Math.hypot(p.x - m.x, p.z - m.z); if (d < bd) { bd = d; aggroP = p; }
        }
        if (aggroP) m.aggro = aggroP.id;
      }
      // poursuite trop longue sans réussir à toucher : il laisse tomber et repart vers le Joyau
      if (aggroP) {
        if (m.chaseId !== aggroP.id) { m.chaseId = aggroP.id; m.chaseT = now; }
        if (!m.gemOnly && now - Math.max(m.chaseT, m.lastDmgT || 0) > W.CHASE_GIVEUP) { m.gemOnly = true; m.aggro = null; aggroP = null; }
      } else m.chaseId = null;
      if (aggroP && this.gem.carrier !== aggroP.id) { tx = aggroP.x; tz = aggroP.z; tr = 0.4; tk = { kind: 'player', id: aggroP.id }; }

      const dx = tx - m.x, dz = tz - m.z, dist = Math.hypot(dx, dz);
      let st = 0;
      if (!m.atk) {
        const reach = T.ranged ? T.reach : T.reach + tr;
        if (dist <= reach) {
          if (m.cd <= 0) this.monsterAttack(m, tk, now);
          m.ry = Math.atan2(dx, dz);
        } else if (dist > 0.01) {
          let sp = T.speed * (W.isWater(m.x, m.z) ? 0.55 : 1) * fk;
          if (m.slow > 0) { sp *= 1 - m.slow; m.slow = Math.max(0, m.slow - dt * 2); }
          const nx = m.x + dx / dist * sp * dt, nz = m.z + dz / dist * sp * dt;
          let blocking = null;
          for (const b of walls) {
            const box = W.isWallType(b.type) ? W.wallBox(b) : { x: b.x, z: b.z, hx: 0.8, hz: 0.8 };
            if (W.distToBox(nx, nz, box) < T.radius) { blocking = b; break; }
          }
          if (blocking) {
            if (m.cd <= 0) this.monsterAttack(m, { kind: 'wall', id: blocking.id }, now);
            m.ry = Math.atan2(blocking.x - m.x, blocking.z - m.z);
          } else {
            m.x = nx; m.z = nz; st = 1;
            m.ry = Math.atan2(dx, dz);
          }
        }
      }
      for (const r of this.resources.values()) {
        if (r.k === 'b') continue;
        const rr = W.resourceRadius(r) + T.radius * 0.9;
        const ex = m.x - r.x, ez = m.z - r.z;
        if (Math.abs(ex) > rr || Math.abs(ez) > rr) continue;
        const d = Math.hypot(ex, ez);
        if (d < rr && d > 0.001) { m.x = r.x + ex / d * rr; m.z = r.z + ez / d * rr; }
      }
      for (const o of this.monsters.values()) {
        if (o === m || o.dead) continue;
        const min = (T.radius + o.T.radius) * 1.1;
        const ex = m.x - o.x, ez = m.z - o.z, d = Math.hypot(ex, ez);
        if (d < min && d > 0.001) { m.x += ex / d * (min - d) * 0.5; m.z += ez / d * (min - d) * 0.5; }
      }
      m.x = clamp(m.x, -W.WORLD_LIMIT, W.WORLD_LIMIT); m.z = clamp(m.z, -W.WORLD_LIMIT, W.WORLD_LIMIT);
      list.push([m.id, +m.x.toFixed(2), +m.z.toFixed(2), +m.ry.toFixed(2), m.atk ? 2 : st, frosty ? 1 : 0]);
    }
    this.broadcast({ type: 'm', l: list });
  }
  monsterAttack(m, target, now) {
    m.atk = target;
    m.hitAt = now + m.T.hitAt / (m.frost > 0 ? 1 - W.FROST.slow : 1);
    m.cd = m.T.cd;
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
      if (!(this.solo || p.id === this.hostId)) return send(p.ws, { type: 'chat', sys: 'warn', text: "Seul le chef du groupe peut utiliser /god." });
      if (!this.adminUsed) {
        this.adminUsed = true;
        this.sys('⚙ Mode admin activé : cette partie ne rapporte plus d’éclats ni de place au classement.', 'warn');
      }
      p.god = true;
      send(p.ws, { type: 'god', on: true, invuln: !!p.invuln, free: !!p.free });
      return;
    }
    if (cmd === '/aide' || cmd === '/help') return send(p.ws, { type: 'chat', sys: 'info', text: 'Commandes : /god (chef du groupe : panneau admin), /aide' });
    send(p.ws, { type: 'chat', sys: 'warn', text: `Commande inconnue : ${cmd}` });
  }
  admin(p, d) {
    if (!p.god) return;
    switch (d.cmd) {
      case 'spawn': {
        const n = clamp(Math.floor(num(d.n, 1)), 1, 10);
        const kind = W.MONSTERS[d.kind] ? d.kind : 'brute';
        for (let i = 0; i < n; i++) this.spawnMonster(clamp(num(d.x) + (Math.random() - 0.5) * 3, -W.WORLD_LIMIT, W.WORLD_LIMIT), clamp(num(d.z) + (Math.random() - 0.5) * 3, -W.WORLD_LIMIT, W.WORLD_LIMIT), kind);
        break;
      }
      case 'day': this.time = W.START_TIME; this.startDay(); break;
      case 'dusk':
        if (this.isNight()) { this.time = W.START_TIME; this.startDay(); }
        this.time = W.DAY_LEN - W.DUSK_WARN;
        this.broadcast({ type: 'clock', time: this.time, night: this.night });
        break;
      case 'night': if (!this.isNight()) { this.time = W.DAY_LEN; this.startNight(); } break;
      case 'invuln': p.invuln = !p.invuln; break;
      case 'free': p.free = !p.free; break;
      case 'give': this.inv.wood += 50; this.inv.stone += 50; this.inv.twig += 50; this.sendInv(null, { wood: 50, stone: 50, twig: 50 }); break;
      case 'kill': for (const m of [...this.monsters.values()]) this.killMonster(m, false); break;
      case 'loot': this.dropLoot(p.x + 1.5, p.z, d.r != null ? clamp(Math.floor(num(d.r)), 0, 5) : null); break;
      case 'heal': this.gem.hp = W.GEM_HP; this.broadcast({ type: 'gem', gem: this.gem }); break;
      case 'tp': p.x = clamp(num(d.x), -W.WORLD_LIMIT, W.WORLD_LIMIT); p.z = clamp(num(d.z), -W.WORLD_LIMIT, W.WORLD_LIMIT); send(p.ws, { type: 'tp', x: p.x, z: p.z }); break;
    }
    send(p.ws, { type: 'god', on: true, invuln: !!p.invuln, free: !!p.free });
  }
}

// ============================================================================
// Connexions
// ============================================================================
let nextPlayerId = 1;
wss.on('connection', (ws) => {
  const p = { id: nextPlayerId++, ws, name: 'Aventurier', where: null, room: null, party: null, x: 0, y: 0, z: 0, ry: 0, inv: { wood: 0, stone: 0 }, hp: 100 };
  let lastChat = 0;

  ws.on('message', (raw) => {
    try { handle(raw); } catch (err) { console.error('Erreur message', err); }
  });
  const handle = (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }

    // ----- Arrivée au village -----
    if (d.type === 'hello') {
      if (p.where) return;
      const a = authenticate(d, p);
      if (a.err) return send(ws, { type: 'authErr', text: a.err });
      p.name = a.name;
      const { token, prof } = getProfile(a.token, p.name);
      p.token = token; p.prof = prof;
      // la classe est choisie une fois (création du héros), ensuite on la change à l'inventaire (3 éclats)
      if (!W.skinOk(prof.skin)) prof.skin = W.skinOk(d.skin) ? d.skin : W.SKINS[0].id;
      p.skin = prof.skin;
      prof.items ||= []; prof.equip ||= {};
      hub.enter(p);
      console.log(`+ ${p.name} au village (${hub.players.size})`);
      return;
    }
    if (!p.where) return;

    // Réinitialiser l'arbre de compétences : tous les éclats dépensés sont rendus, moins 3
    if (d.type === 'resetSkills') {
      const prof = p.prof;
      const spent = prof.skills.reduce((t, id) => t + (W.SKILL_BY_ID[id]?.cost || 0), 0);
      if (!prof.skills.length) return send(ws, { type: 'toast', text: 'Aucune compétence à réinitialiser.' });
      if (prof.shards + spent < W.SKILL_RESET_COST) return send(ws, { type: 'toast', text: `Il faut ${W.SKILL_RESET_COST} éclats pour réinitialiser.` });
      prof.shards = prof.shards + spent - W.SKILL_RESET_COST;
      prof.skills = [];
      saveJSON('profiles.json', profiles);
      sendProfile(p);
      send(ws, { type: 'toast', text: `Arbre réinitialisé : ${spent - W.SKILL_RESET_COST} éclats rendus.` });
      return;
    }
    if (d.type === 'buySkill') {
      const s = W.SKILL_BY_ID[d.id];
      const prof = p.prof;
      if (!s || prof.skills.includes(s.id)) return;
      if (!s.req.every((r) => prof.skills.includes(r))) return send(ws, { type: 'toast', text: 'Achète d’abord les compétences précédentes.' });
      if (prof.shards < s.cost) return send(ws, { type: 'toast', text: 'Pas assez d’éclats.' });
      prof.shards -= s.cost;
      prof.skills.push(s.id);
      saveJSON('profiles.json', profiles);
      sendProfile(p);
      send(ws, { type: 'skillBought', id: s.id });
      return;
    }

    // ----- Inventaire / équipement (au village comme en partie) -----
    if (d.type === 'equip' || d.type === 'unequip' || d.type === 'discard') {
      const prof = p.prof, items = (prof.items ||= []), eq = (prof.equip ||= {});
      if (d.type === 'equip') {
        const it = items.find((i) => i.id === d.id);
        if (!it || (it.cls && it.cls !== p.skin)) return send(ws, { type: 'toast', text: 'Cet objet est pour une autre classe.' });
        eq[it.slot] = it.id;
      } else if (d.type === 'unequip') {
        if (!W.SLOT_BY_ID[d.slot]) return;
        delete eq[d.slot];
      } else {
        const i = items.findIndex((x) => x.id === d.id);
        if (i < 0) return;
        for (const k in eq) if (eq[k] === d.id) delete eq[k];
        items.splice(i, 1);
      }
      refreshMods(p);
      saveJSON('profiles.json', profiles);
      sendProfile(p);
      return;
    }

    if (p.where === 'hub') {
      switch (d.type) {
        case 'setClass': {
          if (!W.skinOk(d.skin) || d.skin === p.skin) return;
          if (p.prof.shards < W.CLASS_CHANGE_COST) return send(ws, { type: 'toast', text: `Changer de classe coûte ${W.CLASS_CHANGE_COST} éclats.` });
          p.prof.shards -= W.CLASS_CHANGE_COST;
          p.prof.skin = p.skin = d.skin;
          // l'arme et la tenue de l'ancienne classe sont rangées
          for (const k of ['weapon', 'chest']) { const it = (p.prof.items || []).find((i) => i.id === p.prof.equip?.[k]); if (it && it.cls && it.cls !== p.skin) delete p.prof.equip[k]; }
          saveJSON('profiles.json', profiles);
          sendProfile(p);
          hub.broadcast({ type: 'hubSkin', id: p.id, skin: p.skin });
          send(ws, { type: 'toast', text: `Tu joues maintenant ${W.CLASS_NAMES[p.skin]} !` });
          break;
        }
        case 'hubMove':
          p.x = clamp(num(d.x), -60, 60); p.y = num(d.y); p.z = clamp(num(d.z), -60, 60); p.ry = num(d.ry);
          hub.broadcast({ type: 'hubMove', id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, s: clamp(num(d.s), 0, 12), g: d.g !== false }, p);
          break;
        case 'act': hub.broadcast({ type: 'act', id: p.id, k: ['slash', 'cleave', 'staff', 'shoot', 'punch'].includes(d.k) ? d.k : 'slash' }, p); break;
        case 'block': hub.broadcast({ type: 'act', id: p.id, k: 'block', on: !!d.on }, p); break;
        case 'punch': {
          const t = hub.players.get(num(d.id)), now = Date.now();
          if (!t || t === p || now - (p.lastPunch || 0) < W.PUNCH.cd * 1000) return;
          if (Math.hypot(t.x - p.x, t.z - p.z) > W.PUNCH.reach + 0.8) return;
          p.lastPunch = now;
          hub.broadcast({ type: 'punch', from: p.id, to: t.id, dir: Math.atan2(t.x - p.x, t.z - p.z), stun: W.PUNCH.stun });
          break;
        }
        case 'hubDash': hub.broadcast({ type: 'act', id: p.id, k: 'dash', dir: 0 }, p); break;
        case 'hubJump2': hub.broadcast({ type: 'act', id: p.id, k: 'jump2' }, p); break;
        case 'chat': {
          const text = String(d.text || '').trim().slice(0, 200);
          const now = Date.now();
          if (!text || now - lastChat < 400) return;
          lastChat = now;
          if (text.startsWith('/')) return send(ws, { type: 'chat', sys: 'info', text: 'Les commandes ne marchent qu’en partie.' });
          hub.broadcast({ type: 'chat', from: p.name, color: p.color, text });
          break;
        }
        case 'invite': {
          const t = hub.players.get(num(d.id));
          if (!t || t === p) return;
          if (p.party && p.party.leader !== p.id) return send(ws, { type: 'toast', text: 'Seul le chef du groupe peut inviter.' });
          if (p.party && p.party.members.includes(t)) return;
          if (p.party && p.party.members.length >= W.MAX_PLAYERS) return send(ws, { type: 'toast', text: 'Ton groupe est complet (4 joueurs).' });
          const now = Date.now();
          p.invites = p.invites || {};
          if (now - (p.invites[t.id] || 0) < 5000) return;
          p.invites[t.id] = now;
          t.pendingFrom = t.pendingFrom || {};
          t.pendingFrom[p.id] = now;
          send(t.ws, { type: 'invited', from: p.id, name: p.name });
          send(ws, { type: 'toast', text: `Invitation envoyée à ${t.name}` });
          break;
        }
        case 'inviteReply': {
          const from = hub.players.get(num(d.from));
          if (!from || !p.pendingFrom || !p.pendingFrom[from.id]) return;
          delete p.pendingFrom[from.id];
          if (!d.accept) return send(from.ws, { type: 'toast', text: `${p.name} a refusé l’invitation` });
          joinParty(p, from);
          break;
        }
        case 'partyLeave': leaveParty(p); break;
        case 'launch': {
          const party = p.party;
          if (party && party.leader !== p.id) return send(ws, { type: 'toast', text: 'Seul le chef du groupe peut lancer la partie.' });
          const members = party ? party.members.filter((m) => m.where === 'hub') : [p];
          if (party && members.length !== party.members.length) return send(ws, { type: 'toast', text: 'Un membre du groupe est encore en partie.' });
          const room = new Room(members);
          room.welcomeAll();
          if (party) sendParty(party);
          break;
        }
      }
      return;
    }

    const R = p.room;
    if (!R) return;
    switch (d.type) {
      case 'move':
        if (p.dead) return;
        p.x = clamp(num(d.x), -150, 150); p.y = num(d.y); p.z = clamp(num(d.z), -150, 150); p.ry = num(d.ry);
        R.broadcast({ type: 'move', id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, s: clamp(num(d.s), 0, 12), g: d.g !== false, tl: clamp(Math.floor(num(d.tl)), 0, 3) }, p);
        break;
      case 'act':
        R.broadcast({
          type: 'act', id: p.id, k: ['slash', 'chop', 'mine', 'hammer', 'cleave', 'staff', 'shoot', 'punch'].includes(d.k) ? d.k : 'slash', sp: clamp(num(d.sp, 1), 0.5, 3),
          to: d.to && typeof d.to === 'object' ? { x: num(d.to.x), y: num(d.to.y), z: num(d.to.z) } : undefined,
        }, p);
        break;
      case 'hit': R.hitResource(p, d.id); break;
      case 'hitM': R.hitMonster(p, d.id, d); break;
      case 'dash': {
        const now = Date.now();
        if (now - (p.lastDash || 0) < 250 || p.dead) return;
        p.lastDash = now; p.dashHits = 0;
        if (p.mods.dodge) p.dodgeUntil = now + W.DASH.dodge * 1000;
        R.broadcast({ type: 'act', id: p.id, k: 'dash', dir: clamp(Math.floor(num(d.dir)), 0, 3) }, p);
        break;
      }
      case 'dashHit': R.dashHit(p, d.ids); break;
      case 'jump2': R.broadcast({ type: 'act', id: p.id, k: 'jump2' }, p); break;
      case 'block':
        p.blocking = !!d.on && W.classOf(p.skin).block > 0;
        R.broadcast({ type: 'act', id: p.id, k: 'block', on: p.blocking }, p);
        break;
      case 'build': R.build(p, d); break;
      case 'demolish': R.demolish(p, d.id); break;
      case 'repair': R.repair(p, d.id); break;
      case 'lootTake': R.takeLoot(p, d.id); break;
      case 'punch': R.punch(p, d.id); break;
      case 'gemPick': R.pickGem(p); break;
      case 'relicPick': R.pickRelic(p); break;
      case 'gemDrop': R.dropGem(d.x, d.z, d.y, p); break;
      case 'chat': {
        const now = Date.now();
        if (now - lastChat < 400) return;
        lastChat = now;
        R.chat(p, d.text);
        break;
      }
      case 'admin': R.admin(p, d); break;
      case 'backToHub': R.removePlayer(p, true); break;
    }
  };

  ws.on('close', () => {
    if (p.room) p.room.removePlayer(p, false);
    hub.leave(p);
    leaveParty(p);
    if (p.where) console.log(`- ${p.name} (${hub.players.size} au village)`);
  });
});

server.listen(PORT, () => console.log(`Jeu lancé sur http://localhost:${PORT}`));
