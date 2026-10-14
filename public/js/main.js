import * as THREE from 'three';
import { heightAt, createGround, WORLD_LIMIT } from './terrain.js';
import { Sky } from './sky.js';
import { Grass } from './grass.js';
import { Nature } from './nature.js';
import { CharacterRig } from './character.js';

// ===================== Réglages =====================
const WALK_SPEED = 4.2;
const RUN_SPEED = 8;
const JUMP_FORCE = 7;
const GRAVITY = 20;
const MOUSE_SENS = 0.0025;
const SEND_RATE = 1000 / 15;
const REACH = 1.7;           // portée de l'épée
const DAY_LENGTH = 1200;     // un jour complet = 20 minutes
const PLAYER_RADIUS = 0.35;

// ===================== Qualité graphique =====================
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const QUALITY = new URLSearchParams(location.search).get('q') || lsGet('rpg3d_quality') || 'high';
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
document.body.appendChild(renderer.domElement);

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

// Vent partagé par l'herbe, les arbres, la cape, les nuages…
const wind = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(1, 0, 0.6) } };

createGround(scene);
const sky = new Sky(scene);
const grass = new Grass(scene, wind, Q.grass);
const nature = new Nature(scene, wind);

// ===================== Joueur local =====================
const me = {
  id: null, rig: null, pos: new THREE.Vector3(), vy: 0, grounded: true, ry: 0, speed: 0,
  attackTarget: null, attackDir: 0,
};
let camYaw = 0, camPitch = 0.3, camDist = 6;
let camShake = 0;
const camTarget = new THREE.Vector3();

const keys = {};
let mouseHeld = false;
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseHeld = false; });

// ===================== Souris capturée =====================
const canvas = renderer.domElement;
const menu = document.getElementById('menu');
const statusEl = document.getElementById('status');
const crosshair = document.getElementById('crosshair');
const targetEl = document.getElementById('target');
let playing = false;
const isLocked = () => document.pointerLockElement === canvas;

function lockMouse() {
  const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
  if (p && p.catch) p.catch(() => canvas.requestPointerLock());
}
canvas.addEventListener('mousedown', (e) => {
  if (!playing) return;
  if (!isLocked()) { lockMouse(); return; }
  if (e.button === 0) mouseHeld = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseHeld = false; });
document.addEventListener('pointerlockchange', () => { mouseHeld = false; updateStatus(); });
addEventListener('mousemove', (e) => {
  if (!isLocked()) return;
  camYaw -= e.movementX * MOUSE_SENS;
  camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * MOUSE_SENS, -0.45, 1.25);
});
addEventListener('wheel', (e) => { camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 2.5, 14); }, { passive: true });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && playing) {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().then(lockMouse).catch(() => {});
  }
});

// ===================== Réseau =====================
const others = new Map(); // id -> { rig, target, ry, s, g }
let ws = null;

function updateStatus() {
  const n = others.size + 1;
  const conn = ws && ws.readyState === 1 ? `${n} joueur(s) en ligne` : 'Déconnecté — recharge la page (F5)';
  statusEl.textContent = (playing && !isLocked() ? 'Clique dans le jeu pour reprendre la caméra · ' : '') + conn;
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function addOther(p) {
  if (others.has(p.id)) return;
  const rig = new CharacterRig(p.color, p.name);
  rig.root.position.set(p.x, p.y, p.z);
  rig.root.rotation.y = p.ry;
  scene.add(rig.root, rig.trail.mesh);
  others.set(p.id, { rig, target: new THREE.Vector3(p.x, p.y, p.z), ry: p.ry, s: p.s || 0, g: p.g !== false });
  updateStatus();
}

function connect(name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => send({ type: 'join', name });
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    switch (d.type) {
      case 'welcome': {
        me.id = d.you.id;
        me.rig = new CharacterRig(d.you.color, d.you.name);
        me.pos.set(d.you.x, heightAt(d.you.x, d.you.z), d.you.z);
        scene.add(me.rig.root, me.rig.trail.mesh);
        camTarget.copy(me.pos);
        d.players.forEach(addOther);
        (d.dead || []).forEach((id) => nature.setDead(id));
        (d.hp || []).forEach(([id, hp]) => nature.setHp(id, hp));
        updateStatus();
        break;
      }
      case 'join': addOther(d.player); break;
      case 'move': {
        const o = others.get(d.id);
        if (o) { o.target.set(d.x, d.y, d.z); o.ry = d.ry; o.s = d.s; o.g = d.g; }
        break;
      }
      case 'act': { const o = others.get(d.id); if (o) o.rig.attack(d.k); break; }
      case 'hit':
        nature.setHp(d.id, d.hp);
        if (d.by !== me.id) nature.hit(d.id, d.fx, d.fz);
        break;
      case 'destroy': nature.destroy(d.id, d.dx, d.dz); break;
      case 'respawn': nature.respawn(d.id); break;
      case 'leave': {
        const o = others.get(d.id);
        if (o) { o.rig.dispose(scene); others.delete(d.id); }
        updateStatus();
        break;
      }
    }
  };
  ws.onclose = updateStatus;
}

