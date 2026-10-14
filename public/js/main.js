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
import { settings, saveSettings, keyLabel, ACTIONS, DEFAULT_KEYS, lsGet, lsSet } from './settings.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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
audio.setVolumes({ music: settings.music / 100, amb: settings.amb / 100, sfx: settings.sfx / 100 });

createGround(scene);
const river = new River(scene);
const sky = new Sky(scene);
const grass = new Grass(scene, wind, Q.grass);
const nature = new Nature(scene, wind);
nature.audio = audio;
const fx = nature.fx;
const gem = new Gem(scene, fx);
const buildings = new Buildings(scene, fx, audio);
const monsters = new Monsters(scene, fx, audio);
const worldMap = new WorldMap();

// ===================== État =====================
const me = {
  id: null, rig: null, pos: new THREE.Vector3(), vy: 0, grounded: true, ry: 0, speed: 0,
  hp: W.PLAYER_HP, dead: false, deadT: 0, attackTarget: null, attackMonster: null, attackDir: 0,
  inv: { wood: 0, stone: 0 }, name: '',
};
const others = new Map();
const game = {
  started: false, code: '', solo: false, host: null, survived: 0,
  clock: { time: W.START_TIME, night: 0 },
  god: { on: false, invuln: false, free: false },
  build: { on: false, piece: 0, plan: null },
  mode: null, // null | 'chat' | 'map' | 'admin' | 'pause'
  tpMode: false, over: false,
};
let camYaw = 0, camPitch = 0.3, camDist = 6, camShake = 0;
const camTarget = new THREE.Vector3();
const keys = {};
let mouseHeld = false;
const pressed = (action) => !!keys[settings.keys[action]];

// ===================== Souris capturée =====================
const canvas = renderer.domElement;
const isLocked = () => document.pointerLockElement === canvas;
function lockMouse() {
  if (!game.started || isLocked()) return;
  try {
    const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { const p2 = canvas.requestPointerLock(); if (p2 && p2.catch) p2.catch(() => setMode('pause')); });
  } catch { setMode('pause'); }
}
document.addEventListener('pointerlockerror', () => { if (game.started && !game.mode) setMode('pause'); });
document.addEventListener('pointerlockchange', () => {
  mouseHeld = false;
  if (!isLocked() && game.started) {
    if (game.mode === 'chat') closeChat(false);
    if (!game.mode || game.mode === 'chat') setMode('pause');
  }
  updateStatus();
});
canvas.addEventListener('mousedown', (e) => {
  if (!game.started) return;
  if (!isLocked()) { if (!game.mode || game.mode === 'pause') { setMode(null); lockMouse(); } return; }
  if (e.button === 0) {
    mouseHeld = true;
    if (game.build.on) placePiece();
  }
  if (e.button === 2 && game.build.on) demolishPiece();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mouseup', (e) => { if (e.button === 0) mouseHeld = false; });
addEventListener('mousemove', (e) => {
  if (!isLocked()) return;
  const s = 0.0025 * settings.sens / 100;
  camYaw -= e.movementX * s;
  camPitch = clamp(camPitch + e.movementY * s, -0.45, 1.25);
});
addEventListener('wheel', (e) => {
  if (!game.started || game.mode === 'map') return;
  if (game.build.on) { selectPiece((game.build.piece + (e.deltaY > 0 ? 1 : -1) + 3) % 3); return; }
  camDist = clamp(camDist + e.deltaY * 0.01, 2.5, 14);
}, { passive: true });

// ===================== Modes d'interface =====================
function setMode(m) {
  game.mode = m;
  $('pause').hidden = m !== 'pause';
  $('admin').hidden = m !== 'admin';
  $('mapview').hidden = m !== 'map';
  $('mapview').classList.toggle('tp', m === 'map' && game.tpMode);
  if (m !== 'map') game.tpMode = false;
  if (m === 'pause' || m === 'admin' || (m === 'map' && game.tpMode)) { if (isLocked()) document.exitPointerLock(); }
  $('crosshair').classList.toggle('hidden', !!m && m !== 'chat');
}
$('btn-resume').onclick = () => { audio.play('ui'); setMode(null); lockMouse(); };
$('btn-quit').onclick = () => { location.href = location.pathname; };
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
  if (document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement.id !== 'chat-input') return;
  if (game.mode === 'chat') {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); sendChat(); }
    else if (e.code === 'Escape') closeChat(true);
    return;
  }
  keys[e.code] = true;
  if (!game.started) return;
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  const K = settings.keys;
  if (e.repeat) return;
  if (e.code === K.chat || e.code === 'NumpadEnter') { e.preventDefault(); if (!game.mode) openChat(); return; }
  if (e.code === K.map) { toggleMap(false); return; }
  if (game.mode) return;
  if (e.code === K.build) toggleBuild();
  if (e.code === K.interact) interact();
  if (game.build.on && /^Digit[1-3]$/.test(e.code)) selectPiece(+e.code.slice(5) - 1);
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
  setTimeout(() => chatInput.focus(), 0);
  for (const k in keys) keys[k] = false;
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
    b.style.color = '#' + (d.color ?? 0xffffff).toString(16).padStart(6, '0');
    div.append(b, document.createTextNode(d.text));
  } else div.textContent = d.text;
  chatLog.append(div);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
  setTimeout(() => div.classList.add('old'), 12000);
}

