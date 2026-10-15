import * as THREE from 'three';
import * as W from './world.js';
import { heightAt, WORLD_LIMIT, WATER_LEVEL } from './world.js';
import { createGround, River } from './terrain.js';
import { Sky } from './sky.js';
import { Grass } from './grass.js';
import { Nature } from './nature.js';
import { CharacterRig, TOOLS } from './character.js';
import { Monsters } from './monster.js';
import { Gem } from './gem.js';
import { Buildings } from './buildings.js';
import { AudioEngine } from './audio.js';
import { WorldMap } from './map.js';
import { Village, villageHeight, SPOTS, SPAWN } from './village.js';
import { Features } from './features.js';
import { settings, saveSettings, keyLabel, ACTIONS, DEFAULT_KEYS, lsGet, lsSet } from './settings.js';
import { loadModels, modelIcon, propIcon, staticGeometry, atlasMaterial, characterPortrait, prop } from './models.js';

const $ = (id) => document.getElementById(id);

// ===================== Modèles 3D (Pirate Kit) =====================
$('conn-state').textContent = 'Chargement des modèles 3D…';
await loadModels((k) => { $('conn-state').textContent = `Chargement des modèles 3D… ${Math.round(k * 100)} %`; });
$('conn-state').textContent = 'Connexion au serveur…';
{
  // icônes de l'inventaire dessinées à partir des modèles
  const st = document.createElement('style');
  st.textContent = `.ico.wood { background: url(${modelIcon('Wood', 64, 0.9, 0.5)}) center / contain no-repeat; border-radius: 0; width: 20px; height: 20px; vertical-align: middle; }
.ico.stone { background: url(${modelIcon("Rocks", 64, 0.4, 0.35)}) center / contain no-repeat; border-radius: 0; width: 20px; height: 20px; vertical-align: middle; }`;
  document.head.appendChild(st);
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const hex = (c) => '#' + (c ?? 0xffffff).toString(16).padStart(6, '0');

// ===================== Réglages =====================
const WALK_SPEED = 4.2;
const RUN_SPEED = 8;
const JUMP_FORCE = 7;
const GRAVITY = 20;
const SEND_RATE = 1000 / 15;
const REACH = 1.7;
const PLAYER_RADIUS = 0.35;
const QUALITY = new URLSearchParams(location.search).get('q') || settings.quality;
const Q = {
  high: { grass: 75000, shadow: 2048, ratio: 1.75 },
  low: { grass: 25000, shadow: 1024, ratio: 1 },
  test: { grass: 6000, shadow: 512, ratio: 1 },
}[QUALITY] || { grass: 75000, shadow: 2048, ratio: 1.75 };

// ===================== Rendu =====================
const renderer = new THREE.WebGLRenderer({ antialias: QUALITY === 'high', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.ratio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa0c0e0, 35, 170);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a5a30, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(Q.shadow, Q.shadow);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const wind = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(1, 0, 0.6) } };
const audio = new AudioEngine();
audio.setVolumes({ master: settings.master / 100, music: settings.music / 100, amb: settings.amb / 100, sfx: settings.sfx / 100 });

// Le monde de la partie (caché au village)
const worldRoot = new THREE.Group();
scene.add(worldRoot);
createGround(worldRoot);
const river = new River(worldRoot);
const sky = new Sky(scene);
const grass = new Grass(scene, wind, Q.grass);
const nature = new Nature(worldRoot, wind);
const fx = nature.fx;
const gem = new Gem(worldRoot, fx);
const buildings = new Buildings(worldRoot, fx, audio);
const monsters = new Monsters(worldRoot, fx, audio);
const features = new Features(worldRoot, fx, audio);
nature.audio = audio;
const worldMap = new WorldMap();
const village = new Village(scene, nature);
village.root.visible = false;

// ===================== État =====================
const me = {
  id: null, rig: null, pos: new THREE.Vector3(), vy: 0, grounded: true, ry: 0, speed: 0,
  hp: W.PLAYER_HP, maxHp: W.PLAYER_HP, dead: false, deadT: 0, attackTarget: null, attackMonster: null, attackDir: 0,
  inv: { wood: 0, stone: 0, twig: 0 }, name: '', color: 0x2e6fd8, power: 0,
};
const profile = { token: lsGet('rpg3d_token') || '', shards: 0, skills: [], best: 0 };
let mods = W.skillMods([]);
const others = new Map();
const game = {
  scene: 'title',   // 'title' | 'hub' | 'game'
  solo: false, host: null, survived: 0,
  clock: { time: W.START_TIME, night: 0 },
  god: { on: false, invuln: false, free: false },
  build: { on: false, piece: 0, plan: null },
  mode: null,       // panneau ouvert : null | 'chat' | 'map' | 'admin' | 'pause' | 'skills' | 'board' | 'launch' | 'players'
  tpMode: false, over: false,
  party: { id: null, leader: null, members: [] },
  hubPlayers: new Map(),
  board: { 1: [], 2: [], 3: [], 4: [] },
  invite: null,
  relic: { taken: false },
};
let camYaw = 0, camPitch = 0.3, camDist = 6, camShake = 0, camCaveK = 0;
const camTarget = new THREE.Vector3();
const keys = {};
let mouseHeld = false;
const pressed = (action) => !!keys[settings.keys[action]];
const inHub = () => game.scene === 'hub';
const inGame = () => game.scene === 'game';
const playing = () => game.scene === 'hub' || game.scene === 'game';

// Sol sous les pieds, selon l'endroit où l'on est
const terrainH = (x, z) => (inHub() ? villageHeight(x, z) : heightAt(x, z));
const groundH = (x, z, feetY) => (inHub() ? village.groundAt(x, z, feetY) : buildings.groundAt(x, z, feetY, heightAt(x, z)));

// ===================== Souris capturée =====================
const canvas = renderer.domElement;
const isLocked = () => document.pointerLockElement === canvas;
function lockMouse() {
  if (!playing() || isLocked()) return;
  try {
    const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { const p2 = canvas.requestPointerLock(); if (p2 && p2.catch) p2.catch(() => {}); });
  } catch { /* le navigateur refuse : on reste en mode menu */ }
}
document.addEventListener('pointerlockchange', () => {
  mouseHeld = false;
  if (!isLocked() && playing()) {
    if (game.mode === 'chat') closeChat(false);
    if (!game.mode) setMode('pause');
  }
  updateStatus();
});
canvas.addEventListener('mousedown', (e) => {
  if (!playing()) return;
  if (!isLocked()) { if (!game.mode || game.mode === 'pause') { setMode(null); lockMouse(); } return; }
  if (e.button === 0) {
    mouseHeld = true;
    if (game.build.on) placePiece();
  }
  if (e.button === 2 && game.build.on) demolishPiece();
  else if (e.button === 2) setBlock(true);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mouseup', (e) => { if (e.button === 0) mouseHeld = false; if (e.button === 2) setBlock(false); });
// Parade du guerrier (clic droit maintenu)
function setBlock(on) {
  if (!me.rig || !me.rig.cls.block) return;
  if (on && (me.dead || game.build.on || (inGame() && gem.state.carrier === me.id))) on = false;
  if (me.rig.blocking === on) return;
  me.rig.blocking = on;
  send({ type: 'block', on });
}
addEventListener('mousemove', (e) => {
  if (!isLocked()) return;
  const s = 0.0025 * settings.sens / 100;
  camYaw -= e.movementX * s;
  camPitch = clamp(camPitch + e.movementY * s, -0.45, 1.25);
});
addEventListener('wheel', (e) => {
  if (!playing() || (game.mode && game.mode !== 'chat')) return;
  if (game.build.on && !e.shiftKey) {
    // molette : monter / descendre d'un étage
    game.build.lift = clamp((game.build.lift || 0) + (e.deltaY < 0 ? 1 : -1), -1, W.MAX_LEVEL);
    renderBuildBar();
    audio.play('ui');
    return;
  }
  if (game.build.on) {
    const n = W.PIECE_ORDER.length;
    let i = game.build.piece;
    for (let k = 0; k < n; k++) { i = (i + (e.deltaY > 0 ? 1 : -1) + n) % n; if (game.god.free || W.pieceUnlocked(W.PIECE_ORDER[i], mods)) break; }
    selectPiece(i);
    return;
  }
  camDist = clamp(camDist + e.deltaY * 0.01, 2.5, 14);
}, { passive: true });

// ===================== Panneaux =====================
const PANELS = ['pause', 'admin', 'mapview', 'skills', 'board', 'launch', 'players', 'craft'];
function setMode(m) {
  game.mode = m;
  const map = { pause: 'pause', admin: 'admin', map: 'mapview', skills: 'skills', board: 'board', launch: 'launch', players: 'players', craft: 'craft' };
  for (const id of PANELS) $(id).hidden = map[m] !== id;
  $('mapview').classList.toggle('tp', m === 'map' && game.tpMode);
  if (m !== 'map') game.tpMode = false;
  const needsMouse = m && m !== 'chat' && !(m === 'map' && !game.tpMode);
  if (needsMouse && isLocked()) document.exitPointerLock();
  $('crosshair').classList.toggle('hidden', !!m && m !== 'chat');
  for (const k in keys) keys[k] = false;
}
function closePanel() { setMode(null); lockMouse(); audio.play('ui'); }
document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = closePanel; });
$('btn-resume').onclick = () => { audio.play('ui'); setMode(null); lockMouse(); };
$('btn-quit').onclick = () => {
  if (inGame()) { send({ type: 'backToHub' }); fade(); }
  setMode(null);
};
$('btn-pause-options').onclick = () => openOptions();

// ===================== Clavier =====================
let rebinding = null;
addEventListener('keydown', (e) => {
  if (rebinding) {
    e.preventDefault();
    if (e.code !== 'Escape') { settings.keys[rebinding] = e.code; saveSettings(); }
    rebinding = null;
    renderKeybinds();
    return;
  }
  if (e.code === 'Escape' && !$('keys-panel').hidden) { $('keys-panel').hidden = true; $('options').hidden = false; return; }
  if (e.code === 'Escape' && !$('options').hidden) { $('options').hidden = true; return; }
  const ae = document.activeElement;
  if (ae && ['INPUT', 'SELECT'].includes(ae.tagName) && ae.id !== 'chat-input') return;
  if (game.mode === 'chat') {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); sendChat(); }
    else if (e.code === 'Escape') closeChat(true);
    return;
  }
  if (!playing()) return;
  keys[e.code] = true;
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  const K = settings.keys;
  // Invitation : Y / N
  if (game.invite && (e.code === 'KeyY' || e.code === 'KeyN')) { answerInvite(e.code === 'KeyY'); return; }
  if (e.code === 'Escape' && game.mode && game.mode !== 'pause') { closePanel(); return; }
  if (game.mode === 'craft' && e.code === K.build) { closePanel(); return; }
  if (e.code === K.chat || e.code === 'NumpadEnter') { e.preventDefault(); if (!game.mode) openChat(); return; }
  if (inHub() && e.code === 'Tab') { if (game.mode === 'players') closePanel(); else if (!game.mode) openPlayers(); return; }
  if (inGame() && e.code === K.map) { toggleMap(false); return; }
  if (game.mode) return;
  if (inGame() && e.code === K.build) openCraft();
  if (inGame() && game.build.on && e.code === K.demolish) demolishPiece();
  if (e.code === K.interact) interact();
  if (game.build.on && /^Digit[1-9]$/.test(e.code)) selectPiece(+e.code.slice(5) - 1);
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseHeld = false; });