let lastSent = 0, lastPayload = '';
function sendPosition(now) {
  if (!me.rig || now - lastSent < SEND_RATE) return;
  const payload = JSON.stringify({
    type: 'move', x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2),
    ry: +me.ry.toFixed(2), s: +me.speed.toFixed(1), g: me.grounded,
  });
  if (payload !== lastPayload) { send(JSON.parse(payload)); lastPayload = payload; }
  lastSent = now;
}

// ===================== Menu =====================
const nameInput = document.getElementById('name');
nameInput.value = lsGet('rpg3d_name') || '';
const qualitySel = document.getElementById('quality');
qualitySel.value = QUALITY === 'low' ? 'low' : 'high';
qualitySel.onchange = () => { lsSet('rpg3d_quality', qualitySel.value); location.reload(); };

function start() {
  const name = nameInput.value.trim() || 'Aventurier' + Math.floor(Math.random() * 1000);
  lsSet('rpg3d_name', name);
  menu.style.display = 'none';
  document.getElementById('ui').style.display = 'block';
  playing = true;
  if (document.getElementById('fs').checked) document.documentElement.requestFullscreen?.().catch(() => {}).finally(lockMouse);
  else lockMouse();
  connect(name);
}
document.getElementById('play').onclick = start;
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

// ===================== Attaque =====================
let currentTarget = null;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function tryAttack() {
  if (!me.rig || me.rig.attacking) return;
  const t = currentTarget;
  const kind = t ? (t.kind === 'tree' ? 'chop' : 'mine') : 'slash';
  me.rig.attack(kind);
  me.attackTarget = t;
  me.attackDir = t ? Math.atan2(t.x - me.pos.x, t.z - me.pos.z) : Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
  send({ type: 'act', k: kind });
}

function onSwordHit() {
  const t = me.attackTarget;
  if (!t || !t.alive) return;
  const dx = t.x - me.pos.x, dz = t.z - me.pos.z;
  if (Math.hypot(dx, dz) - t.r > REACH + 0.8) return;
  nature.hit(t.id, me.pos.x, me.pos.z);
  send({ type: 'hit', id: t.id, dx, dz });
  camShake = t.kind === 'rock' ? 0.12 : 0.08;
}

// ===================== Ciel, lumière, vent =====================
const sunDir = new THREE.Vector3();
const lightDir = new THREE.Vector3();
const cloudOffset = new THREE.Vector2();
let timeSkip = 0;
const sunWarm = new THREE.Color(1.0, 0.55, 0.28), sunWhite = new THREE.Color(1.0, 0.96, 0.9), moonCol = new THREE.Color(0.55, 0.65, 1.0);
const hemiDay = new THREE.Color(0xbfd8ff), hemiNight = new THREE.Color(0x2a3a66), hemiSet = new THREE.Color(0xffb38a);
const groundDay = new THREE.Color(0x5a6a3a), groundNight = new THREE.Color(0x0e1410);
const tmpCol = new THREE.Color(), tmpCol2 = new THREE.Color();
let nightAmount = 0;

function updateEnvironment(dt, time, focus) {
  if (keys.KeyT) timeSkip += dt * 60; // maintenir T : accélérer le temps (pour tester)
  const tod = ((Date.now() / 1000 + timeSkip) / DAY_LENGTH + 0.15) % 1;
  const a = tod * Math.PI * 2;
  sunDir.set(Math.cos(a), Math.sin(a) * 0.9 + 0.2, 0.35).normalize();

  // Vent avec rafales
  const strength = 0.6 + 0.3 * Math.sin(time * 0.11) * Math.sin(time * 0.29 + 1) + 0.1 * Math.sin(time * 0.7);
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
}

// ===================== Boucle de jeu =====================
const clock = new THREE.Clock();
const hud = document.getElementById('hud');
const tmpV = new THREE.Vector3();
let time = 0;