// ===================== Carte =====================
function toggleMap(tp) {
  if (game.mode === 'map') { setMode(null); if (!isLocked()) lockMouse(); return; }
  if (game.mode && game.mode !== 'admin') return;
  game.tpMode = tp;
  setMode('map');
  $('map-hint').innerHTML = tp ? 'Clique sur la carte pour te téléporter · <span class="kbd">' + keyLabel(settings.keys.map) + '</span> pour fermer'
    : '<span class="kbd">' + keyLabel(settings.keys.map) + '</span> pour fermer';
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
    others: [...others.values()].map((o) => ({ x: o.rig.root.position.x, z: o.rig.root.position.z, ry: o.rig.root.rotation.y, color: '#' + o.color.toString(16).padStart(6, '0'), name: o.name })),
    monsters: [...monsters.map.values()].filter((m) => !m.dead).map((m) => ({ x: m.rig.root.position.x, z: m.rig.root.position.z })),
    resources: nature.list, buildings: [...buildings.map.values()],
    gem: { x: gem.pos.x, z: gem.pos.z }, camYaw,
  };
}
function drawBigMap() { worldMap.drawFull($('bigmap'), mapData(), game.tpMode); }

// ===================== Admin =====================
function openAdmin() {
  setMode('admin');
  $('admin-invuln').checked = game.god.invuln;
  $('admin-free').checked = game.god.free;
}
$('admin-close').onclick = () => { setMode(null); lockMouse(); };
document.querySelectorAll('[data-admin]').forEach((b) => {
  b.onclick = () => {
    audio.play('ui');
    const c = b.dataset.admin;
    if (c === 'tp') { toggleMap(true); return; }
    if (c === 'spawn' || c === 'spawn5') {
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      send({ type: 'admin', cmd: 'spawn', n: c === 'spawn5' ? 5 : 1, x: me.pos.x + fx * 7, z: me.pos.z + fz * 7 });
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
  for (const [id, key] of [['vol-music', 'music'], ['vol-amb', 'amb'], ['vol-sfx', 'sfx'], ['sens', 'sens']]) {
    const el = $(id);
    el.value = settings[key];
    el.nextElementSibling.textContent = settings[key] + (key === 'sens' ? '%' : '');
    el.oninput = () => {
      settings[key] = +el.value;
      el.nextElementSibling.textContent = el.value + (key === 'sens' ? '%' : '');
      audio.setVolumes({ music: settings.music / 100, amb: settings.amb / 100, sfx: settings.sfx / 100 });
      saveSettings();
    };
  }
  $('quality').value = settings.quality === 'low' ? 'low' : 'high';
  renderKeybinds();
}
$('quality').onchange = () => {
  settings.quality = $('quality').value; saveSettings();
  if (!game.started) location.reload();
  else addChat({ sys: 'info', text: 'Les graphismes changeront au prochain chargement de la page.' });
};
$('options-close').onclick = () => { $('options').hidden = true; audio.play('ui'); };
$('btn-lobby-options').onclick = () => { audio.init(); openOptions(); };
$('btn-fullscreen').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
};
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
  $('help').textContent = `Clic : frapper · ${keyLabel(K.build)} : construire · ${keyLabel(K.interact)} : Joyau · ${keyLabel(K.map)} : carte · ${keyLabel(K.chat)} : chat · Échap : menu`;
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
    if (game.started) addChat({ sys: 'warn', text: 'Connexion perdue avec le serveur. Recharge la page (F5).' });
    updateStatus();
  };
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    const h = handlers[d.type];
    if (h) h(d);
  };
}