// ===================== Chat =====================
const chatLog = $('chat-log'), chatInput = $('chat-input');
function openChat() {
  setMode('chat');
  $('chat').classList.add('open');
  chatInput.hidden = false;
  chatInput.value = '';
  chatInput.placeholder = inGame() ? 'Écris un message… (/god, /aide)' : 'Écris un message à tout le village…';
  setTimeout(() => chatInput.focus(), 0);
}
function closeChat(relock) {
  chatInput.blur();
  chatInput.hidden = true;
  $('chat').classList.remove('open');
  if (game.mode === 'chat') setMode(null);
  if (relock) lockMouse();
}
function sendChat() {
  const t = chatInput.value.trim();
  if (t) send({ type: 'chat', text: t });
  if (t.toLowerCase() === '/god' && game.god.on) { closeChat(false); openAdmin(); return; }
  closeChat(true);
}
function addChat(d) {
  const div = document.createElement('div');
  div.className = 'msg' + (d.sys ? ' ' + d.sys : '');
  if (d.from) {
    const b = document.createElement('b');
    b.textContent = d.from + ' : ';
    b.style.color = hex(d.color);
    div.append(b, document.createTextNode(d.text));
  } else div.textContent = d.text;
  chatLog.append(div);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
  setTimeout(() => div.classList.add('old'), 12000);
}
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.remove(), 3600);
}

// ===================== Carte =====================
function toggleMap(tp) {
  if (game.mode === 'map') { setMode(null); if (!isLocked()) lockMouse(); return; }
  if (game.mode && game.mode !== 'admin') return;
  game.tpMode = tp;
  setMode('map');
  $('map-hint').innerHTML = (tp ? 'Clique sur la carte pour te téléporter · ' : '') + `<span class="kbd">${keyLabel(settings.keys.map)}</span> pour fermer`;
  drawBigMap();
}
$('bigmap').addEventListener('click', (e) => {
  if (!game.tpMode) return;
  const p = worldMap.worldFromClick($('bigmap'), e);
  send({ type: 'admin', cmd: 'tp', x: p.x, z: p.z });
  game.tpMode = false;
  setMode(null);
  lockMouse();
});
function mapData() {
  return {
    me: { x: me.pos.x, z: me.pos.z, ry: me.ry },
    others: [...others.values()].map((o) => ({ x: o.rig.root.position.x, z: o.rig.root.position.z, ry: o.rig.root.rotation.y, color: hex(o.color), name: o.name })),
    monsters: [...monsters.map.values()].filter((m) => !m.dead).map((m) => ({ x: m.rig.root.position.x, z: m.rig.root.position.z, kind: m.kind })),
    resources: nature.list, buildings: [...buildings.map.values()],
    gem: { x: gem.pos.x, z: gem.pos.z }, camYaw, relic: game.relic,
  };
}
function drawBigMap() { worldMap.drawFull($('bigmap'), mapData(), game.tpMode); }

// ===================== Admin =====================
function openAdmin() {
  setMode('admin');
  $('admin-invuln').checked = game.god.invuln;
  $('admin-free').checked = game.god.free;
}
$('admin-close').onclick = closePanel;
document.querySelectorAll('[data-admin]').forEach((b) => {
  b.onclick = () => {
    audio.play('ui');
    const c = b.dataset.admin;
    if (c === 'tp') { toggleMap(true); return; }
    if (['spawn', 'spawn5', 'runner', 'spitter', 'tank'].includes(c)) {
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      send({ type: 'admin', cmd: 'spawn', n: c === 'spawn5' ? 5 : 1, kind: c === 'runner' || c === 'spitter' || c === 'tank' ? c : 'brute', x: me.pos.x + fx * 8, z: me.pos.z + fz * 8 });
      return;
    }
    send({ type: 'admin', cmd: c });
  };
});
$('admin-invuln').onchange = () => send({ type: 'admin', cmd: 'invuln' });
$('admin-free').onchange = () => send({ type: 'admin', cmd: 'free' });

// ===================== Options =====================
function openOptions() {
  $('options').hidden = false;
  for (const [id, key] of [['vol-master', 'master'], ['vol-music', 'music'], ['vol-amb', 'amb'], ['vol-sfx', 'sfx'], ['sens', 'sens']]) {
    const el = $(id);
    el.value = settings[key];
    el.nextElementSibling.textContent = settings[key] + (key === 'sens' ? '%' : '');
    el.oninput = () => {
      settings[key] = +el.value;
      el.nextElementSibling.textContent = el.value + (key === 'sens' ? '%' : '');
      audio.setVolumes({ master: settings.master / 100, music: settings.music / 100, amb: settings.amb / 100, sfx: settings.sfx / 100 });
      saveSettings();
    };
  }
  $('quality').value = settings.quality === 'low' ? 'low' : 'high';
  renderKeybinds();
}
$('quality').onchange = () => {
  settings.quality = $('quality').value; saveSettings();
  if (!playing()) location.reload();
  else toast('Les graphismes changeront au prochain chargement de la page.');
};
$('options-close').onclick = () => { $('options').hidden = true; audio.play('ui'); };
$('btn-title-options').onclick = () => { audio.init(); openOptions(); };
$('btn-fullscreen').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
};
$('btn-keys').onclick = () => { $('options').hidden = true; $('keys-panel').hidden = false; renderKeybinds(); audio.play('ui'); };
$('btn-keys-back').onclick = $('keys-close').onclick = () => { $('keys-panel').hidden = true; $('options').hidden = false; audio.play('ui'); };
$('btn-keys-reset').onclick = () => { settings.keys = { ...DEFAULT_KEYS }; saveSettings(); renderKeybinds(); };
function renderKeybinds() {
  const box = $('keybinds');
  box.innerHTML = '';
  for (const [action, label] of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'keybind';
    const btn = document.createElement('button');
    btn.textContent = rebinding === action ? '…' : keyLabel(settings.keys[action]);
    if (rebinding === action) btn.classList.add('wait');
    btn.onclick = () => { rebinding = action; renderKeybinds(); };
    row.append(document.createTextNode(label), btn);
    box.append(row);
  }
  updateHelp();
}
addEventListener('layoutready', () => { renderKeybinds(); renderBuildBar(); });
function updateHelp() {
  const K = settings.keys;
  $('help').textContent = inHub()
    ? `${keyLabel(K.interact)} : interagir · Tab : joueurs · ${keyLabel(K.chat)} : chat · Échap : menu`
    : `Clic : frapper · ${keyLabel(K.build)} : construction · ${keyLabel(K.interact)} : Joyau · ${keyLabel(K.map)} : carte · ${keyLabel(K.chat)} : chat · Échap : menu`;
  $('launch-key').textContent = keyLabel(K.interact);
}

// ===================== Réseau =====================
let ws = null;
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => { $('conn-state').textContent = '● Connecté'; $('conn-state').style.color = '#7fd87f'; };
  ws.onclose = () => {
    $('conn-state').textContent = '● Déconnecté — recharge la page';
    $('conn-state').style.color = '#ff8a7a';
    if (playing()) { addChat({ sys: 'warn', text: 'Connexion perdue avec le serveur. Recharge la page (F5).' }); toast('Connexion perdue — recharge la page (F5)'); }
    updateStatus();
  };
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    const h = handlers[d.type];
    if (h) h(d);
  };
}

