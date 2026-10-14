// Serveur du jeu : sert les fichiers du dossier "public" et relaie
// les positions des joueurs entre eux via WebSocket.
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3001;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const players = new Map(); // id -> { id, name, color, x, y, z, ry, anim }
let nextId = 1;
const COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xff69b4];

function broadcast(data, exceptWs) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== exceptWs && client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  let me = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'join' && !me) {
      const name = String(data.name || 'Aventurier').slice(0, 16);
      me = {
        id: nextId++,
        name,
        color: COLORS[(nextId - 2) % COLORS.length],
        x: (Math.random() - 0.5) * 6, y: 0, z: (Math.random() - 0.5) * 6,
        ry: 0, anim: 'idle'
      };
      players.set(me.id, me);
      // On envoie au nouveau joueur son identité + la liste des autres
      ws.send(JSON.stringify({ type: 'welcome', you: me, players: [...players.values()].filter(p => p.id !== me.id) }));
      broadcast({ type: 'join', player: me }, ws);
      console.log(`+ ${me.name} (#${me.id}) — ${players.size} joueur(s)`);
    }

    if (data.type === 'move' && me) {
      // Vérifications minimales pour éviter des valeurs absurdes
      const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
      me.x = num(data.x); me.y = num(data.y); me.z = num(data.z);
      me.ry = num(data.ry); me.anim = data.anim === 'run' ? 'run' : data.anim === 'walk' ? 'walk' : 'idle';
      broadcast({ type: 'move', id: me.id, x: me.x, y: me.y, z: me.z, ry: me.ry, anim: me.anim }, ws);
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