const handlers = {
  you: (d) => { me.id = d.id; },
  lobbyError: (d) => { $('lobby-error').textContent = d.text; },
  room: (d) => {
    game.code = d.code; game.solo = d.solo; game.host = d.host;
    if (game.started) { updateStatus(); return; }
    if (d.solo) return;
    $('lobby-home').hidden = true;
    $('lobby-group').hidden = false;
    $('lobby-error').textContent = '';
    $('group-code').textContent = d.code;
    $('member-count').textContent = d.members.length;
    const ul = $('members');
    ul.innerHTML = '';
    for (let i = 0; i < W.MAX_PLAYERS; i++) {
      const m = d.members[i];
      const li = document.createElement('li');
      if (m) {
        const dot = document.createElement('span');
        dot.className = 'dot'; dot.style.background = '#' + m.color.toString(16).padStart(6, '0');
        li.append(dot, document.createTextNode(m.name + (m.id === me.id ? ' (toi)' : '')));
        if (m.id === d.host) { const c = document.createElement('span'); c.className = 'crown'; c.textContent = '👑 Hôte'; li.append(c); }
      } else { li.className = 'empty'; li.textContent = 'En attente d\'un joueur…'; }
      ul.append(li);
    }
    const isHost = d.host === me.id;
    $('btn-start').hidden = !isHost;
    $('wait-host').hidden = isHost;
  },
  host: (d) => { game.host = d.host; updateStatus(); },
  welcome: (d) => applyWelcome(d),
  join: (d) => { addOther(d.player); updateStatus(); },
  leave: (d) => {
    const o = others.get(d.id);
    if (o) { o.rig.dispose(scene); others.delete(d.id); }
    updateStatus();
  },
  move: (d) => {
    const o = others.get(d.id);
    if (!o) return;
    o.target.set(d.x, d.y, d.z); o.ry = d.ry; o.s = d.s; o.g = d.g;
    if (!o.rig.attacking) o.rig.setTool(TOOLS[d.tl] || 'sword');
  },
  act: (d) => {
    const o = others.get(d.id);
    if (!o) return;
    o.rig.attack(d.k);
    if (d.k === 'slash') audio.play('swing', o.rig.root.position);
  },
  inv: (d) => {
    me.inv = d.inv;
    updateInv();
    if (d.gain) {
      for (const k in d.gain) {
        popup(`+${d.gain[k]} ${k === 'wood' ? 'Bois' : 'Pierre'}`, k === 'wood' ? '#e0b070' : '#d0d0d0');
        const el = $(k === 'wood' ? 'inv-wood' : 'inv-stone').parentElement;
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      }
      audio.play('pickup');
    }
  },
  resHit: (d) => {
    nature.setHp(d.id, d.hp);
    if (d.by !== me.id) {
      nature.hit(d.id, d.fx, d.fz);
      const r = nature.resources.get(d.id);
      if (r) audio.play(r.kind === 'tree' ? 'chop' : 'pick', new THREE.Vector3(r.x, r.y + 1, r.z));
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
  mHurt: (d) => {
    monsters.hurt(d.id, d.hp);
    if (d.by !== me.id) { const m = monsters.map.get(d.id); if (m) audio.play('swordHit', m.rig.root.position); }
  },
  mDie: (d) => monsters.die(d.id, d.burn),
  pHp: (d) => {
    if (d.id === me.id) {
      const before = me.hp;
      me.hp = d.hp;
      if (d.hurt && d.hp < before) {
        me.rig?.hurt();
        audio.play('playerHurt');
        flashVignette();
        camShake = 0.25;
      }
      updateHp();
    } else {
      const o = others.get(d.id);
      if (!o) return;
      o.rig.setHp(d.hp / W.PLAYER_HP);
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
      me.dead = false; me.hp = W.PLAYER_HP;
      me.pos.set(d.x, heightAt(d.x, d.z), d.z); me.vy = 0;
      camTarget.copy(me.pos);
      me.rig.revive();
      me.rig.setHp(1);
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
      showBanner(`Nuit ${d.night}`, 'Les monstres arrivent… Protégez le Joyau !', 4000);
      audio.stinger('night');
    } else {
      game.survived = d.survived;
      showBanner(`Jour ${d.night + 1}`, d.night > 0 ? `Vous avez survécu à ${d.night} nuit${d.night > 1 ? 's' : ''}` : '', 4000);
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
  },
  tp: (d) => { me.pos.set(d.x, heightAt(d.x, d.z) + 0.5, d.z); me.vy = 0; me.grounded = false; camTarget.copy(me.pos); },
  gameOver: (d) => {
    game.over = true;
    gem.shatter();
    audio.play('rockBreak', gem.pos);
    $('gameover').hidden = false;
    $('gameover-text').textContent = `Nuits survécues : ${d.survived}`;
    audio.stinger('night');
    if (isLocked()) document.exitPointerLock();
  },
};

function addOther(p) {
  if (others.has(p.id) || p.id === me.id) return;
  const rig = new CharacterRig(p.color, p.name);
  rig.root.position.set(p.x, p.y, p.z);
  rig.root.rotation.y = p.ry;
  rig.stepCb = () => audio.play(W.isWater(rig.root.position.x, rig.root.position.z) ? 'splashStep' : 'step', rig.root.position);
  scene.add(rig.root, rig.trail.mesh);
  if (p.dead) rig.die();
  rig.setHp(p.hp / W.PLAYER_HP);
  others.set(p.id, { rig, name: p.name, color: p.color, target: new THREE.Vector3(p.x, p.y, p.z), ry: p.ry, s: 0, g: true });
}

function applyWelcome(d) {
  game.started = true;
  game.over = false;
  game.code = d.code; game.solo = d.solo; game.host = d.host;
  game.survived = d.survived || 0;
  game.clock.time = d.clock.time; game.clock.night = d.clock.night;
  me.id = d.you.id;
  me.name = d.you.name;
  if (!me.rig) {
    me.rig = new CharacterRig(d.you.color, d.you.name);
    me.rig.stepCb = () => audio.play(W.isWater(me.pos.x, me.pos.z) ? 'splashStep' : 'step', me.pos);
    scene.add(me.rig.root, me.rig.trail.mesh);
  }
  me.rig.revive();
  me.dead = false;
  me.hp = d.you.hp;
  me.rig.setHp(1);
  me.pos.set(d.you.x, heightAt(d.you.x, d.you.z), d.you.z);
  me.vy = 0;
  camTarget.copy(me.pos);
  for (const o of others.values()) o.rig.dispose(scene);
  others.clear();
  d.players.forEach(addOther);
  nature.load(d.resources);
  currentTarget = null;
  buildings.clear();
  d.buildings.forEach((b) => buildings.add(b, true));
  grass.setMask(buildings.floors());
  monsters.clear();
  d.monsters.forEach((m) => monsters.spawn(m, true));
  gem.set(d.gem);
  me.inv = d.inv;
  if (game.build.on) toggleBuild();
  $('lobby').hidden = true;
  $('ui').hidden = false;
  $('gameover').hidden = true;
  $('death').hidden = true;
  updateInv(); updateHp(); updateGemHud(); updateStatus(); updateHelp(); renderBuildBar();
  setMode(null);
  lockMouse();
  if (!game.welcomed) {
    game.welcomed = true;
    showBanner(`Jour ${game.clock.night + 1}`, 'Récolte du bois et de la pierre, puis construis tes défenses', 4500);
  }
}

// ===================== Lobby =====================
const nameInput = $('name');
nameInput.value = lsGet('rpg3d_name') || '';
const urlCode = new URLSearchParams(location.search).get('g');
if (urlCode) { $('join-code').value = urlCode.toUpperCase(); }
function getName() {
  const n = nameInput.value.trim() || 'Aventurier' + Math.floor(Math.random() * 1000);
  lsSet('rpg3d_name', n);
  return n;
}
$('btn-solo').onclick = () => { audio.init(); audio.play('ui'); send({ type: 'create', solo: true, name: getName() }); };
$('btn-create').onclick = () => { audio.init(); audio.play('ui'); send({ type: 'create', solo: false, name: getName() }); };
$('btn-join').onclick = () => {
  audio.init(); audio.play('ui');
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('lobby-error').textContent = 'Le code fait 4 caractères.'; return; }
  send({ type: 'joinRoom', code, name: getName() });
};
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-start').onclick = () => { audio.init(); audio.play('ui'); send({ type: 'start' }); };
$('btn-leave').onclick = () => {
  send({ type: 'leaveRoom' });
  $('lobby-group').hidden = true; $('lobby-home').hidden = false;
};
$('btn-copy').onclick = () => {
  const link = `${location.origin}${location.pathname}?g=${game.code}`;
  navigator.clipboard?.writeText(link).then(() => { $('btn-copy').textContent = 'Lien copié ✔'; setTimeout(() => { $('btn-copy').textContent = 'Copier le lien d\'invitation'; }, 2000); })
    .catch(() => prompt('Copie ce lien et envoie-le à tes amis :', link));
};
document.addEventListener('click', () => audio.init(), { once: true });

// ===================== HUD =====================
function updateInv() {
  $('inv-wood').textContent = me.inv.wood;
  $('inv-stone').textContent = me.inv.stone;
  if (game.build.on) renderBuildBar();
}
function updateHp() {
  $('hp-text').textContent = Math.max(0, Math.round(me.hp));
  $('hp-fill').style.width = clamp(me.hp / W.PLAYER_HP * 100, 0, 100) + '%';
  me.rig?.setHp(me.hp / W.PLAYER_HP);
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
  $('status').textContent = !conn ? 'Déconnecté' : game.solo ? 'Partie solo' : `${n} joueur${n > 1 ? 's' : ''} · Groupe ${game.code}`;
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
function flashVignette() { vignetteT = 1; }
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

// ===================== Construction =====================
const PIECE_ICONS = {
  floor: '<svg width="44" height="28" viewBox="0 0 44 28"><path d="M4 16 L22 8 L40 16 L22 24 Z" fill="#b07a46" stroke="#5a3a1a"/><path d="M4 16 L4 20 L22 28 L40 20 L40 16 L22 24 Z" fill="#7c7a76"/></svg>',
  wall: '<svg width="44" height="34" viewBox="0 0 44 34"><rect x="8" y="4" width="28" height="26" fill="#b07a46" stroke="#5a3a1a"/><path d="M8 4 L36 30 M36 4 L8 30" stroke="#6a4528" stroke-width="2"/><rect x="5" y="2" width="4" height="30" fill="#6a4528"/><rect x="35" y="2" width="4" height="30" fill="#6a4528"/></svg>',
  roof: '<svg width="44" height="28" viewBox="0 0 44 28"><path d="M3 18 L22 6 L41 18 L22 26 Z" fill="#6e6c68" stroke="#3a3836"/><path d="M8 17 L22 9 M14 20 L28 11 M20 23 L34 14" stroke="#4a4846" stroke-width="2"/></svg>',
};
function renderBuildBar() {
  const box = $('build-slots');
  box.innerHTML = '';
  W.PIECE_ORDER.forEach((type, i) => {
    const P = W.PIECES[type];
    const can = game.god.free || (me.inv.wood >= P.cost.wood && me.inv.stone >= P.cost.stone);
    const div = document.createElement('div');
    div.className = 'slot' + (i === game.build.piece ? ' sel' : '') + (can ? '' : ' cant');
    const cost = [P.cost.wood && `${P.cost.wood} bois`, P.cost.stone && `${P.cost.stone} pierre`].filter(Boolean).join(' + ');
    div.innerHTML = `<span class="key">${i + 1}</span>${PIECE_ICONS[type]}<div class="name">${P.name}</div><div class="cost">${game.god.free ? 'Gratuit (admin)' : cost}</div>`;
    box.append(div);
  });
  $('build-hint').innerHTML = `Clic gauche : poser · Clic droit : démolir (rend la moitié) · 1-3 / molette : choisir · <span class="kbd">${keyLabel(settings.keys.build)}</span> : quitter`;
}
function toggleBuild() {
  if (me.dead) return;
  game.build.on = !game.build.on;
  $('buildbar').hidden = !game.build.on;
  $('help').hidden = game.build.on;
  if (game.build.on) { renderBuildBar(); audio.play('ui'); }
  else buildings.showGhost(null);
}
function selectPiece(i) { game.build.piece = i; renderBuildBar(); audio.play('ui'); }
const _ray = new THREE.Vector3(), _rayPos = new THREE.Vector3();
function aimPoint() {
  camera.getWorldDirection(_ray);
  _rayPos.copy(camera.position);
  for (let d = 0; d < 30; d += 0.2) {
    _rayPos.addScaledVector(_ray, 0.2);
    const g = buildings.groundAt(_rayPos.x, _rayPos.z, _rayPos.y, heightAt(_rayPos.x, _rayPos.z));
    if (_rayPos.y <= g) break;
  }
  // limité à la portée de construction
  const dx = _rayPos.x - me.pos.x, dz = _rayPos.z - me.pos.z, d = Math.hypot(dx, dz);
  if (d > W.BUILD_RANGE) { _rayPos.x = me.pos.x + dx / d * W.BUILD_RANGE; _rayPos.z = me.pos.z + dz / d * W.BUILD_RANGE; }
  return _rayPos;
}
function updateBuild() {
  if (!game.build.on || game.mode) { buildings.showGhost(null); game.build.plan = null; return; }
  const type = W.PIECE_ORDER[game.build.piece];
  const plan = buildings.plan(type, aimPoint(), me.pos, nature.list, me.inv, game.god.free);
  game.build.plan = plan;
  buildings.showGhost(plan);
  $('target').style.display = plan.ok ? 'none' : 'block';
  if (!plan.ok) { $('target').querySelector('.label').textContent = plan.reason; $('target').querySelector('.bar').style.display = 'none'; }
}
function placePiece() {
  const p = game.build.plan;
  if (!p) return;
  if (!p.ok) { audio.play('ui'); return; }
  send({ type: 'build', piece: p.type, x: p.x, z: p.z, y: p.y, rot: p.rot });
  if (me.rig.attack('hammer')) send({ type: 'act', k: 'hammer' });
}
function demolishPiece() {
  const b = buildings.pick(aimPoint());
  if (b) { send({ type: 'demolish', id: b.id }); if (me.rig.attack('hammer')) send({ type: 'act', k: 'hammer' }); }
}

// ===================== Joyau =====================
function interact() {
  if (me.dead) return;
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
function tryAttack() {
  if (!me.rig || me.rig.attacking || me.dead || gem.state.carrier === me.id) return;
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  const mon = monsters.findInFront(me.pos.x, me.pos.z, fx, fz, REACH + 0.6);
  const t = mon ? null : currentTarget;
  const kind = t ? (t.kind === 'tree' ? 'chop' : 'mine') : 'slash';
  me.rig.attack(kind);
  me.attackTarget = t;
  me.attackMonster = mon;
  if (mon) me.attackDir = Math.atan2(mon.rig.root.position.x - me.pos.x, mon.rig.root.position.z - me.pos.z);
  else if (t) me.attackDir = Math.atan2(t.x - me.pos.x, t.z - me.pos.z);
  else me.attackDir = Math.atan2(fx, fz);
  send({ type: 'act', k: kind });
  if (kind === 'slash') audio.play('swing', me.pos);
}
function onToolHit() {
  const mon = me.attackMonster;
  if (mon) {
    const p = mon.rig.root.position;
    if (!mon.dead && Math.hypot(p.x - me.pos.x, p.z - me.pos.z) < REACH + 1.6) {
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
  audio.play(t.kind === 'tree' ? 'chop' : 'pick', nature.impactPoint(t, me.pos.x, me.pos.z));
  camShake = t.kind === 'rock' ? 0.12 : 0.08;
}

// ===================== Ciel, lumière, vent, musique =====================
const sunDir = new THREE.Vector3();
const lightDir = new THREE.Vector3();
const cloudOffset = new THREE.Vector2();
const sunWarm = new THREE.Color(1.0, 0.55, 0.28), sunWhite = new THREE.Color(1.0, 0.96, 0.9), moonCol = new THREE.Color(0.55, 0.65, 1.0);
const hemiDay = new THREE.Color(0xbfd8ff), hemiNight = new THREE.Color(0x2a3a66), hemiSet = new THREE.Color(0xffb38a);
const groundDay = new THREE.Color(0x5a6a3a), groundNight = new THREE.Color(0x0e1410);
const tmpCol = new THREE.Color(), tmpCol2 = new THREE.Color();
let nightAmount = 0;
const phaseSm = { day: 1, dusk: 0, night: 0 };

function updateEnvironment(dt, time, focus) {
  const t = game.clock.time;
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
    lightDir.set(-sunDir.x, -sunDir.y, -sunDir.z);
    sun.color.copy(moonCol);
    sun.intensity = 0.55 * THREE.MathUtils.smoothstep(-e, 0.02, 0.2);
  }
  hemi.color.copy(hemiNight).lerp(hemiDay, info.day).lerp(hemiSet, info.sunset * 0.35);
  hemi.groundColor.copy(groundNight).lerp(groundDay, info.day);
  hemi.intensity = 0.55 + info.day * 0.75;
  scene.fog.color.copy(info.horizon);
  sun.position.copy(focus).addScaledVector(lightDir, 70);
  sun.target.position.copy(focus);

  tmpCol.copy(sun.color).multiplyScalar(sun.intensity * 0.42 * Math.max(0, lightDir.y) + sun.intensity * 0.08);
  tmpCol2.copy(hemi.color).multiplyScalar(hemi.intensity * 0.38);
  grass.update(me.pos, focus, lightDir, tmpCol, tmpCol2, scene.fog);
  river.update(time, lightDir, tmpCol, info.horizon, scene.fog);

  // Musique : jour paisible → tension au crépuscule → horreur la nuit
  const left = W.DAY_LEN - t;
  const duskOn = !night && left < W.DUSK_WARN;
  const k = 1 - Math.exp(-dt * 0.8);
  phaseSm.day += ((!night && !duskOn ? 1 : 0) - phaseSm.day) * k;
  phaseSm.dusk += ((duskOn ? 1 : 0) - phaseSm.dusk) * k;
  phaseSm.night += ((night ? 1 : 0) - phaseSm.night) * k;
  const near = me.rig ? monsters.nearestDist(me.pos.x, me.pos.z) : Infinity;
  audio.update(dt, {
    day: phaseSm.day, dusk: phaseSm.dusk, night: phaseSm.night,
    duskK: duskOn ? 1 - left / W.DUSK_WARN : 0, wind: clamp(strength, 0, 1),
    riverDist: W.riverDist(focus.x, focus.z), danger: clamp(1 - near / 22, 0, 1),
  });
}

// ===================== Joueur =====================
const tmpV = new THREE.Vector3();
let lastGrounded = true;
function updatePlayer(dt) {
  const rig = me.rig;
  const carrying = gem.state.carrier === me.id;
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
  let speed = running ? RUN_SPEED : WALK_SPEED;
  if (rig.attacking) speed *= 0.3;
  if (carrying) speed *= 0.82;
  const terrainY = heightAt(me.pos.x, me.pos.z);
  const inWater = W.isWater(me.pos.x, me.pos.z) && me.pos.y < WATER_LEVEL;
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
  nature.collide(me.pos, PLAYER_RADIUS);
  buildings.collide(me.pos, PLAYER_RADIUS);
  me.pos.x = clamp(me.pos.x, -WORLD_LIMIT, WORLD_LIMIT);
  me.pos.z = clamp(me.pos.z, -WORLD_LIMIT, WORLD_LIMIT);

  const groundY = buildings.groundAt(me.pos.x, me.pos.z, me.pos.y, heightAt(me.pos.x, me.pos.z));
  if (canMove && pressed('jump') && me.grounded && !rig.attacking) { me.vy = JUMP_FORCE * (inWater ? 0.7 : 1); me.grounded = false; audio.play('jump', me.pos); }
  if (!me.grounded) {
    me.vy -= GRAVITY * dt;
    me.pos.y += me.vy * dt;
    if (me.pos.y <= groundY) { me.pos.y = groundY; if (me.vy < -6) audio.play('land', me.pos); me.vy = 0; me.grounded = true; }
  } else if (me.pos.y - groundY > 0.35) me.grounded = false;
  else me.pos.y = groundY;
  me.speed = Math.hypot(me.pos.x - bx, me.pos.z - bz) / Math.max(dt, 1e-4);
  lastGrounded = me.grounded;

  if (mouseHeld && isLocked() && !game.mode && !game.build.on) tryAttack();

  // Outil en main selon ce qu'on vise
  if (!rig.attacking) {
    if (game.build.on) rig.setTool('hammer');
    else if (currentMonster) rig.setTool('sword');
    else if (currentTarget) rig.setTool(currentTarget.kind === 'tree' ? 'axe' : 'pick');
    else rig.setTool('sword');
  }

  const camFacing = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
  const look = clamp(wrap(camFacing - me.ry), -0.9, 0.9) * 0.55;
  rig.root.position.copy(me.pos);
  rig.root.rotation.y = me.ry;
  if (rig.update(dt, { speed: me.speed, grounded: me.grounded, wind: wind.uWind.value.z, lookYaw: rig.attacking || me.dead ? 0 : look })) {
    if (rig.atk?.kind === 'hammer' || (!rig.atk && game.build.on)) audio.play('hammerTap', me.pos);
    else onToolHit();
  }

  // Cible sous le viseur
  const tEl = $('target'), ch = $('crosshair');
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
      tEl.querySelector('.label').textContent = currentTarget.kind === 'tree' ? 'Clic : couper l’arbre (bois)' : 'Clic : casser le rocher (pierre)';
      tEl.querySelector('.fill').style.width = (100 * currentTarget.hp / currentTarget.max) + '%';
    } else {
      ch.classList.remove('active');
      tEl.style.display = 'none';
    }
  } else ch.classList.remove('active');

  // Interaction avec le Joyau
  const pr = $('prompt');
  const K = keyLabel(settings.keys.interact);
  if (!me.dead && carrying) { pr.style.display = 'block'; pr.innerHTML = `<kbd>${K}</kbd> Poser le Joyau`; }
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
  const horiz = camDist * Math.cos(camPitch);
  camera.position.set(camTarget.x + Math.sin(camYaw) * horiz, camTarget.y + camDist * Math.sin(camPitch), camTarget.z + Math.cos(camYaw) * horiz);
  const cg = heightAt(camera.position.x, camera.position.z);
  const minY = (W.isWater(camera.position.x, camera.position.z) ? Math.max(cg, WATER_LEVEL) : cg) + 0.35;
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
    r.carrying = gem.state.carrier === id;
    r.update(dt, { speed: o.s, grounded: o.g, wind: wind.uWind.value.z });
  }
}

let lastSent = 0, lastPayload = '';
function sendPosition(now) {
  if (!me.rig || me.dead || now - lastSent < SEND_RATE) return;
  const payload = JSON.stringify({
    type: 'move', x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2),
    ry: +me.ry.toFixed(2), s: +me.speed.toFixed(1), g: me.grounded, tl: TOOLS.indexOf(me.rig.tool),
  });
  if (payload !== lastPayload) { ws?.readyState === 1 && ws.send(payload); lastPayload = payload; }
  lastSent = now;
}

function idleCamera(t) {
  camera.position.set(Math.sin(t * 0.05) * 16, 6 + Math.sin(t * 0.1), Math.cos(t * 0.05) * 16);
  camera.lookAt(0, 1.5, 0);
}

// ===================== Boucle =====================
const clock = new THREE.Clock();
let time = 0, mapT = 0, hudT = 0;
let paused = false;
const _carry = new THREE.Vector3();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) { tick(dt); renderer.render(scene, camera); }
  requestAnimationFrame(loop);
}
function tick(dt) {
  time += dt;
  if (game.started && !game.over) game.clock.time = Math.min(W.CYCLE - 0.01, game.clock.time + dt);
  else if (!game.started) game.clock.time = W.START_TIME + 60 + Math.sin(time * 0.02) * 20;
  if (me.rig && game.started) { updatePlayer(dt); updateCamera(dt); updateBuild(); } else idleCamera(time);
  updateOthers(dt);
  // Le Joyau suit celui qui le porte
  let carrierPos = null;
  const c = gem.state.carrier;
  if (c === me.id && me.rig) carrierPos = me.rig.carryPoint(_carry);
  else if (c && others.has(c)) carrierPos = others.get(c).rig.carryPoint(_carry);
  gem.update(dt, carrierPos);
  monsters.update(dt);
  buildings.update(dt);
  const focus = me.rig && game.started ? me.pos : new THREE.Vector3(0, 0, 0);
  updateEnvironment(dt, time, focus);
  nature.update(dt, time, wind.uWind.value, focus, nightAmount);
  if (game.started) {
    sendPosition(performance.now());
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.2; updateClockHud(); }
    mapT -= dt;
    if (mapT <= 0) {
      mapT = 0.1;
      worldMap.drawMini($('minimap'), mapData());
      $('minimap-n').style.transform = `translateX(-50%) rotate(0deg)`;
      if (game.mode === 'map') drawBigMap();
    }
    vignetteT = Math.max(0, vignetteT - dt * 1.5);
    const lowHp = me.hp < 30 && !me.dead ? 0.35 + Math.sin(time * 4) * 0.15 : 0;
    $('vignette').style.opacity = Math.max(vignetteT, lowHp);
  }
}
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

connect();
updateHelp();

// ===================== Outils de test (console du navigateur) =====================
window.__game = {
  me, nature, others, camera, monsters, buildings, gem, game, keys, tryAttack, send, audio,
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
  shot: (px, py, pz, tx, ty, tz) => { camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); renderer.render(scene, camera); },
  toggleMap: (tp) => toggleMap(tp),
};