const handlers = {
  toast: (d) => toast(d.text),
  profile: (d) => {
    const before = profile.shards;
    Object.assign(profile, { token: d.token, shards: d.shards, skills: d.skills, best: d.best });
    lsSet('rpg3d_token', d.token);
    mods = W.skillMods(profile.skills);
    $('shards-n').textContent = profile.shards;
    if (game.mode === 'skills') renderSkills();
    if (inGame() && d.shards > before) popup(`+${d.shards - before} ◆ éclats`, '#d8b8ff');
  },
  skillBought: (d) => {
    const s = W.SKILL_BY_ID[d.id];
    audio.play('anvil', village.anvilPos);
    audio.play('levelUp');
    toast(`Compétence apprise : ${s?.name ?? ''}`);
  },
  leaderboard: (d) => { game.board = d.board; village.drawBoard(d.board); if (game.mode === 'board') renderBoard(); },
  hubWelcome: (d) => enterHub(d),
  hubJoin: (d) => { game.hubPlayers.set(d.player.id, d.player); addOther(d.player); if (game.mode === 'players') renderPlayers(); },
  hubLeave: (d) => { game.hubPlayers.delete(d.id); removeOther(d.id); if (game.mode === 'players') renderPlayers(); },
  hubMove: (d) => {
    const o = others.get(d.id);
    if (!o) return;
    o.target.set(d.x, d.y, d.z); o.ry = d.ry; o.s = d.s; o.g = d.g;
  },
  hubParty: (d) => {
    for (const id of d.members) { const p = game.hubPlayers.get(id); if (p) p.party = d.party; }
    if (game.mode === 'players') renderPlayers();
  },
  party: (d) => {
    game.party = { id: d.id, leader: d.leader, members: d.members };
    renderParty();
    if (game.mode === 'launch') renderLaunch();
    if (game.mode === 'players') renderPlayers();
  },
  invited: (d) => {
    game.invite = { from: d.from, name: d.name, t: performance.now() };
    $('invite-text').textContent = `${d.name} t'invite dans son groupe`;
    $('invite').hidden = false;
    audio.play('gemPick');
  },
  welcome: (d) => enterGame(d),
  join: (d) => { addOther(d.player); updateStatus(); },
  leave: (d) => { removeOther(d.id); updateStatus(); },
  host: (d) => { game.host = d.host; updateStatus(); },
  move: (d) => {
    const o = others.get(d.id);
    if (!o) return;
    o.target.set(d.x, d.y, d.z); o.ry = d.ry; o.s = d.s; o.g = d.g;
    if (!o.rig.attacking) o.rig.setTool(TOOLS[d.tl] || o.rig.weapon);
  },
  act: (d) => {
    const o = others.get(d.id);
    if (!o) return;
    if (d.k === 'block') { o.rig.blocking = !!d.on; return; }
    o.rig.attack(d.k, d.sp || 1);
    if (d.k === 'slash' || d.k === 'cleave' || d.k === 'staff') audio.play('swing', o.rig.root.position);
    // flèche des autres joueurs : partie au moment où la corde est lâchée
    if (d.k === 'shoot' && d.to) setTimeout(() => { if (o.rig) shootArrow(o.rig, d.to, null); }, 0.95 * 0.78 * 1000 / (d.sp || 1));
    if (d.k === 'staff' && d.to) setTimeout(() => fireBurst(new THREE.Vector3(d.to.x, heightAt(d.to.x, d.to.z), d.to.z)), 0.6 * 0.55 * 1000 / (d.sp || 1));
  },
  inv: (d) => {
    // inventaire commun au groupe
    serverInv = { ...d.inv };
    if (d.gain && d.from) {
      // les ressources s'ajoutent au compteur au fur et à mesure qu'elles arrivent
      for (const k in d.gain) flyPending[k] += d.gain[k];
      flyResources(d.from, d.gain);
      syncInv();
    } else {
      syncInv();
      if (d.gain) for (const k in d.gain) popup(`${d.by ? d.by + ' ' : ''}+${d.gain[k]} ${W.RES_NAMES[k]}`, RES_COL[k]);
    }
  },
  tShot: (d) => {
    const m = monsters.map.get(d.m);
    if (!m) return;
    buildings.shoot(d.id, m.rig.root.position.clone().add(new THREE.Vector3(0, 1.1 * m.rig.T.scale, 0)));
    m.hp = d.hp; m.rig.setHp(d.hp / m.max);
  },
  frostPulse: (d) => buildings.pulse(d.id),
  relic: (d) => {
    game.relic = d.relic;
    features.setRelic(true);
    audio.play('gemPick', new THREE.Vector3(W.RELIC_POS.x, 2, W.RELIC_POS.z));
    if (d.by === me.id) {
      me.power = d.night;
      showBanner('Larme de la cascade', `Tes coups tueront net les monstres pendant la nuit ${d.night}`, 4500);
    } else { const o = others.get(d.by); if (o) o.power = d.night; }
    updatePowerHud();
  },
  power: (d) => {
    if (d.id === me.id) me.power = d.night; else { const o = others.get(d.id); if (o) o.power = d.night; }
    updatePowerHud();
  },
  bHp: (d) => buildings.setHp(d.id, d.hp),
  resHit: (d) => {
    nature.setHp(d.id, d.hp);
    if (d.by !== me.id) {
      nature.hit(d.id, d.fx, d.fz);
      const r = nature.resources.get(d.id);
      if (r) audio.play(r.kind === 'tree' ? 'chop' : r.kind === 'bush' ? 'bushHit' : 'pick', new THREE.Vector3(r.x, r.y + 1, r.z));
    }
  },
  resDestroy: (d) => {
    const r = nature.resources.get(d.id);
    nature.destroy(d.id, d.dx, d.dz);
    if (r && currentTarget === r) currentTarget = null;
  },
  resSpawn: (d) => nature.add(d.res, true),
  bAdd: (d) => { buildings.add(d.b, false); grass.setMask(buildings.floors()); },
  bDone: (d) => buildings.done(d.id),
  bHit: (d) => buildings.hit(d.id, d.hp),
  bDel: (d) => { buildings.remove(d.id, d.broken); grass.setMask(buildings.floors()); },
  mSpawn: (d) => monsters.spawn(d.m, false),
  m: (d) => monsters.sync(d.l),
  mAtk: (d) => monsters.attack(d.id),
  mShot: (d) => monsters.shot(d),
  mBurn: (d) => monsters.ignite(d.id, d.t),
  mHurt: (d) => {
    if (d.spike || d.burn) { const m = monsters.map.get(d.id); if (m) { m.hp = d.hp; m.rig.setHp(d.hp / m.max); if (d.spike) m.rig.hurt(); } return; }
    monsters.hurt(d.id, d.hp);
    if (d.by !== me.id) { const m = monsters.map.get(d.id); if (m) audio.play('swordHit', m.rig.root.position); }
  },
  mDie: (d) => monsters.die(d.id, d.burn),
  pHp: (d) => {
    if (d.id === me.id) {
      const before = me.hp;
      me.hp = d.hp;
      if (d.max) me.maxHp = d.max;
      if (d.hurt && d.hp < before && d.blocked) {
        // coup paré par le bouclier
        audio.play('shieldBlock', me.pos);
        camShake = 0.12;
        popup('Paré !', '#ffe08a');
      } else if (d.hurt && d.hp < before) {
        me.rig?.hurt();
        audio.play('playerHurt');
        vignetteT = 1;
        camShake = 0.25;
      }
      if (d.heal && d.hp > before) popup(`+${Math.round(d.hp - before)} ❤`, '#ff8a8a');
      updateHp();
    } else {
      const o = others.get(d.id);
      if (!o) return;
      if (d.max) o.maxHp = d.max;
      o.rig.setHp(d.hp / (o.maxHp || W.PLAYER_HP));
      if (d.hurt) { o.rig.hurt(); audio.play('playerHurt', o.rig.root.position); }
    }
  },
  pDie: (d) => {
    if (d.id === me.id) {
      me.dead = true; me.deadT = 0; me.hp = 0;
      me.rig.die();
      audio.play('playerDie');
      $('death').hidden = false;
      if (game.build.on) toggleBuild();
      updateHp();
    } else {
      const o = others.get(d.id);
      if (o) { o.rig.die(); audio.play('playerDie', o.rig.root.position); }
    }
  },
  pRespawn: (d) => {
    if (d.id === me.id) {
      me.dead = false; me.hp = d.hp ?? me.maxHp;
      me.pos.set(d.x, heightAt(d.x, d.z), d.z); me.vy = 0;
      camTarget.copy(me.pos);
      me.rig.revive();
      $('death').hidden = true;
      updateHp();
    } else {
      const o = others.get(d.id);
      if (o) { o.rig.revive(); o.rig.setHp(1); o.target.set(d.x, heightAt(d.x, d.z), d.z); o.rig.root.position.copy(o.target); }
    }
  },
  gem: (d) => {
    const wasCarrier = gem.state.carrier;
    gem.set(d.gem);
    if (d.ev === 'pick') audio.play('gemPick', gem.pos);
    if (d.ev === 'drop' && wasCarrier) audio.play('gemDrop', gem.pos);
    updateGemHud();
  },
  gemHit: (d) => {
    gem.state.hp = d.hp;
    gem.hit();
    audio.play('gemHit', gem.pos);
    const el = $('gem-hp'); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
    updateGemHud();
  },
  clock: (d) => { game.clock.time = d.time; game.clock.night = d.night; },
  phase: (d) => {
    if (d.phase === 'night') {
      showBanner(`Nuit ${d.night}`, 'Les monstres arrivent sans relâche… Protégez le Joyau !', 4000);
      audio.stinger('night');
    } else {
      game.survived = d.survived;
      showBanner(`Jour ${d.night + 1}`, d.night > 0 ? `Nuit ${d.night} survécue` + (d.shards ? ` · +${d.shards} ◆ éclat${d.shards > 1 ? 's' : ''}` : '') : '', 4500);
      audio.stinger('day');
    }
  },
  chat: (d) => addChat(d),
  god: (d) => {
    const first = !game.god.on;
    game.god = { on: d.on, invuln: d.invuln, free: d.free };
    $('admin-invuln').checked = d.invuln;
    $('admin-free').checked = d.free;
    if (first) { addChat({ sys: 'info', text: 'Mode admin activé. Tape /god pour rouvrir le panneau.' }); openAdmin(); }
    renderBuildBar();
  },
  tp: (d) => { me.pos.set(d.x, heightAt(d.x, d.z) + 0.5, d.z); me.vy = 0; me.grounded = false; camTarget.copy(me.pos); },
  gameOver: (d) => {
    game.over = true;
    gem.shatter();
    audio.play('rockBreak', gem.pos);
    $('gameover').hidden = false;
    $('gameover-text').textContent = `Nuits survécues : ${d.survived}`;
    $('gameover-shards').textContent = d.admin ? 'Partie admin : pas d’éclats ni de classement' : `Éclats gagnés : ${d.shards} ◆`;
    audio.stinger('night');
    if (isLocked()) document.exitPointerLock();
  },
};

// ===================== Personnages des autres joueurs =====================
function addOther(p) {
  if (others.has(p.id) || p.id === me.id) return;
  const rig = new CharacterRig(p.color, p.name, p.skin);
  rig.root.position.set(p.x, p.y, p.z);
  rig.root.rotation.y = p.ry || 0;
  rig.stepCb = () => audio.play(inGame() && W.isWater(rig.root.position.x, rig.root.position.z) ? 'splashStep' : 'step', rig.root.position);
  scene.add(rig.root, rig.trail.mesh);
  if (p.dead) rig.die();
  rig.setHp((p.hp ?? 100) / (p.maxHp || W.PLAYER_HP));
  others.set(p.id, { id: p.id, rig, name: p.name, color: p.color, maxHp: p.maxHp || W.PLAYER_HP, target: new THREE.Vector3(p.x, p.y, p.z), ry: p.ry || 0, s: 0, g: true });
}
function removeOther(id) {
  const o = others.get(id);
  if (o) { o.rig.dispose(scene); others.delete(id); }
}
function clearOthers() { for (const id of [...others.keys()]) removeOther(id); }

function ensureMyRig(color, name, skin) {
  if (me.rig && me.color === color && me.name === name && me.skin === skin) return;
  if (me.rig) me.rig.dispose(scene);
  me.color = color; me.name = name; me.skin = skin;
  me.rig = new CharacterRig(color, name, skin);
  me.rig.stepCb = () => audio.play(inGame() && W.isWater(me.pos.x, me.pos.z) ? 'splashStep' : 'step', me.pos);
  scene.add(me.rig.root, me.rig.trail.mesh);
}

// ===================== Passage village <-> partie =====================
function fade() {
  $('fade').classList.add('on');
  setTimeout(() => $('fade').classList.remove('on'), 450);
}
function enterHub(d) {
  const first = game.scene === 'title';
  game.scene = 'hub';
  game.over = false;
  me.id = d.you.id;
  ensureMyRig(d.you.color, d.you.name, d.you.skin);
  me.rig.revive(); me.rig.setHp(1); me.rig.carrying = false;
  me.dead = false; me.hp = me.maxHp;
  me.pos.set(d.you.x, 0, d.you.z); me.vy = 0; me.ry = d.you.ry;
  camYaw = 0; camPitch = 0.25;
  camTarget.copy(me.pos);
  clearOthers();
  game.hubPlayers = new Map(d.players.map((p) => [p.id, p]));
  d.players.forEach(addOther);
  game.board = d.board; village.drawBoard(d.board);
  if (game.build.on) toggleBuild();
  game.god = { on: false, invuln: false, free: false };
  me.power = 0; me.rig.setPower(false); $('power').hidden = true;
  monsters.clear();
  worldRoot.visible = false;
  village.root.visible = true;
  grass.setVillage(village);
  $('title').hidden = true;
  $('ui').hidden = false;
  $('hud-hub').hidden = false;
  $('hud-game').hidden = true;
  $('death').hidden = true; $('gameover').hidden = true;
  setMode(null);
  updateHelp(); renderParty();
  if (first) { showBanner('Le village', 'Forge · Classement · Portail', 3500); lockMouse(); }
  else { fade(); showBanner('Retour au village', profile.shards ? `Tu as ${profile.shards} ◆ éclats à dépenser à la forge` : '', 3500); }
}

function enterGame(d) {
  fade();
  game.scene = 'game';
  game.over = false;
  game.solo = d.solo; game.host = d.host;
  game.survived = d.survived || 0;
  game.clock.time = d.clock.time; game.clock.night = d.clock.night;
  me.id = d.you.id;
  ensureMyRig(d.you.color, d.you.name, d.you.skin);
  me.rig.revive();
  me.dead = false;
  me.maxHp = d.you.maxHp || W.PLAYER_HP;
  me.hp = d.you.hp;
  me.rig.setHp(1);
  me.pos.set(d.you.x, heightAt(d.you.x, d.you.z), d.you.z);
  me.vy = 0;
  camTarget.copy(me.pos);
  clearOthers();
  d.players.forEach(addOther);
  nature.load(d.resources);
  currentTarget = null;
  buildings.clear();
  d.buildings.forEach((b) => buildings.add(b, true));
  monsters.clear();
  d.monsters.forEach((m) => monsters.spawn(m, true));
  gem.set(d.gem);
  game.relic = d.relic || { taken: false };
  features.setRelic(game.relic.taken);
  me.power = 0;
  for (const [id, n] of d.power || []) { if (id === me.id) me.power = n; else if (others.get(id)) others.get(id).power = n; }
  updatePowerHud();
  for (const f of flyers) worldRoot.remove(f.mesh);
  flyers.length = 0;
  flyPending.wood = flyPending.stone = flyPending.twig = 0;
  serverInv = { ...d.inv };
  me.inv = { ...d.inv };
  if (game.build.on) toggleBuild();
  worldRoot.visible = true;
  village.root.visible = false;
  grass.setVillage(null);
  grass.setMask(buildings.floors());
  $('hud-hub').hidden = true;
  $('hud-game').hidden = false;
  $('gameover').hidden = true;
  $('death').hidden = true;
  $('invite').hidden = true; game.invite = null;
  updateInv(); updateHp(); updateGemHud(); updateStatus(); updateHelp(); renderBuildBar();
  setMode(null);
  setMode(null);
  lockMouse();
  audio.play('portal');
  showBanner(`Jour ${game.clock.night + 1}`, 'Récolte du bois et de la pierre, puis construis tes défenses', 4500);
}