function updatePlayer(dt) {
  const rig = me.rig;
  let fx = 0, fz = 0;
  if (keys.KeyW || keys.ArrowUp) fz += 1;
  if (keys.KeyS || keys.ArrowDown) fz -= 1;
  if (keys.KeyA || keys.ArrowLeft) fx += 1;
  if (keys.KeyD || keys.ArrowRight) fx -= 1;
  const moving = (fx || fz) && playing;
  const running = keys.ShiftLeft || keys.ShiftRight;
  let speed = running ? RUN_SPEED : WALK_SPEED;
  if (rig.attacking) speed *= 0.3;

  const before = tmpV.copy(me.pos);
  const bx = before.x, bz = before.z;
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
  me.pos.x = THREE.MathUtils.clamp(me.pos.x, -WORLD_LIMIT, WORLD_LIMIT);
  me.pos.z = THREE.MathUtils.clamp(me.pos.z, -WORLD_LIMIT, WORLD_LIMIT);

  const groundY = heightAt(me.pos.x, me.pos.z);
  if (keys.Space && me.grounded && !rig.attacking && playing) { me.vy = JUMP_FORCE; me.grounded = false; }
  if (!me.grounded) {
    me.vy -= GRAVITY * dt;
    me.pos.y += me.vy * dt;
    if (me.pos.y <= groundY) { me.pos.y = groundY; me.vy = 0; me.grounded = true; }
  } else {
    if (me.pos.y - groundY > 0.35) me.grounded = false; // on tombe d'une pente raide
    else me.pos.y = groundY;
  }
  me.speed = Math.hypot(me.pos.x - bx, me.pos.z - bz) / Math.max(dt, 1e-4);

  if (mouseHeld && isLocked()) tryAttack();

  // Le regard suit un peu la caméra
  const camFacing = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
  const look = THREE.MathUtils.clamp(wrap(camFacing - me.ry), -0.9, 0.9) * 0.55;

  rig.root.position.copy(me.pos);
  rig.root.rotation.y = me.ry;
  if (rig.update(dt, { speed: me.speed, grounded: me.grounded, wind: wind.uWind.value.z, lookYaw: rig.attacking ? 0 : look })) onSwordHit();

  // Cible sous le viseur
  const t = rig.attacking ? null : nature.getTarget(me.pos.x, me.pos.z, -Math.sin(camYaw), -Math.cos(camYaw), REACH);
  if (!rig.attacking) currentTarget = t;
  nature.setHighlight(currentTarget && currentTarget.alive ? currentTarget : null);
  if (currentTarget && currentTarget.alive) {
    crosshair.classList.add('active');
    targetEl.style.display = 'block';
    targetEl.querySelector('.label').textContent = currentTarget.kind === 'tree' ? 'Clic : couper l’arbre' : 'Clic : casser le rocher';
    targetEl.querySelector('.fill').style.width = (100 * currentTarget.hp / currentTarget.max) + '%';
  } else {
    crosshair.classList.remove('active');
    targetEl.style.display = 'none';
  }
}

function updateCamera(dt) {
  const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
  const rightX = -fwdZ, rightZ = fwdX; // à droite de la caméra
  const want = tmpV.set(me.pos.x + rightX * 0.5, me.pos.y + 1.55, me.pos.z + rightZ * 0.5);
  camTarget.lerp(want, 1 - Math.exp(-dt * 14));
  const horiz = camDist * Math.cos(camPitch);
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * horiz,
    camTarget.y + camDist * Math.sin(camPitch),
    camTarget.z + Math.cos(camYaw) * horiz
  );
  const minY = heightAt(camera.position.x, camera.position.z) + 0.35;
  if (camera.position.y < minY) camera.position.y = minY;
  camera.lookAt(camTarget);
  if (camShake > 0) {
    camShake = Math.max(0, camShake - dt);
    camera.rotation.z += (Math.random() - 0.5) * camShake * 0.25;
    camera.position.y += (Math.random() - 0.5) * camShake * 0.3;
  }
}

function updateOthers(dt) {
  for (const o of others.values()) {
    const r = o.rig;
    r.root.position.lerp(o.target, Math.min(1, dt * 12));
    r.root.rotation.y += wrap(o.ry - r.root.rotation.y) * Math.min(1, dt * 12);
    r.update(dt, { speed: o.s, grounded: o.g, wind: wind.uWind.value.z });
  }
}

// Vue d'attente derrière le menu : la caméra tourne lentement autour du spawn
function idleCamera(t) {
  camera.position.set(Math.sin(t * 0.05) * 16, 6 + Math.sin(t * 0.1), Math.cos(t * 0.05) * 16);
  camera.lookAt(0, 1.5, 0);
}

let paused = false;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) { tick(dt); renderer.render(scene, camera); }
  requestAnimationFrame(loop);
}
function tick(dt) {
  time += dt;
  if (me.rig) { updatePlayer(dt); updateCamera(dt); } else idleCamera(time);
  updateOthers(dt);
  const focus = me.rig ? me.pos : new THREE.Vector3(0, 0, 0);
  updateEnvironment(dt, time, focus);
  nature.update(dt, time, wind.uWind.value, focus, nightAmount);
  sendPosition(performance.now());
  if (me.rig) hud.textContent = `x ${me.pos.x.toFixed(0)}  z ${me.pos.z.toFixed(0)}`;
}
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Accès pour le débogage dans la console du navigateur
window.__game = {
  me, nature, others, camera, tryAttack,
  setView: (yaw, pitch, dist) => { camYaw = yaw; camPitch = pitch; camDist = dist; },
  skipTime: (s) => { timeSkip += s; },
  // Outils de test : figer le jeu et avancer pas à pas
  pause: (v = true) => { paused = v; },
  advance: (sec, step = 1 / 30) => {
    const t0 = performance.now();
    for (let t = 0; t < sec - 1e-6; t += step) tick(step);
    const t1 = performance.now();
    renderer.render(scene, camera);
    return { simMs: t1 - t0, renderMs: performance.now() - t1 };
  },
  keys,
};
