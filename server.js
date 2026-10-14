// Serveur du jeu : sert les fichiers du dossier "public", relaie les positions et
// actions des joueurs, et garde l'état des arbres et rochers (vie, détruits, repousse).
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3001;
const RESPAWN_MS = 90 * 1000;          // un arbre / rocher détruit revient après 90 s
const MAX_HP = { t: 5, r: 4 };         // t = arbre, r = rocher (identique à nature.js)
const HIT_COOLDOWN_MS = 200;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
// Three.js (moteur 3D) servi directement depuis node_modules
app.use('/lib/three', express.static(path.join(__dirname, 'node_modules', 'three')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const players = new Map(); // id -> joueur
const resources = new Map(); // id -> { hp, dead }
let nextId = 1;
const COLORS = [0xc0392b, 0x2e6fd8, 0x27ae60, 0xd4a017, 0x8e44ad, 0xd35400, 0x16a085, 0xd6458f];

function broadcast(data, exceptWs) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== exceptWs && client.readyState === 1) client.send(msg);
  }
}
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

wss.on('connection', (ws) => {
  let me = null;
  let lastHit = 0;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'join' && !me) {
      const name = String(data.name || 'Aventurier').slice(0, 16);
      me = {
        id: nextId++, name,
        color: COLORS[(nextId - 2) % COLORS.length],
        x: (Math.random() - 0.5) * 6, y: 0, z: (Math.random() - 0.5) * 6,
        ry: 0, s: 0, g: true,
      };
      players.set(me.id, me);
      const dead = [], hp = [];
      for (const [id, r] of resources) { if (r.dead) dead.push(id); else if (r.hp < MAX_HP[id[0]]) hp.push([id, r.hp]); }
      ws.send(JSON.stringify({ type: 'welcome', you: me, players: [...players.values()].filter((p) => p.id !== me.id), dead, hp }));
      broadcast({ type: 'join', player: me }, ws);
      console.log(`+ ${me.name} (#${me.id}) — ${players.size} joueur(s)`);
      return;
    }
    if (!me) return;

    if (data.type === 'move') {
      me.x = num(data.x); me.y = num(data.y); me.z = num(data.z); me.ry = num(data.ry);
      me.s = Math.min(12, Math.max(0, num(data.s))); me.g = data.g !== false;
      broadcast({ type: 'move', id: me.id, x: me.x, y: me.y, z: me.z, ry: me.ry, s: me.s, g: me.g }, ws);
    }

    if (data.type === 'act') {
      const k = ['slash', 'chop', 'mine'].includes(data.k) ? data.k : 'slash';
      broadcast({ type: 'act', id: me.id, k }, ws);
    }

    if (data.type === 'hit') {
      const id = String(data.id);
      if (!/^[tr]\d{1,3}$/.test(id)) return;
      const now = Date.now();
      if (now - lastHit < HIT_COOLDOWN_MS) return;
      lastHit = now;
      let r = resources.get(id);
      if (!r) { r = { hp: MAX_HP[id[0]], dead: false }; resources.set(id, r); }
      if (r.dead) return;
      r.hp--;
      broadcast({ type: 'hit', id, hp: r.hp, by: me.id, fx: me.x, fz: me.z });
      if (r.hp <= 0) {
        r.dead = true;
        broadcast({ type: 'destroy', id, dx: num(data.dx), dz: num(data.dz) });
        setTimeout(() => {
          r.dead = false; r.hp = MAX_HP[id[0]];
          broadcast({ type: 'respawn', id });
        }, RESPAWN_MS);
      }
    }
  });

  ws.on('close', () => {
    if (!me) return;
    players.delete(me.id);
    broadcast({ type: 'leave', id: me.id });
    console.log(`- ${me.name} (#${me.id}) — ${players.size} joueur(s)`);
  });
});

server.listen(PORT, () => console.log(`Jeu lancé sur http://localhost:${PORT}`));