// ===================== Écran titre =====================
const nameInput = $('name');
nameInput.value = lsGet('rpg3d_name') || '';
function enterVillage() {
  audio.init(); audio.play('ui');
  const n = nameInput.value.trim() || 'Aventurier' + Math.floor(Math.random() * 1000);
  lsSet('rpg3d_name', n);
  if (!ws || ws.readyState !== 1) { $('title-error').textContent = 'Pas encore connecté au serveur…'; return; }
  send({ type: 'hello', name: n, token: profile.token, skin: chosenSkin });
}

// ----- Choix de l'apparence (pack KayKit Adventurers) -----
let chosenSkin = W.skinOk(lsGet('rpg3d_skin')) ? lsGet('rpg3d_skin') : W.SKINS[0].id;
function renderSkins() {
  const box = $('skins');
  box.innerHTML = '';
  for (const s of W.SKINS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'skin' + (s.id === chosenSkin ? ' on' : '');
    b.title = s.name;
    const img = document.createElement('img');
    img.src = characterPortrait(s.id, 120, 150);
    img.alt = s.name;
    const lab = document.createElement('span');
    lab.textContent = s.name;
    const role = document.createElement('small');
    role.textContent = s.role;
    b.title = s.name + ' — ' + s.role;
    b.append(img, lab, role);
    b.onclick = () => { chosenSkin = s.id; lsSet('rpg3d_skin', s.id); audio.init(); audio.play('ui'); renderSkins(); };
    box.append(b);
  }
}
renderSkins();
$('btn-enter').onclick = enterVillage;
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterVillage(); });
document.addEventListener('click', () => audio.init(), { once: true });

// ===================== Village : groupe, invitations, panneaux =====================
function renderParty() {
  const ul = $('party-list');
  ul.innerHTML = '';
  const members = game.party.members.length ? game.party.members : [{ id: me.id, name: me.name, color: me.color }];
  for (const m of members) {
    const li = document.createElement('li');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = hex(m.color);
    li.append(dot, document.createTextNode(m.name + (m.id === me.id ? ' (toi)' : '') + (m.inGame ? ' — en partie' : '')));
    if (members.length > 1 && m.id === game.party.leader) { const c = document.createElement('span'); c.className = 'crown'; c.textContent = '👑 chef'; li.append(c); }
    ul.append(li);
  }
  $('btn-party-leave').hidden = members.length < 2;
}
$('btn-party-leave').onclick = () => send({ type: 'partyLeave' });
function answerInvite(yes) {
  if (!game.invite) return;
  send({ type: 'inviteReply', from: game.invite.from, accept: yes });
  game.invite = null;
  $('invite').hidden = true;
  audio.play('ui');
}
$('invite-yes').onclick = () => answerInvite(true);
$('invite-no').onclick = () => answerInvite(false);
const inMyParty = (id) => game.party.members.some((m) => m.id === id);
const amLeader = () => !game.party.id || game.party.leader === me.id;

function openPlayers() { setMode('players'); renderPlayers(); }
function renderPlayers() {
  const ul = $('players-list');
  ul.innerHTML = '';
  const list = [...game.hubPlayers.values()];
  if (!list.length) { const li = document.createElement('li'); li.textContent = 'Personne d’autre au village pour le moment.'; ul.append(li); return; }
  for (const p of list) {
    const li = document.createElement('li');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = hex(p.color);
    li.append(dot, document.createTextNode(p.name));
    const btn = document.createElement('button');
    btn.className = 'btn small';
    if (inMyParty(p.id)) { btn.textContent = 'Dans ton groupe'; btn.disabled = true; }
    else if (!amLeader()) { btn.textContent = 'Chef seulement'; btn.disabled = true; }
    else { btn.textContent = 'Inviter'; btn.onclick = () => { send({ type: 'invite', id: p.id }); audio.play('ui'); }; }
    li.append(btn);
    ul.append(li);
  }
}

function openSkills() { setMode('skills'); renderSkills(); audio.play('anvil', village.anvilPos); }
function renderSkills() {
  $('skills-shards').textContent = profile.shards;
  const box = $('skill-trees');
  box.innerHTML = '';
  const owned = new Set(profile.skills);
  for (const tree of W.SKILL_TREES) {
    const col = document.createElement('div');
    col.className = 'tree';
    col.innerHTML = `<div class="tree-title" style="color:${tree.color}">${tree.icon} ${tree.name}</div>`;
    const grid = document.createElement('div');
    grid.className = 'tree-grid';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 300 560');
    svg.setAttribute('preserveAspectRatio', 'none');
    grid.append(svg);
    const nodes = W.SKILLS.filter((s) => s.tree === tree.id);
    const P = (s) => ({ x: [16.5, 50, 83.5][s.col] * 3, y: s.row * 114 + 40 });
    for (const s of nodes) for (const r of s.req) {
      const a = P(W.SKILL_BY_ID[r]), b = P(s);
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      line.setAttribute('stroke', owned.has(r) ? tree.color : '#3a4054');
      line.setAttribute('stroke-width', '3');
      svg.append(line);
    }
    for (const s of nodes) {
      const el = document.createElement('div');
      const has = owned.has(s.id), reqOk = s.req.every((r) => owned.has(r)), afford = profile.shards >= s.cost;
      el.className = 'node ' + (has ? 'owned' : !reqOk ? 'locked' : afford ? 'can' : 'poor');
      el.style.left = [16.5, 50, 83.5][s.col] + '%';
      el.style.top = (s.row * 114) + 'px';
      el.innerHTML = `<div class="nname">${s.name}</div><div class="ndesc">${s.desc}</div><div class="ncost">${has ? '✔ Acquis' : '◆ ' + s.cost}</div>`;
      el.title = has ? 'Déjà acquis' : !reqOk ? 'Achète d’abord la compétence précédente' : afford ? 'Cliquer pour acheter' : 'Pas assez d’éclats';
      if (!has && reqOk && afford) el.onclick = () => send({ type: 'buySkill', id: s.id });
      grid.append(el);
    }
    col.append(grid);
    box.append(col);
  }
}

