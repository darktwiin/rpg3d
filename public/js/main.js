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
import { HeroPage, Loots } from './hero.js';
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
  stam: 100, stamIdle: 0, tired: false, dash: null, jumps: 0, jumpHeld: false,
};
const profile = { token: lsGet('rpg3d_token') || '', shards: 0, skills: [], best: 0, xp: 0, account: lsGet('rpg3d_account') || null, items: [], equip: {} };
// caractéristiques = compétences + niveau du héros + équipement porté
function computeMods() { const l = W.levelOf(profile.xp); return W.applyGear(W.applyClassTree(W.skillMods(profile.skills, l), profile.ctree, me.skin, l), profile.items, profile.equip, me.skin); }
let mods = W.skillMods([]);
const others = new Map();
let heroPage = null;
const loots = new Loots(worldRoot);
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
    else if (performance.now() - lastEscT < 400) { /* déjà traité par la touche Échap */ }
    else if (game.build.on && !game.mode) stopBuild();   // Échap : on quitte la construction
    else if (!game.mode) setMode('pause');
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
const PANELS = ['pause', 'admin', 'mapview', 'skills', 'board', 'launch', 'players', 'craft', 'recap', 'heropanel', 'talents'];
function setMode(m) {
  game.mode = m;
  const map = { pause: 'pause', admin: 'admin', map: 'mapview', skills: 'skills', board: 'board', launch: 'launch', players: 'players', craft: 'craft', recap: 'recap', hero: 'heropanel', talents: 'talents' };
  for (const id of PANELS) $(id).hidden = map[m] !== id;
  if (m === 'pause') $('btn-quit').hidden = !inGame();
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
// Quitter le jeu : ferme la fenêtre du lanceur (dans un navigateur, l'onglet ne peut pas toujours se fermer seul)
$('btn-exit').onclick = () => {
  audio.play('ui');
  window.close();
  setTimeout(() => { if (!window.closed) toast('Tu peux fermer cet onglet pour quitter le jeu.'); }, 300);
};
$('btn-quit').onclick = () => {
  if (inGame()) { send({ type: 'backToHub' }); fade(); }
  setMode(null);
};
$('btn-pause-options').onclick = () => openOptions();
// Réinitialiser l'arbre de compétences (3 éclats) : un 2ᵉ clic confirme
$('skills-reset').onclick = () => {
  const b = $('skills-reset');
  if (!profile.skills.length) { toast('Aucune compétence à réinitialiser.'); return; }
  if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Sûr ? Clique encore pour confirmer'; audio.play('ui'); setTimeout(() => { delete b.dataset.sure; b.textContent = '↺ Réinitialiser l’arbre (3 ◆)'; }, 4000); return; }
  delete b.dataset.sure; b.textContent = '↺ Réinitialiser l’arbre (3 ◆)';
  send({ type: 'resetSkills' }); audio.play('anvil', village.anvilPos);
};
$('recap-forge').onclick = () => { audio.play('ui'); openSkills(); };
$('recap-hero').onclick = () => { audio.play('ui'); openHero(); };

// ===================== Clavier =====================
let rebinding = null, lastEscT = -9;
// Échap ferme toujours ce qui est ouvert, du plus « haut » au plus « bas »
function escapeAll() {
  lastEscT = performance.now();
  if (!$('keys-panel').hidden) { $('keys-panel').hidden = true; $('options').hidden = false; return true; }
  if (!$('options').hidden) { $('options').hidden = true; audio.play('ui'); return true; }
  if (!playing()) return false;
  if (game.mode === 'chat') { closeChat(true); return true; }
  if (game.invite) { answerInvite(false); return true; }
  if (game.mode) { setMode(null); lockMouse(); audio.play('ui'); return true; }
  if (game.build.on) { stopBuild(); audio.play('ui'); return true; }
  setMode('pause');
  return true;
}
addEventListener('keydown', (e) => {
  if (rebinding) {
    e.preventDefault();
    if (e.code !== 'Escape') { settings.keys[rebinding] = e.code; saveSettings(); }
    rebinding = null;
    renderKeybinds();
    return;
  }
  if (e.code === 'Escape') { if (escapeAll()) e.preventDefault(); return; }
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
  if (game.mode === 'craft' && e.code === K.build) { closePanel(); return; }
  if (game.mode === 'hero' && e.code === K.inventory) { closePanel(); return; }
  if (game.mode === 'talents' && e.code === K.talents) { closePanel(); return; }
  if (e.code === K.chat || e.code === 'NumpadEnter') { e.preventDefault(); if (!game.mode) openChat(); return; }
  if (inHub() && e.code === 'Tab') { if (game.mode === 'players') closePanel(); else if (!game.mode) openPlayers(); return; }
  if (inGame() && e.code === K.map) { toggleMap(false); return; }
  if (game.mode) return;
  if (e.code === K.run) tryDash();
  if (inGame() && e.code === K.build) openCraft();
  if (inGame() && game.build.on && e.code === K.demolish) demolishPiece();
  if (inGame() && game.build.on && e.code === K.repair) repairPiece();
  if (e.code === K.punch) punchAlly();
  if (e.code === K.inventory) { openHero(); return; }
  if (e.code === K.talents) { openTalents(); return; }
  if (e.code === K.interact && !(inGame() && game.build.on && e.code === K.demolish)) interact();
  if (inGame() && e.code === K.skill && !me.dead) { if (deadeye) endDeadeye(); else send({ type: 'skill' }); }
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
  chatInput.placeholder = inGame() ? 'Écris un message à ton groupe…' : 'Écris un message à tout le village…';
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
    ? `${keyLabel(K.interact)} : interagir · ${keyLabel(K.inventory)} : héros & inventaire · ${keyLabel(K.punch)} : coup de poing · Tab : joueurs · ${keyLabel(K.chat)} : chat · Échap : menu`
    : `Clic : frapper · ${keyLabel(K.build)} : construction · ${keyLabel(K.interact)} : Joyau · ${keyLabel(K.inventory)} : inventaire · ${keyLabel(K.map)} : carte · ${keyLabel(K.chat)} : chat · Échap : menu`;
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
  sentShot: (d) => {
    const o = d.id === me.id ? me : others.get(d.id), m = monsters.map.get(d.m);
    if (!o?.rig?.sentOrb || !m) return;
    flyArrow(o.rig.sentOrb.getWorldPosition(new THREE.Vector3()), m, 0.6, false);
  },
  deadeyeShot: (d) => {
    const o = d.id === me.id ? me : others.get(d.id);
    if (!o?.rig) return;
    const from = o.rig.root.position.clone().setY(o.rig.root.position.y + 1.4);
    for (const id of d.ms) { const m = monsters.map.get(id); if (m) flyArrow(from, m, 2.4, true); }
    audio.play('fire', from);
    if (d.id === me.id && d.ms.length) showBanner('🎯 Feu !', `${d.ms.length} cible${d.ms.length > 1 ? 's' : ''}`, 1200);
  },
  skill: (d) => {
    const o = d.id === me.id ? me : others.get(d.id);
    if (!o?.rig) return;
    o.rig.skillFx = { s: d.s, until: performance.now() + d.dur * 1000 };
    audio.play(SKILL_SFX[d.s] || 'ui', o.rig.root.position);
    if (d.s === 'element') { o.rig.setElement(d.el); if (d.id === me.id) popup(d.el === 'ice' ? '❄ Glace' : '🔥 Feu', d.el === 'ice' ? '#9be4ff' : '#ffb060'); }
    if (d.s === 'blink') { magicPuff(o.rig.root.position); if (d.id === me.id) doBlink(); }
    if (d.s === 'deadeye' && d.id === me.id) startDeadeye(d.dur);
    if (d.id === me.id) {
      skillUse = { night: d.night, readyAt: performance.now() + (d.cd || 0) * 1000 };
      camShake = 0.15;
      const def = W.CLASS_SKILLS[me.skin]?.find((k) => k.id === d.s);
      if (def) showBanner(`${def.icon} ${def.name}`, '', 1400);
    }
  },
  fuseResult: (d) => { audio.play(d.ok ? 'levelUp' : 'buildBreak'); if (d.ok && heroPage) heroPage.sel = d.id; },
  authErr: (d) => {
    $('title-error').textContent = d.text; audio.play('ui');
    if (/Session/.test(d.text)) { try { localStorage.removeItem('rpg3d_account'); } catch {} renderLogin(); }
  },
  xp: (d) => {
    const before = W.levelOf(profile.xp);
    profile.xp = d.xp;
    if (d.gain) popup(`+${d.gain} XP`, '#ffe08a');
    if (d.level > before) {
      mods = computeMods();
      showBanner(`Niveau ${d.level} !`, `+2 PV et +1 % de dégâts`, 2500);
      audio.play('levelUp');
    }
    updateHeroHud();
  },
  profile: (d) => {
    const before = profile.shards;
    Object.assign(profile, { token: d.token, shards: d.shards, skills: d.skills, best: d.best, xp: d.xp || 0, account: d.account || null, items: d.items || [], equip: d.equip || {}, ferite: d.ferite || 0, ctree: d.ctree || {} });
    lsSet('rpg3d_token', d.token);
    if (d.account) lsSet('rpg3d_account', d.account);
    if (d.skin && d.skin !== me.skin && me.rig) ensureMyRig(me.color, me.name, d.skin);
    else if (d.skin) me.skin = d.skin;
    mods = computeMods();
    updateHeroHud();
    if (game.mode === 'hero') heroPage.render();
    $('shards-n').textContent = profile.shards;
    if (game.mode === 'skills') renderSkills();
    if (game.mode === 'talents') renderClassTree();
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
  hubSkin: (d) => {
    if (d.id === me.id) { ensureMyRig(me.color, me.name, d.skin); mods = computeMods(); if (game.mode === 'hero') heroPage.render(); return; }
    const o = others.get(d.id);
    if (o) { const p = game.hubPlayers.get(d.id) || {}; p.skin = d.skin; removeOther(d.id); addOther({ ...p, id: d.id, name: o.name, color: o.color, skin: d.skin, x: o.target.x, y: o.target.y, z: o.target.z, ry: o.ry }); }
  },
  lootAdd: (d) => loots.add(d.loot),
  lootDel: (d) => {
    const l = loots.map.get(d.id);
    loots.remove(d.id);
    const R = W.RARITIES[d.item.r];
    if (d.by === me.id) {
      popup(`${R.name} : ${d.item.name}`, R.color);
      audio.play(d.item.r >= 3 ? 'levelUp' : 'gemPick', l ? new THREE.Vector3(l.x, l.y, l.z) : me.pos);
      toast(`Nouvel objet : ${d.item.name} — touche ${keyLabel(settings.keys.inventory)} pour l’équiper`);
    }
    addChat({ sys: 'info', text: `🎁 ${d.name} a trouvé ${d.item.name} (${R.name})` });
  },
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
    if (d.k === 'dash') { o.rig.startDodge(d.dir || 0); return; }
    if (d.k === 'jump2') { o.rig.flip(); return; }
    o.rig.attack(d.k, d.sp || 1);
    if (d.k === 'slash' || d.k === 'cleave' || d.k === 'staff') audio.play('swing', o.rig.root.position);
    // flèche des autres joueurs : partie au moment où la corde est lâchée
    if (d.k === 'shoot' && d.to) setTimeout(() => { if (o.rig) shootArrow(o.rig, d.to, null); }, 0.95 * 0.78 * 1000 / (d.sp || 1));
    if (d.k === 'staff' && d.to) setTimeout(() => { if (o.rig) shootFire(o.rig, d.to, null); }, 0.62 * 0.5 * 1000 / (d.sp || 1));
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
  bHp: (d) => {
    buildings.setHp(d.id, d.hp);
    if (d.repaired) { const b = buildings.map.get(d.id); if (b) { audio.play('buildDone', new THREE.Vector3(b.x, b.y + 1, b.z)); fx.puff(new THREE.Vector3(b.x, b.y + 1, b.z), 0xffe0a0, 8, 0.8); } }
  },
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
    if (d.ev === 'pick') { audio.play('gemPick', gem.pos); game.gemCarryEnd = performance.now() + W.GEM_CARRY * 1000; }
    if (d.ev === 'drop') { if (wasCarrier) audio.play('gemDrop', gem.pos); game.gemReady = performance.now() + W.GEM_REST * 1000; }
    updateGemHud();
  },
  punch: (d) => {
    const victim = d.to === me.id ? me.rig : others.get(d.to)?.rig;
    const pos = d.to === me.id ? me.pos : victim?.root.position;
    if (pos) { audio.play('punch', pos); fx.puff(new THREE.Vector3(pos.x, pos.y + 1.2, pos.z), 0xfff0c0, 6, 0.5); }
    victim?.knock(d.stun);
    if (d.to === me.id) {
      me.stunT = d.stun; me.knockDir = d.dir; me.knockV = 6;
      if (me.dash) me.dash = null;
      camShake = 0.25;
      const from = others.get(d.from);
      popup(`💫 ${from ? from.name : 'Quelqu’un'} t’a assommé !`, '#ffe08a');
    }
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
    if (first) { addChat({ sys: 'info', text: 'Mode admin activé.' }); openAdmin(); }
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
    game.recap = d;
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
  rig.path = p.path; if (p.el) rig.setElement(p.el);
  rig.setSentinel(p.skin === 'Rogue' && p.path === 'sentinel');
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
  loots.clear();
  me.id = d.you.id;
  ensureMyRig(d.you.color, d.you.name, d.you.skin);
  me.rig.revive(); me.rig.setHp(1); me.rig.carrying = false;
  me.dead = false; me.hp = me.maxHp;
  me.pos.set(d.you.x, 0, d.you.z); me.vy = 0; me.ry = d.you.ry;
  if (game.recap) {
    const r = game.recap; game.recap = null;
    $('recap-score').innerHTML = `Nuits survécues : <b>${r.survived}</b>` + (r.admin ? '' : ` · Éclats gagnés : <b>${r.shards} ◆</b>`) + ` · Tu as maintenant <b>${profile.shards} ◆</b>`;
    setTimeout(() => { if (game.scene === 'hub' && !game.mode) setMode('recap'); }, 900);
  }
  me.stam = mods.stamina; me.tired = false; me.dash = null; me.jumps = 0;
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
  else { fade(); showBanner('Retour au village', profile.shards ? `Tu as ${profile.shards} ◆ éclats à dépenser auprès du Gardien de maîtrise` : '', 3500); }
}

function enterGame(d) {
  fade();
  if (deadeye) endDeadeye(true);
  me.rig?.setElement(d.you?.el || 'fire');
  game.scene = 'game';
  game.over = false;
  game.solo = d.solo; game.host = d.host;
  game.survived = d.survived || 0;
  loots.clear();
  me.stam = mods.stamina; me.tired = false; me.dash = null; me.jumps = 0;
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
  flyGen++;   // les icônes encore en vol vers le HUD ne comptent plus
  skillUse = { night: -1, readyAt: 0 };
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
// Comptes : connexion, création, session mémorisée, ou invité
function renderLogin() {
  const acc = lsGet('rpg3d_account');
  $('login-box').hidden = !!acc;
  $('session-box').hidden = !acc;
  $('session-name').textContent = acc || '';
  $('btn-enter').hidden = !acc;
  $('skins').hidden = !!acc; $('skins-label').hidden = !!acc;
  $('btn-guest').hidden = !!acc;
}
function enterVillage(mode) {
  audio.init(); audio.play('ui');
  $('title-error').textContent = '';
  if (!ws || ws.readyState !== 1) { $('title-error').textContent = 'Pas encore connecté au serveur…'; return; }
  const acc = lsGet('rpg3d_account');
  if (mode === 'session' && acc) return send({ type: 'hello', auth: 'session', name: acc, token: profile.token, skin: chosenSkin });
  const n = nameInput.value.trim();
  if (mode === 'login' || mode === 'register') {
    if (!n) { $('title-error').textContent = 'Entre ton pseudo.'; nameInput.focus(); return; }
    if (!$('pass').value) { $('title-error').textContent = 'Entre ton mot de passe.'; $('pass').focus(); return; }
    lsSet('rpg3d_name', n);
    return send({ type: 'hello', auth: mode, name: n, pass: $('pass').value, token: profile.token, skin: chosenSkin });
  }
  // invité
  const g = n || 'Aventurier' + Math.floor(Math.random() * 1000);
  lsSet('rpg3d_name', g);
  send({ type: 'hello', name: g, token: profile.token, skin: chosenSkin });
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
$('btn-enter').onclick = () => enterVillage('session');
$('btn-login').onclick = () => enterVillage('login');
$('btn-register').onclick = () => enterVillage('register');
$('btn-guest').onclick = () => enterVillage('guest');
$('btn-logout').onclick = () => {
  // on oublie la session : le prochain joueur de ce navigateur repart de zéro (ou se connecte)
  lsSet('rpg3d_account', ''); lsSet('rpg3d_token', ''); profile.token = ''; profile.account = null;
  try { localStorage.removeItem('rpg3d_account'); } catch {}
  renderLogin(); audio.play('ui');
};
for (const el of [nameInput, $('pass')]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterVillage('login'); });
renderLogin();
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
let skillTab = 'build';
function renderSkills() {
  $('skills-shards').textContent = profile.shards;
  const owned = new Set(profile.skills);
  // onglets : un arbre à la fois, en grand
  const tabs = $('skill-tabs');
  tabs.innerHTML = '';
  for (const tree of W.SKILL_TREES) {
    const all = W.SKILLS.filter((s) => s.tree === tree.id), n = all.filter((s) => owned.has(s.id)).length;
    const b = document.createElement('button');
    b.className = tree.id === skillTab ? 'on' : '';
    b.innerHTML = `${tree.icon} ${tree.name} <small>${n}/${all.length}</small>`;
    b.onclick = () => { skillTab = tree.id; audio.play('ui'); renderSkills(); };
    tabs.append(b);
  }
  const box = $('skill-trees');
  box.innerHTML = '';
  const tree = W.SKILL_TREES.find((t) => t.id === skillTab) || W.SKILL_TREES[0];
  const col = document.createElement('div');
  col.className = 'tree';
  const grid = document.createElement('div');
  grid.className = 'tree-grid';
  const nodes = W.SKILLS.filter((s) => s.tree === tree.id);
  const ROW = 150, rows = Math.max(...nodes.map((s) => s.row)) + 1, H = rows * ROW;
  grid.style.height = H + 'px';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 300 ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  grid.append(svg);
  const X = [17, 50, 83];
  // traits : du bas de la compétence requise au haut de la suivante (sous les cases, couleur claire)
  for (const s of nodes) for (const r of s.req) {
    const a = W.SKILL_BY_ID[r];
    const path = document.createElementNS(svgNS, 'path');
    const x1 = X[a.col] * 3, y1 = a.row * ROW + 70, x2 = X[s.col] * 3, y2 = s.row * ROW + 14, my = (y1 + y2) / 2;
    path.setAttribute('d', `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', owned.has(r) ? tree.color : '#d8bf98');
    path.setAttribute('stroke-width', owned.has(r) ? '4' : '3');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    if (!owned.has(r)) path.setAttribute('stroke-dasharray', '6 5');
    svg.append(path);
  }
  for (const s of nodes) {
    const el = document.createElement('div');
    const has = owned.has(s.id), reqOk = s.req.every((r) => owned.has(r)), afford = profile.shards >= s.cost;
    el.className = 'node ' + (has ? 'owned' : !reqOk ? 'locked' : afford ? 'can' : 'poor');
    el.style.left = X[s.col] + '%';
    el.style.top = (s.row * ROW + 10) + 'px';
    el.innerHTML = `<div class="nname">${s.name}</div><div class="ndesc">${s.desc}</div><div class="ncost">${has ? '✔ Acquis' : (reqOk ? '' : '🔒 ') + '◆ ' + s.cost}</div>`;
    el.title = has ? 'Déjà acquis' : !reqOk ? 'Achète d’abord la compétence précédente' : afford ? 'Cliquer pour acheter' : 'Pas assez d’éclats';
    if (!has && reqOk && afford) el.onclick = () => send({ type: 'buySkill', id: s.id });
    grid.append(el);
  }
  col.append(grid);
  box.append(col);
}

// Arbre de classe : voie de la compétence E (niveaux impairs) et caractéristiques (niveaux pairs)
function openTalents() {
  if (!playing() || me.dead) return;
  setMode('talents'); renderClassTree(); audio.play('ui');
}
function renderClassTree() {
  const edit = inHub();   // consultable partout, modifiable seulement au village
  const lvl = W.levelOf(profile.xp), pts = W.classPoints(lvl);
  const t = profile.ctree?.[me.skin] || { path: null, picks: [] };
  const picks = t.picks.slice(0, pts.stat), free = pts.stat - picks.length;
  const sk = W.classSkill(profile.ctree, me.skin, lvl);
  const box = $('talents-body');
  const count = (id) => picks.filter((k) => k === id).length;
  box.innerHTML = `<div class="ctree${edit ? '' : ' locked'}">
    <div class="ctree-head">${W.CLASS_NAMES[me.skin]} · niveau <b>${lvl}</b> · niveaux impairs : compétence (E) · niveaux pairs : caractéristique</div>
    <div class="ctree-paths">${W.CLASS_SKILLS[me.skin].map((d) => `
      <button class="ctree-path${t.path === d.id ? ' on' : ''}" data-path="${d.id}" ${d.soon || !edit ? 'disabled' : ''}>
        <div class="nm">${d.icon} ${d.name}${t.path === d.id ? ' ✔' : ''}${d.soon ? ' (bientôt)' : ''}</div><div class="desc">${d.desc}</div>
        ${t.path === d.id && sk ? `<div class="up">${sk.boosts} amélioration${sk.boosts > 1 ? 's' : ''} : ${sk.dur ? `durée ${sk.dur} s` : ''}${sk.dur && sk.cd ? ' · ' : ''}${sk.cd ? `recharge ${sk.cd} s` : d.once ? ' · une fois par nuit' : ''}</div>` : ''}
      </button>`).join('')}</div>
    <div class="ctree-stats"><div>Caractéristiques : <b>${free}</b> point${free > 1 ? 's' : ''} à placer</div>
      ${W.CLASS_STATS.map((c) => `<button class="btn small" data-stat="${c.id}" ${free && edit ? '' : 'disabled'}>${c.icon} ${c.name} <b>×${count(c.id)}</b></button>`).join('')}
      <button class="btn small ghost" id="ctree-reset" ${picks.length && edit ? '' : 'disabled'}>Replacer les points (gratuit)</button></div>
    <div class="hint">${edit ? 'La voie et les points se changent gratuitement, au village.' : '🔒 En partie : consultation seulement. Les talents se modifient au village.'} Compétence : touche <b>${keyLabel(settings.keys.skill)}</b>.</div>
  </div>`;
  for (const b of box.querySelectorAll('[data-path]')) b.onclick = () => { send({ type: 'cPath', path: b.dataset.path }); audio.play('ui'); };
  for (const b of box.querySelectorAll('[data-stat]')) b.onclick = () => { send({ type: 'cStat', stat: b.dataset.stat }); audio.play('ui'); };
  $('ctree-reset').onclick = () => { send({ type: 'cReset' }); audio.play('ui'); };
}

// Compétence de classe : état local pour le HUD (le serveur décide)
let skillUse = { night: -1, readyAt: 0 };
const fxOn = (o, s) => o?.rig?.skillFx?.s === s && performance.now() < o.rig.skillFx.until;
const SKILL_SFX = { taunt: 'portal', bulwark: 'gemPick', rage: 'monsterGrowl', blood: 'monsterAttack' };
let skillHudKey = '';
function updateSkillHud() {
  const el = $('skill');
  const sk = inGame() ? W.classSkill(profile.ctree, me.skin, W.levelOf(profile.xp)) : null;
  const now = performance.now();
  let key, html, frac = 0;
  if (!sk) { key = 'none'; html = `<span class="kbd">${keyLabel(settings.keys.skill)}</span> Compétence : choisis-la auprès du Gardien`; }
  else {
    const fx = me.rig?.skillFx, act = fx && fx.s === sk.def.id && now < fx.until;
    const rem = act ? (fx.until - now) / 1000 : 0, cd = Math.max(0, (skillUse.readyAt - now) / 1000);
    const used = sk.def.once && skillUse.night === game.clock.night;
    const st = sk.def.id === 'element' ? (me.rig?.element === 'ice' ? '❄ glace' : '🔥 feu')
      : act ? `${rem.toFixed(1)} s` : used ? 'utilisée cette nuit' : cd > 0 ? `recharge ${cd.toFixed(1)} s` : 'prête';
    frac = act ? rem / sk.dur : 0;
    key = sk.def.id + st;
    html = `<span class="kbd">${keyLabel(settings.keys.skill)}</span> ${sk.def.icon} ${sk.def.name} · <b>${st}</b>`;
    el.classList.toggle('ready', !act && !used && cd <= 0);
    el.classList.toggle('active', !!act);
  }
  if (key !== skillHudKey) { skillHudKey = key; $('skill-text').innerHTML = html; }
  $('skill-fill').style.width = frac * 100 + '%';
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
  if (near(SPOTS.forge)) return { kind: 'forge', label: 'Forge : fusion et fonte' };
  if (near(SPOTS.armory)) return { kind: 'armory', label: 'Barbare : changer de classe' };
  if (near(SPOTS.sanctum)) return { kind: 'sanctum', label: 'Gardien de maîtrise : compétences' };
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
// Niveau et expérience du héros (village + partie)
function updateHeroHud() {
  const lvl = W.levelOf(profile.xp), a = W.xpForLevel(lvl), b = W.xpForLevel(lvl + 1);
  document.querySelectorAll('.hero-lvl').forEach((e) => { e.textContent = lvl; });
  document.querySelectorAll('.xp-fill').forEach((e) => { e.style.width = clamp((profile.xp - a) / (b - a) * 100, 0, 100) + '%'; });
  $('hero-xp').textContent = `${profile.xp - a} / ${b - a} XP`;
  $('hero-acc').textContent = profile.account ? `Compte : ${profile.account}` : 'Invité (progression sur ce navigateur)';
}
// Barre de vie : la vie perdue reste en rouge clair (.ghost) puis fond en 0,5 s (transition CSS),
// la barre tremble à chaque coup, orange sous 50 %, rouge sous 20 %.
const barFrac = {};
function setBar(id, frac) {
  frac = clamp(frac, 0, 1);
  const el = $(id), bar = el.querySelector('.bar');
  el.querySelector('.fill').style.width = frac * 100 + '%';
  el.querySelector('.ghost').style.width = frac * 100 + '%';
  el.classList.toggle('mid', frac < 0.5 && frac >= 0.2);
  el.classList.toggle('low', frac < 0.2);
  if (barFrac[id] != null && frac < barFrac[id] - 1e-4) { bar.classList.remove('shake'); void bar.offsetWidth; bar.classList.add('shake'); }
  barFrac[id] = frac;
}
function updateHp() {
  $('hp-text').textContent = Math.max(0, Math.round(me.hp)) + ' / ' + me.maxHp;
  setBar('hp', me.hp / me.maxHp);
  me.rig?.setHp(me.hp / me.maxHp);
}
function updateGemHud() {
  const hp = Math.max(0, gem.state.hp);
  $('gem-hp-text').textContent = Math.round(hp) + ' / ' + W.GEM_HP;
  setBar('gem-hp', hp / W.GEM_HP);
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
      flyToHud(f);
    }
  }
}
// Arrivée près du joueur : une petite icône part de l'écran vers le compteur du HUD,
// en arc (monte puis plonge), en 0,55 s ; le compteur ne s'incrémente qu'à son arrivée.
const HUD_FLY_MS = 550;
let lastPop = 0, flyGen = 0;
function flyToHud(f) {
  const gen = flyGen;
  const v = f.mesh.position.clone().project(camera);
  const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
  const dst = $('inv-' + f.k).parentElement.querySelector('.ico').getBoundingClientRect();
  const dx = dst.left + dst.width / 2 - x, dy = dst.top + dst.height / 2 - y;
  const el = document.createElement('span');
  el.className = 'ico hud-fly ' + f.k;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  $('ui').append(el);
  el.animate([
    { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 0.6 },
    { transform: `translate(calc(${dx * 0.35}px - 50%), calc(${dy * 0.35 - 70}px - 50%)) scale(1.3)`, opacity: 1, offset: 0.35 },
    { transform: `translate(calc(${dx}px - 50%), calc(${dy}px - 50%)) scale(0.8)`, opacity: 1 },
  ], { duration: HUD_FLY_MS, easing: 'ease-in', fill: 'forwards' });
  // setTimeout plutôt qu'onfinish : se déclenche aussi onglet masqué, sinon flyPending resterait bloqué
  setTimeout(() => {
    el.remove();
    if (gen !== flyGen) return;
    const now = performance.now();
    if (now - lastPop > 70) { lastPop = now; audio.play('pop'); }
    flyPending[f.k] = Math.max(0, flyPending[f.k] - f.amt);
    syncInv();
    const res = $('inv-' + f.k).parentElement;
    res.classList.remove('bump'); void res.offsetWidth; res.classList.add('bump');
    if (f.last) popup(`+${f.total} ${W.RES_NAMES[f.k]}`, RES_COL[f.k]);
  }, HUD_FLY_MS);
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
  $('build-hint').innerHTML = `Clic gauche : poser · <span class="kbd">${keyLabel(settings.keys.demolish)}</span> / clic droit : déconstruire (½ rendu) · <span class="kbd">${keyLabel(settings.keys.repair)}</span> : réparer · Molette : étage · Maj + molette : changer · <span class="kbd">${keyLabel(settings.keys.build)}</span> : menu`;
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
  box.innerHTML = `<div class="craft-rules">♻ <b>Déconstruire</b> (${keyLabel(settings.keys.demolish)} ou clic droit) rend <b>la moitié</b> des matériaux · 🔨 <b>Réparer</b> (${keyLabel(settings.keys.repair)}) une pièce abîmée coûte la moitié de son prix × la part de vie perdue${mods.repair ? ' · ✔ Entretien : tes constructions se réparent gratuitement le jour' : ''}</div>`;
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
$('build-exit').onclick = () => { stopBuild(); audio.play('ui'); lockMouse(); };
function toggleBuild() { if (game.build.on) stopBuild(); }
function selectPiece(i) {
  const type = W.PIECE_ORDER[i];
  if (!type) return;
  if (!game.god.free && !W.pieceUnlocked(type, mods)) { toast('À débloquer auprès du Gardien de maîtrise'); return; }
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
  buildingAimed = null;
  if (!game.build.on || game.mode) { buildings.showGhost(null); buildings.showGrid(0, 0, false); game.build.plan = null; return; }
  const type = W.PIECE_ORDER[game.build.piece];
  const aim = aimPoint();
  buildings.showGrid(Math.round(aim.x / W.GRID) * W.GRID, Math.round(aim.z / W.GRID) * W.GRID, true);
  const plan = buildings.plan(type, aim, me.pos, nature.list, serverInv, game.god.free, mods, camYaw, game.build.lift || 0);
  { const pk = buildings.pick(aim); buildingAimed = pk && pk.state === 'done' && pk.hp < pk.max ? pk : null; }
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
// Page du héros / inventaire (touche I)
function openHero(mode = null) {   // mode : null (touche I) | 'forge' (fusion, fonte) | 'class' (changement de classe)
  if (!playing() || me.dead) return;
  heroPage ||= new HeroPage({ profile, me, getMods: () => mods, send, audio, inHub, setMode, toast, openTalents });
  heroPage.open(mode);
  if (mode === 'forge') audio.play('anvil', village.anvilPos);
  audio.play('ui');
}
let buildingAimed = null;
function repairPiece() {
  const b = buildings.pick(aimPoint());
  if (!b || b.hp >= b.max) { toast('Vise une construction abîmée pour la réparer'); return; }
  send({ type: 'repair', id: b.id });
  if (me.rig.attack('hammer')) send({ type: 'act', k: 'hammer' });
}
// Coup de poing à un allié tout proche (il est assommé et roule par terre)
let lastPunch = 0;
function punchAlly() {
  if (me.dead || !me.rig || me.rig.attacking || me.stunT > 0) return;
  const now = performance.now() / 1000;
  if (now - lastPunch < W.PUNCH.cd) return;
  let best = null, bd = W.PUNCH.reach + 0.4;
  for (const o of others.values()) {
    const p = o.rig.root.position, d = Math.hypot(p.x - me.pos.x, p.z - me.pos.z);
    if (d < bd && !o.rig.dead) { bd = d; best = o; }
  }
  if (!best) { toast('Approche-toi d’un allié pour lui mettre un coup de poing'); return; }
  lastPunch = now;
  const p = best.rig.root.position;
  me.attackDir = Math.atan2(p.x - me.pos.x, p.z - me.pos.z);
  me.rig.attack('punch', 1);
  send({ type: 'act', k: 'punch' });
  send({ type: 'punch', id: best.id });
}
function demolishPiece() {
  const b = buildings.pick(aimPoint());
  if (b) { send({ type: 'demolish', id: b.id }); if (me.rig.attack('hammer')) send({ type: 'act', k: 'hammer' }); }
}

// ===================== Interaction (touche F) =====================
function interact() {
  if (me.dead) return;
  if (inHub()) {
    const it = hubInteraction();
    if (!it) return;
    audio.play('ui');
    if (it.kind === 'portal') openLaunch();
    else if (it.kind === 'forge') openHero('forge');
    else if (it.kind === 'armory') openHero('class');
    else if (it.kind === 'sanctum') openSkills();
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
  const aspd = mods.atkSpeed * (fxOn(me, 'rage') ? 2 : 1);   // Rage : vitesse d'attaque doublée
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  // au village : on frappe dans le vide, devant la caméra (avant, la direction restait celle du départ)
  if (inHub()) { if (me.rig.attack(cls.kind, mods.atkSpeed)) { me.attackDir = Math.atan2(fx, fz); send({ type: 'act', k: cls.kind }); audio.play('swing', me.pos); } return; }
  // la voleuse vise loin avec son arc ; les autres frappent au corps à corps
  const mon = cls.ranged || cls.missile ? (currentTarget ? null : monsters.findAlongAim(me.pos, camera, cls.range)) : monsters.findInFront(me.pos.x, me.pos.z, fx, fz, cls.reach - 1.4);
  const t = mon ? null : currentTarget;
  const kind = t ? (t.kind === 'tree' ? 'chop' : t.kind === 'rock' ? 'mine' : cls.kind) : cls.kind;
  const combat = kind === cls.kind;
  // temps entre deux coups propre à chaque style
  if (combat && now - lastAtk < cls.cd / aspd * 0.95) return;
  const sp = combat ? Math.max(1, (cls.kind === 'shoot' ? 0.95 : 0.6) / (cls.cd / aspd)) * (cls.kind === 'shoot' ? 1 : aspd) : mods.harvestSpeed;
  if (combat) lastAtk = now;
  me.rig.attack(kind, sp);
  me.attackTarget = t;
  me.attackMonster = mon;
  if (mon) me.attackDir = Math.atan2(mon.rig.root.position.x - me.pos.x, mon.rig.root.position.z - me.pos.z);
  else if (t) me.attackDir = Math.atan2(t.x - me.pos.x, t.z - me.pos.z);
  else me.attackDir = Math.atan2(fx, fz);
  // point visé (flèche, boule de feu)
  me.aimTo = mon ? { x: mon.rig.root.position.x, y: mon.rig.root.position.y + 1.1, z: mon.rig.root.position.z }
    : kind === 'shoot' ? aimFar(cls.range) : kind === 'staff' ? aimGround(cls.range) : null;
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
    if (a.fire) for (let j = 0; j < 2; j++) fx.spawn({ geo: fx.box, mat: fireMats[(Math.random() * 3) | 0], pos: a.mesh.position.clone(), vel: new THREE.Vector3((Math.random() - 0.5), 0.6, (Math.random() - 0.5)), size: 0.12, life: 0.4, gravity: -1, drag: 2 });
    if (k >= 1) {
      worldRoot.remove(a.mesh);
      arrows.splice(i, 1);
      if (a.fire) fireBurst(a.to);
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
const iceMats = ['#ffffff', '#9be4ff', '#4ab8ff'].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }));
function iceBurst(p) {
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * W.CLASSES.Mage.aoe;
    fx.spawn({ geo: fx.box, mat: iceMats[i % 3], pos: new THREE.Vector3(p.x + Math.cos(a) * r * 0.3, p.y + 0.2, p.z + Math.sin(a) * r * 0.3),
      vel: new THREE.Vector3(Math.cos(a) * r * 1.4, 1 + Math.random() * 2, Math.sin(a) * r * 1.4), size: 0.07 + Math.random() * 0.08, life: 0.7, gravity: 4, drag: 2.5, spin: 6 });
  }
  fx.puff(new THREE.Vector3(p.x, p.y + 0.3, p.z), 0x9be4ff, 5, 0.7);
  audio.play('splash', p);
}
// petites particules au bout du bâton : couleur de l'élément actif (voie Élémentaire)
const _tip = new THREE.Vector3();
function staffSparks() {
  for (const o of [me, ...others.values()]) {
    const r = o.rig;
    if (!r?.flame || !r.element || (o === me ? profile.ctree?.Mage?.path : r.path) !== 'element' || Math.random() > 0.3) continue;
    r.flame.getWorldPosition(_tip);
    fx.spawn({ geo: fx.box, mat: (r.element === 'ice' ? iceMats : fireMats)[(Math.random() * 3) | 0], pos: _tip.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.7, (Math.random() - 0.5) * 0.6), size: 0.05, life: 0.45, gravity: r.element === 'ice' ? 1 : -1, drag: 2 });
  }
  me.rig?.setSentinel(inGame() && me.skin === 'Rogue' && profile.ctree?.Rogue?.path === 'sentinel');
}
function magicPuff(p) { fx.puff(new THREE.Vector3(p.x, p.y + 1, p.z), 0xb090ff, 7, 0.8); audio.play('dash', p); }
// Blink : téléportation d'environ 10 m vers l'avant (le serveur a validé la recharge)
function doBlink() {
  const bx = -Math.sin(camYaw), bz = -Math.cos(camYaw);
  me.pos.x = clamp(me.pos.x + bx * 10, -WORLD_LIMIT, WORLD_LIMIT);
  me.pos.z = clamp(me.pos.z + bz * 10, -WORLD_LIMIT, WORLD_LIMIT);
  me.pos.y = Math.max(me.pos.y, terrainH(me.pos.x, me.pos.z));
  me.rig.root.position.copy(me.pos);
  magicPuff(me.pos);
}
// flèche d'une compétence (dégâts déjà appliqués par le serveur) : petite pour la Sentinelle, grosse et enflammée pour Dead Eye
function flyArrow(from, mon, size, fire) {
  const mesh = prop('x_arrow', 1.1 * size);
  mesh.position.copy(from);
  worldRoot.add(mesh);
  const to = mon.rig.root.position.clone().setY(mon.rig.root.position.y + 1.1);
  const dist = from.distanceTo(to);
  arrows.push({ mesh, from: from.clone(), to, t: 0, dur: Math.max(0.12, dist / (fire ? 30 : 40)), mon, arc: fire ? dist * 0.08 : 0, fire });
}
// Dead Eye : focus à la première personne, on survole jusqu'à 10 cibles, puis les flèches partent
let deadeye = null;
function startDeadeye(dur) {
  deadeye = { until: performance.now() + dur * 1000, marks: new Set() };
  if (me.rig) me.rig.root.visible = false;
  canvas.style.filter = 'sepia(0.55) saturate(1.5) contrast(1.1)';
  $('ui').classList.add('deadeye');
}
function updateDeadeye() {
  if (!deadeye) return;
  if (performance.now() > deadeye.until || me.dead) { endDeadeye(); return; }
  const m = monsters.findAlongAim(me.pos, camera, W.DEADEYE.range);
  if (m && !deadeye.marks.has(m.id) && deadeye.marks.size < W.DEADEYE.max) {
    deadeye.marks.add(m.id); m.rig.marked = true;
    audio.play('ui');
  }
}
function endDeadeye(silent = false) {
  const ids = [...deadeye.marks];
  for (const id of ids) { const m = monsters.map.get(id); if (m) m.rig.marked = false; }
  deadeye = null;
  if (me.rig) me.rig.root.visible = true;
  canvas.style.filter = '';
  $('ui').classList.remove('deadeye');
  if (!silent) send({ type: 'deadeye', ids });
}

// Boule de feu du mage : part du bâton, explose à l'impact (dégâts en zone + brûlure)
const fireballs = [];
let fireTex = null;
function fireballMesh() {
  if (!fireTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,200,1)'); gr.addColorStop(0.3, 'rgba(255,170,50,0.9)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    fireTex = new THREE.CanvasTexture(c);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.scale.setScalar(0.8);
  return sp;
}
function shootFire(rig, to, mon, mine = false) {
  const from = new THREE.Vector3();
  const st = rig.tools.staff;
  if (st) { st.updateMatrixWorld(true); from.set(0, (st.userData.len || 1) * 0.92, 0).applyMatrix4(st.matrixWorld); }
  else rig.root.getWorldPosition(from).setY(from.y + 1.4);
  const target = new THREE.Vector3(to.x, to.y ?? heightAt(to.x, to.z), to.z);
  const mesh = fireballMesh();
  const ice = rig.element === 'ice';
  if (ice) mesh.material.color.set('#9be4ff');
  mesh.position.copy(from);
  worldRoot.add(mesh);
  const dist = from.distanceTo(target);
  fireballs.push({ mesh, from, to: target, t: 0, dur: Math.max(0.1, dist / 24), mon, mine, arc: dist * 0.06, ice });
  audio.play('fire', from);
}
function updateFireballs(dt) {
  for (let i = fireballs.length - 1; i >= 0; i--) {
    const f = fireballs[i];
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    if (f.mon && !f.mon.dead) f.to.set(f.mon.rig.root.position.x, f.mon.rig.root.position.y + 0.9, f.mon.rig.root.position.z);
    f.mesh.position.lerpVectors(f.from, f.to, k);
    f.mesh.position.y += Math.sin(k * Math.PI) * f.arc;
    f.mesh.scale.setScalar(0.7 + Math.sin(f.t * 30) * 0.1);
    if (Math.random() < 0.7) fx.spawn({ geo: fx.box, mat: (f.ice ? iceMats : fireMats)[(Math.random() * 3) | 0], pos: f.mesh.position.clone(), vel: new THREE.Vector3((Math.random() - 0.5), 0.8, (Math.random() - 0.5)), size: 0.07, life: 0.35, gravity: -1, drag: 2 });
    if (k >= 1) {
      worldRoot.remove(f.mesh); f.mesh.material.dispose();
      fireballs.splice(i, 1);
      const c = new THREE.Vector3(f.to.x, heightAt(f.to.x, f.to.z), f.to.z);
      if (f.ice) iceBurst(c); else fireBurst(c);
      if (f.mine) { send({ type: 'hitM', id: f.mon && !f.mon.dead ? f.mon.id : null, x: +c.x.toFixed(2), z: +c.z.toFixed(2) }); camShake = Math.max(camShake, 0.06); }
    }
  }
}
// point visé au sol (ou au loin) le long du regard de la caméra
function aimGround(range) {
  camera.getWorldDirection(_ray);
  const p = camera.position.clone();
  for (let d = 0; d < range + camDist; d += 0.4) {
    p.addScaledVector(_ray, 0.4);
    if (p.y <= heightAt(p.x, p.z)) break;
  }
  const dx = p.x - me.pos.x, dz = p.z - me.pos.z, dd = Math.hypot(dx, dz);
  if (dd > range) { p.x = me.pos.x + dx / dd * range; p.z = me.pos.z + dz / dd * range; }
  p.y = heightAt(p.x, p.z) + 0.3;
  return { x: p.x, y: p.y, z: p.z };
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
    // boule de feu lancée vers la cible (ou là où l'on vise)
    shootFire(me.rig, me.aimTo || aimGround(cls.range), mon && !mon.dead ? mon : null, true);
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
// ----- Endurance, dash, double saut -----
function useStam(n) {
  me.stam = Math.max(0, me.stam - n);
  me.stamIdle = 0;
  if (me.stam <= 0) me.tired = true;   // à bout de souffle : il faut récupérer un peu
}
function tryDash() {
  if (!mods.dash || me.dead || me.dash || !me.rig || me.rig.attacking || (inGame() && gem.state.carrier === me.id)) return;
  if (me.stam < mods.dashCost) { flashStam(); return; }
  let fx = 0, fz = 0;
  if (pressed('forward') || keys.ArrowUp) fz += 1;
  if (pressed('back') || keys.ArrowDown) fz -= 1;
  if (pressed('left') || keys.ArrowLeft) fx += 1;
  if (pressed('right') || keys.ArrowRight) fx -= 1;
  let dx, dz;
  if (fx || fz) {
    const len = Math.hypot(fx, fz); fx /= len; fz /= len;
    const sn = Math.sin(camYaw), cs = Math.cos(camYaw);
    dx = fz * -sn + fx * -cs; dz = fz * -cs + fx * sn;
  } else { dx = Math.sin(me.ry); dz = Math.cos(me.ry); }
  useStam(mods.dashCost);
  me.dash = { t: 0, dx, dz, hit: new Set() };
  me.rig.startDodge(0);
  audio.play('dash', me.pos);
  fx2Puff();
  send({ type: inGame() ? 'dash' : 'hubDash', dir: 0 });
}
function fx2Puff() { fx.puff(new THREE.Vector3(me.pos.x, me.pos.y + 0.2, me.pos.z), 0xe8e0d0, 4, 0.5); }
let stamShown = -1, stamFlashT = 0;
function flashStam() { stamFlashT = 0.5; $('stam').classList.add('flash'); }
function updateStamHud() {
  const k = Math.round(clamp(me.stam / mods.stamina, 0, 1) * 200);
  if (k !== stamShown) { stamShown = k; $('stam-fill').style.width = (k / 2) + '%'; }
  $('stam').classList.toggle('tired', me.tired);
  $('stam').classList.toggle('full', k >= 200);
  if (stamFlashT > 0 && (stamFlashT -= 1 / 60) <= 0) $('stam').classList.remove('flash');
}
function updatePlayer(dt) {
  const rig = me.rig;
  const carrying = inGame() && gem.state.carrier === me.id;
  rig.carrying = carrying;
  if (me.stunT > 0) me.stunT -= dt;
  const stunned = me.stunT > 0;
  const canMove = !me.dead && !stunned && (!game.mode || game.mode === 'map');
  if (stunned && me.knockV > 0) {
    // glissade après le coup de poing
    me.pos.x += Math.sin(me.knockDir) * me.knockV * dt; me.pos.z += Math.cos(me.knockDir) * me.knockV * dt;
    me.knockV = Math.max(0, me.knockV - 7 * dt);
  }
  let fx = 0, fz = 0;
  if (canMove) {
    if (pressed('forward') || keys.ArrowUp) fz += 1;
    if (pressed('back') || keys.ArrowDown) fz -= 1;
    if (pressed('left') || keys.ArrowLeft) fx += 1;
    if (pressed('right') || keys.ArrowRight) fx -= 1;
  }
  const moving = fx || fz;
  // endurance : courir la vide, elle revient quand on ne force plus
  const wantRun = pressed('run') && moving && canMove;
  const running = wantRun && !me.tired && me.stam > 0;
  if (running) useStam(mods.sprintCost * dt);
  let speed = (running ? RUN_SPEED : WALK_SPEED) * mods.speed * (fxOn(me, 'rage') ? 1.6 : 1);
  if (rig.attacking) speed *= rig.atk?.kind === 'shoot' ? 0.5 : 0.3;
  if (rig.blocking) speed *= 0.5;
  // dalles de chemin : on va beaucoup plus vite (le sprint aussi)
  const onPath = inGame() && buildings.onPath(me.pos.x, me.pos.z, me.pos.y);
  if (onPath) speed *= W.PATH_SPEED;
  if (onPath !== game.onPath) { game.onPath = onPath; $('path-boost').classList.toggle('on', onPath); }
  if (carrying && !mods.carry) speed *= 0.82;
  const inWater = inGame() && W.isWater(me.pos.x, me.pos.z) && me.pos.y < W.waterLevelAt(me.pos.x);
  if (inWater) speed *= 0.6;

  const bx = me.pos.x, bz = me.pos.z;
  // dash : bond très rapide pendant un court instant
  if (me.dash) {
    const D = me.dash;
    D.t += dt;
    const k = Math.min(dt, Math.max(0, W.DASH.time * mods.dashDist - (D.t - dt)));
    me.pos.x += D.dx * W.DASH.speed * k;
    me.pos.z += D.dz * W.DASH.speed * k;
    me.ry += wrap(Math.atan2(D.dx, D.dz) - me.ry) * Math.min(1, dt * 20);
    if (mods.charge && inGame()) {
      const ids = [];
      for (const m of monsters.map.values()) {
        if (m.dead || D.hit.has(m.id)) continue;
        const mp = m.rig.root.position;
        if (Math.hypot(mp.x - me.pos.x, mp.z - me.pos.z) < 1.7) { D.hit.add(m.id); ids.push(m.id); audio.play('swordHit', mp); }
      }
      if (ids.length) { send({ type: 'dashHit', ids }); camShake = 0.12; }
    }
    if (D.t > W.DASH.time * mods.dashDist + 0.12) me.dash = null;
  }
  if (moving && !me.dash) {
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
  const jumpDown = canMove && pressed('jump'), jumpEdge = jumpDown && !me.jumpHeld;
  me.jumpHeld = jumpDown;
  if (jumpDown && me.grounded && !rig.attacking) { me.vy = JUMP_FORCE * mods.jump * (inWater ? 0.7 : 1); me.grounded = false; me.jumps = 1; audio.play('jump', me.pos); }
  else if (jumpEdge && !me.grounded && mods.djump && me.jumps < 2 && me.stam >= W.STAMINA.djump && !inWater) {
    // double saut (avec un salto)
    me.jumps = 2; me.vy = JUMP_FORCE * mods.jump * 0.95; useStam(W.STAMINA.djump);
    rig.flip(); audio.play('jump', me.pos); send({ type: inGame() ? 'jump2' : 'hubJump2' });
    fx2Puff();
  }
  if (!me.grounded) {
    me.vy -= GRAVITY * dt;
    // planeur : Espace maintenu en descendant
    if (mods.glide && jumpDown && me.vy < -1.6 && me.stam > 0) { me.vy = -1.6; useStam(9 * dt); }
    me.pos.y += me.vy * dt;
    if (me.pos.y <= groundY) { me.pos.y = groundY; if (me.vy < -6) audio.play('land', me.pos); me.vy = 0; me.grounded = true; me.jumps = 0; }
  } else if (me.pos.y - groundY > 0.35) me.grounded = false;
  else me.pos.y = groundY;
  me.speed = Math.hypot(me.pos.x - bx, me.pos.z - bz) / Math.max(dt, 1e-4);
  if (me.dash) me.speed = Math.min(me.speed, 5);
  // récupération de l'endurance
  me.stamIdle += dt;
  if (me.stamIdle > W.STAMINA.delay) me.stam = Math.min(mods.stamina, me.stam + mods.stamRegen * dt);
  if (me.tired && me.stam > mods.stamina * 0.3) me.tired = false;
  updateStamHud();

  if (mouseHeld && isLocked() && !game.mode && !game.build.on && !stunned) tryAttack();

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
  else if (!me.dead && carrying) { pr.style.display = 'block'; pr.innerHTML = `<kbd>${K}</kbd> Poser le Joyau <span class="gem-timer">${Math.max(0, Math.ceil(((game.gemCarryEnd || 0) - performance.now()) / 1000))} s</span>`; }
  else if (!me.dead && !gem.state.carrier && Math.hypot(gem.pos.x - me.pos.x, gem.pos.z - me.pos.z) < 2.6) {
    const rest = Math.ceil(((game.gemReady || 0) - performance.now()) / 1000);
    pr.style.display = 'block'; pr.innerHTML = rest > 0 ? `Le Joyau se repose… <span class="gem-timer">${rest} s</span>` : `<kbd>${K}</kbd> Prendre le Joyau`;
  }
  else if (!me.dead && game.build.on && buildingAimed && buildingAimed.hp < buildingAimed.max) {
    const c = W.repairCost(buildingAimed, mods);
    pr.style.display = 'block'; pr.innerHTML = `<kbd>${keyLabel(settings.keys.repair)}</kbd> Réparer ${W.PIECES[buildingAimed.type].name} (${Math.round(buildingAimed.hp)}/${buildingAimed.max}) · ${game.god.free ? 'gratuit' : costHtml(c) || 'gratuit'}`;
  }
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
  if (deadeye) {
    // Dead Eye : vue à la première personne
    const cp = Math.cos(camPitch);
    camera.position.set(me.pos.x, me.pos.y + 1.5, me.pos.z);
    camera.lookAt(me.pos.x - Math.sin(camYaw) * cp, me.pos.y + 1.5 - Math.sin(camPitch), me.pos.z - Math.cos(camYaw) * cp);
    audio.setListener(camera.position.x, camera.position.y, camera.position.z, -fwdZ, fwdX);
    return;
  }
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
    updateSkillHud();
    updateDeadeye();
    staffSparks();
    updateArrows(dt);
  if (inGame()) loots.update(dt, me.dead ? null : me.pos, send);
  updateFireballs(dt);
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
  testSkills: (l) => { profile.skills = l; mods = computeMods(); me.stam = mods.stamina; },
  get heroPage() { return heroPage; }, get loots() { return loots; }, profile,
  get mods() { return mods; },
  setView: (yaw, pitch, dist) => { camYaw = yaw; camPitch = pitch; camDist = dist; },
  pause: (v = true) => { paused = v; },
  advance: (sec, step = 1 / 30) => {
    const t0 = performance.now();
    for (let t = 0; t < sec - 1e-6; t += step) tick(step);
    const t1 = performance.now();
    renderer.render(scene, camera);
    return { simMs: t1 - t0, renderMs: performance.now() - t1 };
  },
  setBuild: (on, piece = 0) => { if (on) choosePiece(piece); else stopBuild(); },
  W,
  place: () => placePiece(),
  interact: () => interact(),
  openAdmin: () => openAdmin(),
  setMode: (m) => setMode(m),
  open: (what) => ({ skills: openSkills, board: openBoard, launch: openLaunch, players: openPlayers })[what](),
  toggleMap: (tp) => toggleMap(tp),
  shot: (px, py, pz, tx, ty, tz) => { camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); renderer.render(scene, camera); },
};
void SPAWN;