let boardTab = 1;
function openBoard() { setMode('board'); renderBoard(); }
function renderBoard() {
  const tabs = $('board-tabs');
  tabs.innerHTML = '';
  [[1, 'Solo'], [2, 'Duo'], [3, 'Trio'], [4, 'Équipe de 4']].forEach(([k, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (k === boardTab) b.className = 'on';
    b.onclick = () => { boardTab = k; renderBoard(); };
    tabs.append(b);
  });
  const ol = $('board-list');
  ol.innerHTML = '';
  const list = game.board[boardTab] || [];
  if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Aucune partie pour le moment. Sois le premier !'; ol.append(li); }
  for (const e of list) {
    const li = document.createElement('li');
    li.append(document.createTextNode(e.names.join(', ')));
    const n = document.createElement('span'); n.className = 'n'; n.textContent = `${e.nights} nuit${e.nights > 1 ? 's' : ''}`;
    li.append(n);
    ol.append(li);
  }
}

function openLaunch() { setMode('launch'); renderLaunch(); }
function renderLaunch() {
  const box = $('launch-members');
  box.innerHTML = '';
  const members = game.party.members.length ? game.party.members : [{ id: me.id, name: me.name, color: me.color }];
  for (const m of members) {
    const d = document.createElement('div'); d.className = 'm';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = hex(m.color);
    d.append(dot, document.createTextNode(m.name + (m.id === me.id ? ' (toi)' : '') + (m.inGame ? ' — encore en partie' : '')));
    box.append(d);
  }
  const n = members.length;
  $('btn-launch').textContent = n === 1 ? 'Partir seul (solo)' : `Partir à ${n} (${['', 'solo', 'duo', 'trio', 'équipe de 4'][n]})`;
  $('btn-launch').hidden = !amLeader();
  $('launch-wait').hidden = amLeader();
}
$('btn-launch').onclick = () => {
  audio.play('portal');
  village.charge(1);
  setTimeout(() => village.charge(0), 1500);
  send({ type: 'launch' });
};

// Ce qu'on peut faire avec la touche d'interaction
function hubInteraction() {
  const near = (s) => Math.hypot(me.pos.x - s.x, me.pos.z - s.z) < s.r;
  if (near(SPOTS.portal)) return { kind: 'portal', label: 'Entrer dans le portail' };
  if (near(SPOTS.forge)) return { kind: 'forge', label: 'Forge : compétences' };
  if (near(SPOTS.board)) return { kind: 'board', label: 'Voir le classement' };
  let best = null, bd = 2.6;
  for (const o of others.values()) {
    const d = Math.hypot(o.rig.root.position.x - me.pos.x, o.rig.root.position.z - me.pos.z);
    if (d < bd) { bd = d; best = o; }
  }
  if (best) {
    if (inMyParty(best.id)) return { kind: 'none', label: `${best.name} est dans ton groupe` };
    if (!amLeader()) return { kind: 'none', label: 'Seul le chef du groupe peut inviter' };
    return { kind: 'invite', id: best.id, label: `Inviter ${best.name}` };
  }
  return null;
}

// ===================== HUD =====================
function powerActive(n) { return n && game.clock.night === n && game.clock.time >= W.DAY_LEN; }
function updatePowerHud() {
  const el = $('power');
  if (!me.power) { el.hidden = true; return; }
  el.hidden = false;
  el.classList.toggle('on', powerActive(me.power));
  el.innerHTML = powerActive(me.power) ? '💧 <b>Larme de la cascade</b> : tes coups tuent net cette nuit !' : `💧 Larme de la cascade : active pendant la nuit ${me.power}`;
}
function updateInv() {
  $('inv-wood').textContent = me.inv.wood;
  $('inv-stone').textContent = me.inv.stone;
  $('inv-twig').textContent = me.inv.twig;
  if (game.mode === 'craft') renderCraft();
  if (game.build.on) renderBuildBar();
}
function updateHp() {
  $('hp-text').textContent = Math.max(0, Math.round(me.hp)) + ' / ' + me.maxHp;
  $('hp-fill').style.width = clamp(me.hp / me.maxHp * 100, 0, 100) + '%';
  me.rig?.setHp(me.hp / me.maxHp);
}
function updateGemHud() {
  const hp = Math.max(0, gem.state.hp);
  $('gem-hp-text').textContent = Math.round(hp) + ' / ' + W.GEM_HP;
  $('gem-hp-fill').style.width = (hp / W.GEM_HP * 100) + '%';
  $('gem-hp').classList.toggle('low', hp < W.GEM_HP * 0.3);
}
function updateStatus() {
  const n = others.size + 1;
  const conn = ws && ws.readyState === 1;
  $('status').textContent = !conn ? 'Déconnecté' : n === 1 ? 'Partie solo' : `${n} joueurs`;
}
function popup(text, color) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.textContent = text;
  el.style.color = color;
  el.style.left = (20 + Math.random() * 20) + 'px';
  el.style.top = (-20 - $('popups').children.length * 22) + 'px';
  $('popups').append(el);
  setTimeout(() => el.remove(), 1200);
}
let vignetteT = 0;
let bannerTimer = null;
function showBanner(title, sub, ms) {
  const b = $('banner');
  b.innerHTML = '';
  b.append(document.createTextNode(title));
  if (sub) { const s = document.createElement('small'); s.textContent = sub; b.append(s); }
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let duskAnnounced = false;
function updateClockHud() {
  const t = game.clock.time, night = t >= W.DAY_LEN;
  const el = $('clock');
  el.classList.toggle('night', night);
  const left = night ? W.CYCLE - t : W.DAY_LEN - t;
  const dusk = !night && left < W.DUSK_WARN;
  el.classList.toggle('dusk', dusk);
  $('clock-icon').textContent = night ? '☾' : dusk ? '🌇' : '☀';
  $('clock-text').textContent = night ? `Nuit ${game.clock.night} — aube dans ${fmt(left)}` : `Jour ${game.clock.night + 1} — nuit dans ${fmt(left)}`;
  $('clock-fill').style.width = (night ? (t - W.DAY_LEN) / W.NIGHT_LEN : t / W.DAY_LEN) * 100 + '%';
  if (dusk && !duskAnnounced) { duskAnnounced = true; showBanner('La nuit tombe…', 'Retourne près du Joyau !', 3500); }
  if (!dusk) duskAnnounced = false;
}

// ===================== Ressources qui volent vers le joueur =====================
const flyers = [];
const twigGeo = (() => {
  const parts = [0, 1, 2].map((i) => { const g = new THREE.CylinderGeometry(0.018, 0.022, 0.36, 5); g.rotateZ(Math.PI / 2 + (i - 1) * 0.35); g.translate(0, (i - 1) * 0.02, (i - 1) * 0.03); return g; });
  const pos = []; for (const g of parts) { const a = g.toNonIndexed().attributes.position.array; pos.push(...a); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.computeVertexNormals(); return out;
})();
// bûches et cailloux du Pirate Kit (le centre du modèle au milieu)
const centered = (n, s) => { const g = staticGeometry(n).clone(); g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); g.translate(-c.x, -c.y, -c.z); g.scale(s, s, s); return g; };
const flyGeo = { wood: centered('Wood', 1.25), stone: centered('Rocks', 1.1), twig: twigGeo };
const flyMat = { wood: atlasMaterial(), stone: atlasMaterial(), twig: new THREE.MeshStandardMaterial({ color: '#8a7a4a', roughness: 0.9 }) };
const DROP = { wood: true, stone: true };   // ces ressources tombent d'abord au sol
let serverInv = { wood: 0, stone: 0, twig: 0 };
const flyPending = { wood: 0, stone: 0, twig: 0 };
const RES_COL = { wood: '#e0b070', stone: '#d0d0d0', twig: '#c8d890' };
function syncInv() {
  for (const k of W.RES_KEYS) me.inv[k] = (serverInv[k] || 0) - flyPending[k];
  updateInv();
}
function flyResources(from, gain) {
  const start = new THREE.Vector3(from.x, terrainH(from.x, from.z) + (from.k === 't' ? 1.2 : 0.6), from.z);
  let delay = 0;
  for (const k in gain) {
    const n = Math.min(gain[k], 12);
    for (let i = 0; i < n; i++) {
      const amt = Math.floor(gain[k] / n) + (i < gain[k] % n ? 1 : 0);
      const mesh = new THREE.Mesh(flyGeo[k], flyMat[k]);
      mesh.position.copy(start);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      mesh.castShadow = true;
      mesh.visible = false;
      worldRoot.add(mesh);
      const drop = DROP[k];
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2;
      flyers.push({
        mesh, k, t: drop ? 0 : -delay, dur: 0.55 + Math.random() * 0.15,
        p0: start.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.5, (Math.random() - 0.5) * 0.8)),
        lift: 1.4 + Math.random() * 1.2, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        last: i === n - 1, total: gain[k], amt,
        // d'abord ça tombe et rebondit au sol, puis ça vole vers le joueur
        drop: drop ? { vel: new THREE.Vector3(Math.cos(a) * sp, 3.5 + Math.random() * 2.5, Math.sin(a) * sp), wait: 1.3 + delay * 2 + Math.random() * 0.2, half: flyGeo[k] === flyGeo.wood ? 0.14 : 0.15 } : null,
      });
      delay += 0.045;
    }
  }
}
const _fp = new THREE.Vector3();
function updateFlyers(dt) {
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    if (f.drop) {
      // chute au sol avec rebonds
      const d = f.drop, m = f.mesh;
      m.visible = true;
      d.vel.y -= 18 * dt;
      m.position.addScaledVector(d.vel, dt);
      const gy = terrainH(m.position.x, m.position.z) + d.half;
      if (m.position.y < gy) {
        m.position.y = gy;
        if (d.vel.y < -1.5 && !d.thud) { d.thud = true; audio.play(f.k === 'wood' ? 'logDrop' : 'pebbleDrop', m.position); }
        d.vel.y = Math.abs(d.vel.y) > 1 ? -d.vel.y * 0.3 : 0;
        d.vel.x *= 0.55; d.vel.z *= 0.55; f.spin.multiplyScalar(0.5);
      }
      m.rotation.x += f.spin.x * dt * 0.6; m.rotation.z += f.spin.z * dt * 0.6;
      d.wait -= dt;
      if (d.wait <= 0) { f.p0.copy(m.position); f.drop = null; f.t = 0; f.lift = 1 + Math.random() * 0.8; }
      continue;
    }
    f.t += dt;
    if (f.t < 0) continue;
    f.mesh.visible = true;
    const k = Math.min(1, f.t / f.dur);
    const e = k * k * (3 - 2 * k);
    _fp.set(me.pos.x, me.pos.y + 1.1, me.pos.z);
    f.mesh.position.lerpVectors(f.p0, _fp, e);
    f.mesh.position.y += Math.sin(k * Math.PI) * f.lift;
    f.mesh.scale.setScalar(1 - Math.max(0, k - 0.8) * 3);
    f.mesh.rotation.x += f.spin.x * dt; f.mesh.rotation.y += f.spin.y * dt;
    if (k >= 1) {
      worldRoot.remove(f.mesh);
      flyers.splice(i, 1);
      audio.play('collect');
      flyPending[f.k] = Math.max(0, flyPending[f.k] - f.amt);
      syncInv();
      if (f.last) {
        popup(`+${f.total} ${W.RES_NAMES[f.k]}`, RES_COL[f.k]);
        const el = $('inv-' + f.k).parentElement;
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      }
    }
  }
}

// ===================== Construction =====================
const PIECE_ICONS = {
  floor: '<svg width="44" height="28" viewBox="0 0 44 28"><path d="M4 16 L22 8 L40 16 L22 24 Z" fill="#b07a46" stroke="#5a3a1a"/><path d="M4 16 L4 20 L22 28 L40 20 L40 16 L22 24 Z" fill="#7c7a76"/></svg>',
  wall: '<svg width="44" height="34" viewBox="0 0 44 34"><rect x="8" y="4" width="28" height="26" fill="#b07a46" stroke="#5a3a1a"/><path d="M8 4 L36 30 M36 4 L8 30" stroke="#6a4528" stroke-width="2"/><rect x="5" y="2" width="4" height="30" fill="#6a4528"/><rect x="35" y="2" width="4" height="30" fill="#6a4528"/></svg>',
  roof: '<svg width="44" height="28" viewBox="0 0 44 28"><path d="M3 18 L22 6 L41 18 L22 26 Z" fill="#6e6c68" stroke="#3a3836"/><path d="M8 17 L22 9 M14 20 L28 11 M20 23 L34 14" stroke="#4a4846" stroke-width="2"/></svg>',
  stairs: '<svg width="44" height="32" viewBox="0 0 44 32"><path d="M6 28 L6 22 L14 22 L14 16 L22 16 L22 10 L30 10 L30 4 L38 4 L38 28 Z" fill="#b07a46" stroke="#5a3a1a"/></svg>',
  door: '<svg width="44" height="34" viewBox="0 0 44 34"><rect x="5" y="2" width="4" height="30" fill="#6a4528"/><rect x="35" y="2" width="4" height="30" fill="#6a4528"/><rect x="10" y="5" width="22" height="26" fill="#8a6040" stroke="#3a2510"/><rect x="10" y="10" width="22" height="3" fill="#555"/><rect x="10" y="23" width="22" height="3" fill="#555"/><circle cx="28" cy="18" r="1.8" fill="#333"/></svg>',
  stonewall: '<svg width="44" height="34" viewBox="0 0 44 34"><rect x="4" y="6" width="36" height="26" fill="#a8a296" stroke="#55524c"/><path d="M4 14 H40 M4 22 H40 M14 6 V14 M28 6 V14 M10 14 V22 M24 14 V22 M36 14 V22 M16 22 V32 M30 22 V32" stroke="#6a665e"/><rect x="6" y="2" width="8" height="5" fill="#a8a296"/><rect x="18" y="2" width="8" height="5" fill="#a8a296"/><rect x="30" y="2" width="8" height="5" fill="#a8a296"/></svg>',
  tower: '<svg width="44" height="36" viewBox="0 0 44 36"><path d="M10 34 L14 14 M34 34 L30 14 M12 26 H32" stroke="#6a4528" stroke-width="3"/><rect x="9" y="11" width="26" height="5" fill="#b07a46"/><rect x="10" y="6" width="24" height="5" fill="#8a6040"/><path d="M8 6 L22 0 L36 6 Z" fill="#6e6c68"/><path d="M22 9 L34 13" stroke="#333" stroke-width="2"/></svg>',
  frost: '<svg width="44" height="36" viewBox="0 0 44 36"><rect x="16" y="14" width="12" height="20" fill="#a8a296"/><rect x="13" y="12" width="18" height="4" fill="#bbb5aa"/><path d="M22 0 L27 7 L22 12 L17 7 Z" fill="#9ad8ff" stroke="#3aa8ff"/><ellipse cx="22" cy="7" rx="12" ry="3" fill="none" stroke="#6ac8ff"/></svg>',
  path: '<svg width="44" height="30" viewBox="0 0 44 30"><path d="M3 17 L22 8 L41 17 L22 26 Z" fill="#8f8a80" stroke="#4a4640"/><path d="M12 12.5 L31 21.5 M22 8 L22 26 M31 12.5 L12 21.5" stroke="#5d5850" stroke-width="1.5"/><path d="M34 6 l4 -3 M37 9 l5 -2" stroke="#ffd060" stroke-width="2" stroke-linecap="round"/></svg>',
  spikes: '<svg width="44" height="30" viewBox="0 0 44 30"><rect x="4" y="24" width="36" height="4" fill="#7a5a3a"/><path d="M8 24 L11 6 L14 24 M16 24 L19 2 L22 24 M24 24 L27 6 L30 24 M32 24 L35 4 L38 24" fill="#c49a6a" stroke="#6a4a2a"/></svg>',
};
// pièces en bois : images rendues à partir des modèles 3D
for (const [type, model] of [['floor', 'w_floor1'], ['base', 'w_base4'], ['wall', 'w_wall1'], ['window', 'w_window1'], ['door', 'w_door'], ['stairs', 'w_stairs'], ['roof', 'w_roof']]) {
  PIECE_ICONS[type] = `<img class="piece-img" src="${propIcon(model, 96)}" alt="">`;
}
const RES_ICON = { wood: '<span class="ico wood"></span>', stone: '<span class="ico stone"></span>', twig: '<span class="ico twig"></span>' };
const PIECE_INFO = {
  floor: 'Plancher : au sol, sur une charpente, sur des murs ou en balcon à côté d’un autre plancher.',
  path: 'Dalle de pierre : +60 % de vitesse quand on marche dessus (encore plus en courant).',
  base: 'Charpente sur pilotis : on marche dessus et on pose l’étage suivant par-dessus.',
  window: 'Mur avec une ouverture pour surveiller. Bloque les monstres.',
  wall: 'Bloque les monstres. Ils devront le casser.',
  roof: 'Toit de chaume : couvre ta base.',
  stairs: 'Monte d’un étage (2 m) dans la direction où tu regardes.',
  door: 'Laisse passer les joueurs, pas les monstres.',
  stonewall: 'Mur très solide (1000 PV).',
  spikes: 'Blesse et ralentit les monstres qui marchent dessus.',
  tower: 'Tire des flèches sur les monstres proches.',
  frost: 'Ralentit déplacement et attaques des monstres autour.',
};
const CRAFT_GROUPS = [['Structure en bois', ['floor', 'base', 'wall', 'window', 'door', 'stairs', 'roof']], ['Chemins', ['path']], ['Défenses', ['stonewall', 'spikes', 'tower', 'frost']]];
const costHtml = (c) => W.RES_KEYS.filter((k) => c[k]).map((k) => `<span class="chip ${serverInv[k] >= c[k] || game.god.free ? '' : 'miss'}">${RES_ICON[k]}${c[k]}</span>`).join('');

// Petit bandeau pendant qu'on pose une pièce
function renderBuildBar() {
  const type = W.PIECE_ORDER[game.build.piece];
  const c = W.pieceCost(type, mods);
  $('build-slots').innerHTML = `<div class="build-current">${PIECE_ICONS[type]}<div><div class="name">${W.PIECES[type].name}</div><div class="costs">${game.god.free ? 'Gratuit (admin)' : costHtml(c)}</div></div></div>`;
  const lv = game.build.plan?.lv ?? 0;
  $('build-slots').innerHTML += `<div class="build-level">${lv ? 'Étage ' + lv : 'Rez-de-chaussée'}</div>`;
  $('build-hint').innerHTML = `Clic gauche : poser · <span class="kbd">${keyLabel(settings.keys.demolish)}</span> / clic droit : déconstruire · Molette : étage · Maj + molette : changer · <span class="kbd">${keyLabel(settings.keys.build)}</span> : menu`;
}

// Fenêtre de construction (touche B)
function openCraft() {
  if (me.dead || !inGame()) return;
  setMode('craft');
  renderCraft();
  audio.play('ui');
}
function renderCraft() {
  $('craft-inv').innerHTML = W.RES_KEYS.map((k) => `<span class="chip big">${RES_ICON[k]}<b>${me.inv[k]}</b> ${W.RES_NAMES[k]}</span>`).join('') + '<span class="hint">Inventaire commun au groupe</span>';
  const box = $('craft-groups');
  box.innerHTML = '';
  for (const [title, types] of CRAFT_GROUPS) {
    const h = document.createElement('div'); h.className = 'craft-title'; h.textContent = title; box.append(h);
    const grid = document.createElement('div'); grid.className = 'craft-grid';
    for (const type of types) {
      const P = W.PIECES[type], i = W.PIECE_ORDER.indexOf(type);
      const unlocked = game.god.free || W.pieceUnlocked(type, mods);
      const c = W.pieceCost(type, mods);
      const can = unlocked && (game.god.free || W.canAfford(serverInv, c));
      const card = document.createElement('button');
      card.className = 'craft-card' + (unlocked ? '' : ' locked') + (can ? '' : ' cant') + (game.build.on && game.build.piece === i ? ' sel' : '');
      const lockTxt = unlocked ? '' : `<div class="lock">🔒 Forge : ${W.SKILL_BY_ID[P.skill]?.name ?? ''}</div>`;
      card.innerHTML = `<span class="key">${i + 1}</span>${PIECE_ICONS[type]}<div class="name">${P.name}</div><div class="desc">${PIECE_INFO[type]}</div><div class="costs">${game.god.free ? 'Gratuit' : costHtml(c)}</div>${lockTxt}`;
      card.onclick = () => { if (unlocked) choosePiece(i); else audio.play('ui'); };
      grid.append(card);
    }
    box.append(grid);
  }
  $('craft-stop').hidden = !game.build.on;
}
function choosePiece(i) {
  game.build.piece = i;
  game.build.on = true;
  $('buildbar').hidden = false;
  $('help').hidden = true;
  $('ui').classList.add('building');
  renderBuildBar();
  audio.play('ui');
  setMode(null);
  lockMouse();
}
function stopBuild() {
  game.build.on = false;
  $('buildbar').hidden = true;
  $('help').hidden = false;
  $('ui').classList.remove('building');
  buildings.showGhost(null);
}
$('craft-stop').onclick = () => { stopBuild(); closePanel(); };
function toggleBuild() { if (game.build.on) stopBuild(); }
function selectPiece(i) {
  const type = W.PIECE_ORDER[i];
  if (!type) return;
  if (!game.god.free && !W.pieceUnlocked(type, mods)) { toast('À débloquer à la forge du village'); return; }
  game.build.piece = i; renderBuildBar(); audio.play('ui');
}
const _ray = new THREE.Vector3(), _rayPos = new THREE.Vector3();
function aimPoint() {
  camera.getWorldDirection(_ray);
  _rayPos.copy(camera.position);
  _rayPos.hit = false;
  for (let d = 0; d < 30; d += 0.2) {
    _rayPos.addScaledVector(_ray, 0.2);
    const g = buildings.groundAt(_rayPos.x, _rayPos.z, _rayPos.y, heightAt(_rayPos.x, _rayPos.z));
    if (_rayPos.y <= g) { _rayPos.hit = true; break; }
  }
  const dx = _rayPos.x - me.pos.x, dz = _rayPos.z - me.pos.z, d = Math.hypot(dx, dz);
  if (d > W.BUILD_RANGE) { _rayPos.x = me.pos.x + dx / d * W.BUILD_RANGE; _rayPos.z = me.pos.z + dz / d * W.BUILD_RANGE; }
  return _rayPos;
}
function updateBuild() {
  if (!game.build.on || game.mode) { buildings.showGhost(null); game.build.plan = null; return; }
  const type = W.PIECE_ORDER[game.build.piece];
  const plan = buildings.plan(type, aimPoint(), me.pos, nature.list, serverInv, game.god.free, mods, camYaw, game.build.lift || 0);
  if (plan.lv !== game.build.plan?.lv) { game.build.plan = plan; renderBuildBar(); }
  game.build.plan = plan;
  buildings.showGhost(plan);
  $('target').style.display = plan.ok ? 'none' : 'block';
  if (!plan.ok) { $('target').querySelector('.label').textContent = plan.reason; $('target').querySelector('.bar').style.display = 'none'; }
}
function placePiece() {
  const p = game.build.plan;
  if (!p) return;
  if (!p.ok) { audio.play('ui'); if (p.reason) toast(p.reason); return; }
  send({ type: 'build', piece: p.type, x: p.x, z: p.z, y: p.y, rot: p.rot, lv: p.lv });
  if (me.rig.attack('hammer')) send({ type: 'act', k: 'hammer' });
}
function demolishPiece() {
  const b = buildings.pick(aimPoint());
  if (b) { send({ type: 'demolish', id: b.id }); if (me.rig.attack('hammer')) send({ type: 'act', k: 'hammer' }); }
}

// ===================== Interaction (touche E) =====================
function interact() {
  if (me.dead) return;
  if (inHub()) {
    const it = hubInteraction();
    if (!it) return;
    audio.play('ui');
    if (it.kind === 'portal') openLaunch();
    else if (it.kind === 'forge') openSkills();
    else if (it.kind === 'board') openBoard();
    else if (it.kind === 'invite') send({ type: 'invite', id: it.id });
    return;
  }
  if (features.distToRelic(me.pos.x, me.pos.z) < 2.4 && gem.state.carrier !== me.id) { send({ type: 'relicPick' }); return; }
  if (gem.state.carrier === me.id) {
    const fx = Math.sin(me.ry), fz = Math.cos(me.ry);
    const x = me.pos.x + fx * 1.4, z = me.pos.z + fz * 1.4;
    const g = buildings.groundAt(x, z, me.pos.y + 0.3, heightAt(x, z));
    send({ type: 'gemDrop', x, z, y: g > heightAt(x, z) + 0.01 ? g : null });
  } else if (!gem.state.carrier && Math.hypot(gem.pos.x - me.pos.x, gem.pos.z - me.pos.z) < 2.6) {
    send({ type: 'gemPick' });
    if (game.build.on) toggleBuild();
  }
}

// ===================== Attaque =====================
let currentTarget = null, currentMonster = null;
let lastAtk = 0;
function tryAttack() {
  if (!me.rig || me.rig.attacking || me.dead || me.rig.blocking || (inGame() && gem.state.carrier === me.id)) return;
  const cls = me.rig.cls;
  const now = performance.now() / 1000;
  if (inHub()) { if (me.rig.attack(cls.kind, mods.atkSpeed)) { send({ type: 'act', k: cls.kind }); audio.play('swing', me.pos); } return; }
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  // la voleuse vise loin avec son arc ; les autres frappent au corps à corps
  const mon = cls.ranged ? (currentTarget ? null : monsters.findAlongAim(me.pos, camera, cls.range)) : monsters.findInFront(me.pos.x, me.pos.z, fx, fz, cls.reach - 1.4);
  const t = mon ? null : currentTarget;
  const kind = t ? (t.kind === 'tree' ? 'chop' : t.kind === 'rock' ? 'mine' : cls.kind) : cls.kind;
  const combat = kind === cls.kind;
  // temps entre deux coups propre à chaque style
  if (combat && now - lastAtk < cls.cd / mods.atkSpeed * 0.95) return;
  const sp = combat ? Math.max(1, (cls.kind === 'shoot' ? 0.95 : 0.6) / (cls.cd / mods.atkSpeed)) * (cls.kind === 'shoot' ? 1 : mods.atkSpeed) : mods.harvestSpeed;
  if (combat) lastAtk = now;
  me.rig.attack(kind, sp);
  me.attackTarget = t;
  me.attackMonster = mon;
  if (mon) me.attackDir = Math.atan2(mon.rig.root.position.x - me.pos.x, mon.rig.root.position.z - me.pos.z);
  else if (t) me.attackDir = Math.atan2(t.x - me.pos.x, t.z - me.pos.z);
  else me.attackDir = Math.atan2(fx, fz);
  // point visé (flèche, boule de feu)
  me.aimTo = mon ? { x: mon.rig.root.position.x, y: mon.rig.root.position.y + 1.1, z: mon.rig.root.position.z }
    : kind === 'shoot' ? aimFar(cls.range) : kind === 'staff' ? { x: me.pos.x + fx * 2.2, y: me.pos.y, z: me.pos.z + fz * 2.2 } : null;
  send({ type: 'act', k: kind, sp, to: me.aimTo });
  if (kind === 'slash' || kind === 'cleave' || kind === 'staff') audio.play('swing', me.pos);
}
// point au loin dans la direction de la caméra (tir dans le vide)
function aimFar(range) {
  camera.getWorldDirection(_ray);
  return { x: me.pos.x + _ray.x * range, y: me.pos.y + 1.4 + _ray.y * range, z: me.pos.z + _ray.z * range };
}

// ---------- Flèches (voleuse) ----------
const arrows = [];
function shootArrow(rig, to, mon) {
  const from = new THREE.Vector3();
  (rig.B.handL || rig.root).getWorldPosition(from);
  const target = new THREE.Vector3(to.x, to.y, to.z);
  const mesh = prop('x_arrow', 1.1);
  mesh.position.copy(from);
  worldRoot.add(mesh);
  const dist = from.distanceTo(target);
  arrows.push({ mesh, from, to: target, t: 0, dur: Math.max(0.08, dist / 45), mon, arc: dist * 0.04 });
  audio.play('bow', from);
}
function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    const prev = a.mesh.position.clone();
    // la cible bouge : la flèche la suit
    if (a.mon && !a.mon.dead) a.to.set(a.mon.rig.root.position.x, a.mon.rig.root.position.y + 1.1, a.mon.rig.root.position.z);
    a.mesh.position.lerpVectors(a.from, a.to, k);
    a.mesh.position.y += Math.sin(k * Math.PI) * a.arc;
    a.mesh.lookAt(a.mesh.position.clone().add(a.mesh.position.clone().sub(prev)));
    if (k >= 1) {
      worldRoot.remove(a.mesh);
      arrows.splice(i, 1);
      if (a.mon && a.mon.id && !a.mon.dead && a.mine) { send({ type: 'hitM', id: a.mon.id }); audio.play('swordHit', a.to); }
      fx.spawn({ geo: fx.box, mat: fx.mats.wood, pos: a.to, vel: new THREE.Vector3(0, 2, 0), size: 0.04, life: 0.4, gravity: 10 });
    }
  }
}

function shootArrowMine(mon) {
  const to = me.aimTo || aimFar(me.rig.cls.range);
  shootArrow(me.rig, to, mon && !mon.dead ? mon : null);
  arrows[arrows.length - 1].mine = true;
}

// ---------- Feu du mage ----------
const fireMats = ['#ffd060', '#ff8a20', '#ff4a10'].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }));
function fireBurst(p) {
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * W.CLASSES.Mage.aoe;
    fx.spawn({ geo: fx.box, mat: fireMats[i % 3], pos: new THREE.Vector3(p.x + Math.cos(a) * r * 0.3, p.y + 0.2, p.z + Math.sin(a) * r * 0.3),
      vel: new THREE.Vector3(Math.cos(a) * r * 1.6, 1.5 + Math.random() * 2.5, Math.sin(a) * r * 1.6), size: 0.08 + Math.random() * 0.1, life: 0.6 + Math.random() * 0.4, gravity: -1, drag: 2.5, spin: 6 });
  }
  fx.puff(new THREE.Vector3(p.x, p.y + 0.3, p.z), 0xff9a40, 5, 0.7);
  audio.play('fire', p);
}
function onToolHit() {
  if (!inGame()) return;
  const mon = me.attackMonster;
  const cls = me.rig.cls, k = me.rig.atk?.kind ?? me.lastKind;
  if (k === 'shoot') {
    const a = shootArrowMine(mon);
    void a;
    return;
  }
  if (k === 'staff') {
    // boule de feu : brûle tous les monstres autour du point d'impact
    const p = mon && !mon.dead ? mon.rig.root.position : new THREE.Vector3(me.aimTo?.x ?? me.pos.x, 0, me.aimTo?.z ?? me.pos.z);
    const c = new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z);
    fireBurst(c);
    send({ type: 'hitM', id: mon && !mon.dead ? mon.id : null, x: +c.x.toFixed(2), z: +c.z.toFixed(2) });
    camShake = 0.12;
    return;
  }
  if (mon) {
    const p = mon.rig.root.position;
    if (!mon.dead && Math.hypot(p.x - me.pos.x, p.z - me.pos.z) < cls.reach + 0.6) {
      send({ type: 'hitM', id: mon.id });
      audio.play('swordHit', p);
      camShake = 0.1;
    }
    return;
  }
  const t = me.attackTarget;
  if (!t || !t.alive) return;
  const dx = t.x - me.pos.x, dz = t.z - me.pos.z;
  if (Math.hypot(dx, dz) - t.r > REACH + 0.8) return;
  nature.hit(t.id, me.pos.x, me.pos.z);
  send({ type: 'hit', id: t.id });
  audio.play(t.kind === 'tree' ? 'chop' : t.kind === 'bush' ? 'bushHit' : 'pick', nature.impactPoint(t, me.pos.x, me.pos.z));
  camShake = t.kind === 'rock' ? 0.12 : 0.08;
}

// ===================== Ciel, lumière, vent, musique =====================
const sunDir = new THREE.Vector3();
const lightDir = new THREE.Vector3();
const cloudOffset = new THREE.Vector2();
const sunWarm = new THREE.Color(1.0, 0.55, 0.28), sunWhite = new THREE.Color(1.0, 0.96, 0.9), moonCol = new THREE.Color(0.62, 0.72, 1.0);
const hemiDay = new THREE.Color(0xbfd8ff), hemiNight = new THREE.Color(0x4a5c96), hemiSet = new THREE.Color(0xffb38a);
const groundDay = new THREE.Color(0x5a6a3a), groundNight = new THREE.Color(0x1c2632);
const tmpCol = new THREE.Color(), tmpCol2 = new THREE.Color();
let nightAmount = 0;
const phaseSm = { day: 1, dusk: 0, night: 0 };

function updateEnvironment(dt, time, focus) {
  // Au village : bel après-midi doré qui dérive très lentement
  const t = inGame() ? game.clock.time : W.DAY_LEN * 0.7 + Math.sin(time * 0.01) * 15;
  const night = t >= W.DAY_LEN;
  const a = night ? Math.PI + Math.PI * (t - W.DAY_LEN) / W.NIGHT_LEN : Math.PI * t / W.DAY_LEN;
  sunDir.set(Math.cos(a), Math.sin(a), 0.35).normalize();

  const strength = 0.6 + 0.3 * Math.sin(time * 0.11) * Math.sin(time * 0.29 + 1) + 0.1 * Math.sin(time * 0.7) + (night ? 0.15 : 0);
  const wa = 0.4 + Math.sin(time * 0.02) * 0.6;
  wind.uTime.value = time;
  wind.uWind.value.set(Math.cos(wa), Math.sin(wa), strength);
  cloudOffset.x += Math.cos(wa) * dt * 0.006 * (0.5 + strength);
  cloudOffset.y += Math.sin(wa) * dt * 0.006 * (0.5 + strength);

  const info = sky.update(camera, sunDir, time, cloudOffset);
  nightAmount = 1 - info.day;
  const e = sunDir.y;
  if (e > -0.02) {
    lightDir.copy(sunDir);
    sun.color.copy(sunWhite).lerp(sunWarm, 1 - THREE.MathUtils.smoothstep(e, 0.05, 0.45));
    sun.intensity = 2.8 * THREE.MathUtils.smoothstep(e, -0.02, 0.15);
  } else {
    // Clair de lune : assez de lumière pour bien voir les monstres
    lightDir.set(-sunDir.x, -sunDir.y, -sunDir.z);
    sun.color.copy(moonCol);
    sun.intensity = 1.55 * THREE.MathUtils.smoothstep(-e, 0.02, 0.2);
  }
  hemi.color.copy(hemiNight).lerp(hemiDay, info.day).lerp(hemiSet, info.sunset * 0.35);
  hemi.groundColor.copy(groundNight).lerp(groundDay, info.day);
  hemi.intensity = 1.15 + info.day * 0.15;
  renderer.toneMappingExposure = 1.05 + nightAmount * 0.4;
  scene.fog.color.copy(info.horizon).lerp(new THREE.Color(0x1a2438), nightAmount * 0.5);
  sun.position.copy(focus).addScaledVector(lightDir, 70);
  sun.target.position.copy(focus);

  tmpCol.copy(sun.color).multiplyScalar(sun.intensity * 0.42 * Math.max(0, lightDir.y) + sun.intensity * 0.08);
  tmpCol2.copy(hemi.color).multiplyScalar(hemi.intensity * (0.38 + nightAmount * 0.6));
  grass.update(me.pos, focus, lightDir, tmpCol, tmpCol2, scene.fog);
  if (inGame()) {
    river.update(time, lightDir, tmpCol, info.horizon, scene.fog);
    features.update(dt, tmpCol2.clone().add(tmpCol).multiplyScalar(1.3), scene.fog);
  }

  // Musique : jour paisible → tension au crépuscule → horreur la nuit
  const left = W.DAY_LEN - t;
  const duskOn = inGame() && !night && left < W.DUSK_WARN;
  const k = 1 - Math.exp(-dt * 0.8);
  phaseSm.day += ((!night && !duskOn ? 1 : 0) - phaseSm.day) * k;
  phaseSm.dusk += ((duskOn ? 1 : 0) - phaseSm.dusk) * k;
  phaseSm.night += ((night ? 1 : 0) - phaseSm.night) * k;
  const near = me.rig && inGame() ? monsters.nearestDist(me.pos.x, me.pos.z) : Infinity;
  audio.update(dt, {
    day: phaseSm.day, dusk: phaseSm.dusk, night: phaseSm.night,
    duskK: duskOn ? 1 - left / W.DUSK_WARN : 0, wind: clamp(strength, 0, 1),
    riverDist: inGame() ? W.riverDist(focus.x, focus.z) : 99, danger: clamp(1 - near / 22, 0, 1),
    fall: inGame() ? features.distToFall(focus.x, focus.z) : 999,
  });
}

// ===================== Joueur =====================
const tmpV = new THREE.Vector3();
function updatePlayer(dt) {
  const rig = me.rig;
  const carrying = inGame() && gem.state.carrier === me.id;
  rig.carrying = carrying;
  const canMove = !me.dead && (!game.mode || game.mode === 'map');
  let fx = 0, fz = 0;
  if (canMove) {
    if (pressed('forward') || keys.ArrowUp) fz += 1;
    if (pressed('back') || keys.ArrowDown) fz -= 1;
    if (pressed('left') || keys.ArrowLeft) fx += 1;
    if (pressed('right') || keys.ArrowRight) fx -= 1;
  }
  const moving = fx || fz;
  const running = pressed('run');
  let speed = (running ? RUN_SPEED : WALK_SPEED) * mods.speed;
  if (rig.attacking) speed *= rig.atk?.kind === 'shoot' ? 0.5 : 0.3;
  if (rig.blocking) speed *= 0.5;
  // dalles de chemin : on va beaucoup plus vite (le sprint aussi)
  if (inGame() && buildings.onPath(me.pos.x, me.pos.z, me.pos.y)) speed *= W.PATH_SPEED;
  if (carrying && !mods.carry) speed *= 0.82;
  const inWater = inGame() && W.isWater(me.pos.x, me.pos.z) && me.pos.y < W.waterLevelAt(me.pos.x);
  if (inWater) speed *= 0.6;

  const bx = me.pos.x, bz = me.pos.z;
  if (moving) {
    const len = Math.hypot(fx, fz); fx /= len; fz /= len;
    const sn = Math.sin(camYaw), cs = Math.cos(camYaw);
    const dx = fz * -sn + fx * -cs, dz = fz * -cs + fx * sn;
    me.pos.x += dx * speed * dt;
    me.pos.z += dz * speed * dt;
    if (!rig.attacking) me.ry += wrap(Math.atan2(dx, dz) - me.ry) * Math.min(1, dt * 12);
  }
  if (rig.attacking) me.ry += wrap(me.attackDir - me.ry) * Math.min(1, dt * 18);
  if (inHub()) village.collide(me.pos, PLAYER_RADIUS);
  else {
    nature.collide(me.pos, PLAYER_RADIUS);
    features.collide(me.pos, PLAYER_RADIUS);
    buildings.collide(me.pos, PLAYER_RADIUS);
    me.pos.x = clamp(me.pos.x, -WORLD_LIMIT, WORLD_LIMIT);
    me.pos.z = clamp(me.pos.z, -WORLD_LIMIT, WORLD_LIMIT);
  }

  const groundY = groundH(me.pos.x, me.pos.z, me.pos.y);
  if (canMove && pressed('jump') && me.grounded && !rig.attacking) { me.vy = JUMP_FORCE * (inWater ? 0.7 : 1); me.grounded = false; audio.play('jump', me.pos); }
  if (!me.grounded) {
    me.vy -= GRAVITY * dt;
    me.pos.y += me.vy * dt;
    if (me.pos.y <= groundY) { me.pos.y = groundY; if (me.vy < -6) audio.play('land', me.pos); me.vy = 0; me.grounded = true; }
  } else if (me.pos.y - groundY > 0.35) me.grounded = false;
  else me.pos.y = groundY;
  me.speed = Math.hypot(me.pos.x - bx, me.pos.z - bz) / Math.max(dt, 1e-4);

  if (mouseHeld && isLocked() && !game.mode && !game.build.on) tryAttack();

  // Outil en main selon ce qu'on vise
  if (!rig.attacking) {
    if (game.build.on) rig.setTool('hammer');
    else if (currentMonster) rig.setTool(rig.weapon);
    else if (currentTarget) rig.setTool(currentTarget.kind === 'tree' ? 'axe' : currentTarget.kind === 'rock' ? 'pick' : rig.weapon);
    else rig.setTool(rig.weapon);
  }

  const camFacing = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
  const look = clamp(wrap(camFacing - me.ry), -0.9, 0.9) * 0.55;
  rig.root.position.copy(me.pos);
  rig.root.rotation.y = me.ry;
  if (rig.update(dt, { speed: me.speed, grounded: me.grounded, wind: wind.uWind.value.z, lookYaw: rig.attacking || me.dead ? 0 : look })) {
    if (rig.atk?.kind === 'hammer' || (!rig.atk && game.build.on)) audio.play('hammerTap', me.pos);
    else onToolHit();
  }

  const tEl = $('target'), ch = $('crosshair'), pr = $('prompt');
  const K = keyLabel(settings.keys.interact);
  if (inHub()) {
    currentTarget = null; currentMonster = null;
    tEl.style.display = 'none';
    ch.classList.remove('active', 'enemy');
    const it = game.mode ? null : hubInteraction();
    if (it) { pr.style.display = 'block'; pr.innerHTML = it.kind === 'none' ? it.label : `<kbd>${K}</kbd> ${it.label}`; }
    else pr.style.display = 'none';
    village.charge(it?.kind === 'portal' ? 0.4 : 0);
    return;
  }

  // Cible sous le viseur
  if (!game.build.on) {
    const cfx = -Math.sin(camYaw), cfz = -Math.cos(camYaw);
    currentMonster = me.dead ? null : monsters.findInFront(me.pos.x, me.pos.z, cfx, cfz, REACH + 0.6);
    if (!rig.attacking) currentTarget = me.dead || currentMonster || carrying ? null : nature.getTarget(me.pos.x, me.pos.z, cfx, cfz, REACH);
  } else { currentTarget = null; currentMonster = null; }
  nature.setHighlight(currentTarget && currentTarget.alive ? currentTarget : null);
  ch.classList.toggle('enemy', !!currentMonster);
  if (!game.build.on) {
    if (currentTarget && currentTarget.alive) {
      ch.classList.add('active');
      tEl.style.display = 'block';
      tEl.querySelector('.bar').style.display = 'block';
      tEl.querySelector('.label').textContent = currentTarget.kind === 'tree' ? 'Clic : couper l’arbre (bois)' : currentTarget.kind === 'bush' ? 'Clic : cueillir le buisson (bois + soin)' : 'Clic : casser le rocher (pierre)';
      tEl.querySelector('.fill').style.width = (100 * currentTarget.hp / currentTarget.max) + '%';
    } else {
      ch.classList.remove('active');
      tEl.style.display = 'none';
    }
  } else ch.classList.remove('active');

  if (!me.dead && !carrying && features.distToRelic(me.pos.x, me.pos.z) < 2.4) { pr.style.display = 'block'; pr.innerHTML = `<kbd>${K}</kbd> Prendre la Larme de la cascade`; }
  else if (!me.dead && carrying) { pr.style.display = 'block'; pr.innerHTML = `<kbd>${K}</kbd> Poser le Joyau`; }
  else if (!me.dead && !gem.state.carrier && Math.hypot(gem.pos.x - me.pos.x, gem.pos.z - me.pos.z) < 2.6) { pr.style.display = 'block'; pr.innerHTML = `<kbd>${K}</kbd> Prendre le Joyau`; }
  else pr.style.display = 'none';

  if (me.dead) {
    me.deadT += dt;
    $('death-timer').textContent = `Réapparition dans ${Math.max(0, Math.ceil(W.RESPAWN_DELAY - me.deadT))}`;
  }
}

function updateCamera(dt) {
  const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
  const rightX = -fwdZ, rightZ = fwdX;
  const want = tmpV.set(me.pos.x + rightX * 0.5, me.pos.y + 1.55, me.pos.z + rightZ * 0.5);
  camTarget.lerp(want, 1 - Math.exp(-dt * 14));
  // dans une grotte, la caméra se rapproche et reste sous le plafond
  const cave = inGame() ? W.caveAt(me.pos.x, me.pos.z) : null;
  camCaveK += ((cave ? 1 : 0) - camCaveK) * (1 - Math.exp(-dt * 4));
  const dist = camDist + (Math.min(camDist, 3.6) - camDist) * camCaveK;
  const horiz = dist * Math.cos(camPitch);
  camera.position.set(camTarget.x + Math.sin(camYaw) * horiz, camTarget.y + dist * Math.sin(camPitch), camTarget.z + Math.cos(camYaw) * horiz);
  if (cave) camera.position.y = Math.min(camera.position.y, cave.floor + Math.min(cave.h - 1.2, 4.2));
  const cg = terrainH(camera.position.x, camera.position.z);
  const minY = (inGame() && W.isWater(camera.position.x, camera.position.z) ? Math.max(cg, W.waterLevelAt(camera.position.x)) : cg) + 0.35;
  if (camera.position.y < minY) camera.position.y = minY;
  camera.lookAt(camTarget);
  if (camShake > 0) {
    camShake = Math.max(0, camShake - dt);
    camera.rotation.z += (Math.random() - 0.5) * camShake * 0.25;
    camera.position.y += (Math.random() - 0.5) * camShake * 0.3;
  }
  audio.setListener(camera.position.x, camera.position.y, camera.position.z, -fwdZ, fwdX);
}

function updateOthers(dt) {
  for (const [id, o] of others) {
    const r = o.rig;
    r.root.position.lerp(o.target, Math.min(1, dt * 12));
    r.root.rotation.y += wrap(o.ry - r.root.rotation.y) * Math.min(1, dt * 12);
    r.carrying = inGame() && gem.state.carrier === id;
    r.update(dt, { speed: o.s, grounded: o.g, wind: wind.uWind.value.z });
  }
}

let lastSent = 0, lastPayload = '';
function sendPosition(now) {
  if (!me.rig || me.dead || now - lastSent < SEND_RATE) return;
  const msg = {
    type: inHub() ? 'hubMove' : 'move', x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2),
    ry: +me.ry.toFixed(2), s: +me.speed.toFixed(1), g: me.grounded, tl: TOOLS.indexOf(me.rig.tool),
  };
  const payload = JSON.stringify(msg);
  if (payload !== lastPayload) { if (ws?.readyState === 1) ws.send(payload); lastPayload = payload; }
  lastSent = now;
}

function titleCamera(t) {
  camera.position.set(Math.sin(t * 0.04) * 22, 7 + Math.sin(t * 0.1), Math.cos(t * 0.04) * 22);
  camera.lookAt(0, 2, 0);
}

// ===================== Boucle =====================
const clock = new THREE.Clock();
let time = 0, mapT = 0, hudT = 0;
let paused = false;
const _carry = new THREE.Vector3();
const _origin = new THREE.Vector3();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) { tick(dt); renderer.render(scene, camera); }
  requestAnimationFrame(loop);
}
function tick(dt) {
  time += dt;
  if (inGame() && !game.over) game.clock.time = Math.min(W.CYCLE - 0.01, game.clock.time + dt);
  if (me.rig && playing()) { updatePlayer(dt); updateCamera(dt); if (inGame()) updateBuild(); } else titleCamera(time);
  updateOthers(dt);
  const focus = me.rig && playing() ? me.pos : _origin;
  updateEnvironment(dt, time, focus);
  if (inGame()) {
    let carrierPos = null;
    const c = gem.state.carrier;
    if (c === me.id && me.rig) carrierPos = me.rig.carryPoint(_carry);
    else if (c && others.has(c)) carrierPos = others.get(c).rig.carryPoint(_carry);
    gem.update(dt, carrierPos);
    monsters.update(dt);
    const ps = [me.pos, ...[...others.values()].map((o) => o.rig.root.position)];
    buildings.update(dt, ps);
    nature.update(dt, time, wind.uWind.value, focus, nightAmount);
    updateFlyers(dt);
    updateArrows(dt);
    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.2; updateClockHud(); updatePowerHud();
      me.rig?.setPower(!!powerActive(me.power));
      for (const o of others.values()) o.rig.setPower(!!powerActive(o.power));
    }
    // mini-carte redessinée à chaque image (elle tourne avec la caméra) ; grande carte 10 fois par seconde
    worldMap.drawMini($('minimap'), mapData());
    mapT -= dt;
    if (mapT <= 0) {
      mapT = 0.1;
      if (game.mode === 'map') drawBigMap();
    }
  } else {
    village.update(dt, focus);
  }
  if (playing()) {
    sendPosition(performance.now());
    vignetteT = Math.max(0, vignetteT - dt * 1.5);
    const lowHp = inGame() && me.hp < me.maxHp * 0.3 && !me.dead ? 0.35 + Math.sin(time * 4) * 0.15 : 0;
    $('vignette').style.opacity = Math.max(vignetteT, lowHp);
    if (game.invite && performance.now() - game.invite.t > 20000) { game.invite = null; $('invite').hidden = true; }
  }
}
// Le titre se passe devant le village
worldRoot.visible = false;
village.root.visible = true;
grass.setVillage(village);
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

connect();
updateHelp();

// ===================== Outils de test (console du navigateur) =====================
window.__W = W;
window.__game = {
  me, nature, others, camera, monsters, buildings, gem, game, keys, tryAttack, send, audio, village, profile, renderer, flyers, setBlock,
  mySkin: (s) => ensureMyRig(me.color, me.name, s),
  setView: (yaw, pitch, dist) => { camYaw = yaw; camPitch = pitch; camDist = dist; },
  pause: (v = true) => { paused = v; },
  advance: (sec, step = 1 / 30) => {
    const t0 = performance.now();
    for (let t = 0; t < sec - 1e-6; t += step) tick(step);
    const t1 = performance.now();
    renderer.render(scene, camera);
    return { simMs: t1 - t0, renderMs: performance.now() - t1 };
  },
  setBuild: (on, piece = 0) => { if (game.build.on !== on) toggleBuild(); selectPiece(piece); },
  place: () => placePiece(),
  interact: () => interact(),
  openAdmin: () => openAdmin(),
  setMode: (m) => setMode(m),
  open: (what) => ({ skills: openSkills, board: openBoard, launch: openLaunch, players: openPlayers })[what](),
  toggleMap: (tp) => toggleMap(tp),
  shot: (px, py, pz, tx, ty, tz) => { camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); renderer.render(scene, camera); },
};
void SPAWN;
