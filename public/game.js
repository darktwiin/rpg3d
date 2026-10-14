import * as THREE from 'three';

// ===================== Réglages =====================
const WALK_SPEED = 5;
const RUN_SPEED = 9;
const JUMP_FORCE = 7;
const GRAVITY = 20;
const WORLD_LIMIT = 95;      // le joueur ne peut pas sortir de ce carré
const MOUSE_SENS = 0.0025;
const SEND_RATE = 1000 / 15; // positions envoyées 15 fois par seconde

// ===================== Scène =====================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0x87b8e8, 40, 140);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

scene.add(new THREE.HemisphereLight(0xdff1ff, 0x4a6b3a, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
scene.add(sun, sun.target);

// Sol
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x5f9e45 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Quelques repères visuels (arbres, rochers) — même placement pour tout le monde
function seededRandom(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}
const rand = seededRandom(42);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2a });
const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, flatShading: true });
for (let i = 0; i < 120; i++) {
  const x = (rand() - 0.5) * 180, z = (rand() - 0.5) * 180;
  if (Math.hypot(x, z) < 8) continue; // zone de départ dégagée
  if (rand() < 0.7) {
    const tree = new THREE.Group();
    const h = 2 + rand() * 2;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, h), trunkMat);
    trunk.position.y = h / 2;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 8), leafMat);
    leaves.position.y = h + 1.2;
    trunk.castShadow = leaves.castShadow = true;
    tree.add(trunk, leaves);
    tree.position.set(x, 0, z);
    scene.add(tree);
  } else {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + rand() * 1.2), rockMat);
    rock.position.set(x, 0.3, z);
    rock.rotation.set(rand() * 3, rand() * 3, 0);
    rock.castShadow = true;
    scene.add(rock);
  }
}

// ===================== Personnage =====================
function makeNameTag(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, 128, 42);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 42);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sprite.scale.set(2, 0.5, 1);
  sprite.position.y = 2.4;
  return sprite;
}

function makeCharacter(color, name) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0c8a0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x333344 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), mat);
  body.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), skin);
  head.position.y = 1.78;
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.05), dark);
  eyes.position.set(0, 1.82, 0.25); // l'avant du personnage = +Z

  // Bras et jambes accrochés par le haut pour pouvoir les balancer
  const limb = (w, h, m, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), m);
    mesh.position.y = -h / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    g.add(pivot);
    return pivot;
  };
  const armL = limb(0.18, 0.7, mat, -0.45, 1.45);
  const armR = limb(0.18, 0.7, mat, 0.45, 1.45);
  const legL = limb(0.22, 0.7, dark, -0.17, 0.7);
  const legR = limb(0.22, 0.7, dark, 0.17, 0.7);

  body.castShadow = head.castShadow = true;
  g.add(body, head, eyes, makeNameTag(name));
  g.userData = { armL, armR, legL, legR, phase: 0 };
  return g;
}

function animateCharacter(char, anim, dt, airborne) {
  const u = char.userData;
  const speed = anim === 'run' ? 14 : anim === 'walk' ? 9 : 0;
  let swing = 0;
  if (speed > 0 && !airborne) {
    u.phase += dt * speed;
    swing = Math.sin(u.phase) * (anim === 'run' ? 0.9 : 0.6);
  } else {
    u.phase = 0;
  }
  const target = airborne ? -0.5 : 0;
  u.legL.rotation.x = THREE.MathUtils.lerp(u.legL.rotation.x, airborne ? 0.4 : swing, 0.3);
  u.legR.rotation.x = THREE.MathUtils.lerp(u.legR.rotation.x, airborne ? -0.3 : -swing, 0.3);
  u.armL.rotation.x = THREE.MathUtils.lerp(u.armL.rotation.x, airborne ? target * 4 : -swing, 0.3);
  u.armR.rotation.x = THREE.MathUtils.lerp(u.armR.rotation.x, airborne ? target * 4 : swing, 0.3);
}

// ===================== Joueur local =====================
const me = { id: null, char: null, vel: new THREE.Vector3(), onGround: true, anim: 'idle' };
let camYaw = 0, camPitch = 0.35, camDist = 7;

const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ===================== Souris capturée (Pointer Lock) =====================
// Quand la souris est "verrouillée", le curseur disparaît et ne peut plus sortir
// de la fenêtre : on reçoit seulement ses mouvements pour tourner la caméra.
const canvas = renderer.domElement;
const menu = document.getElementById('menu');
const status = document.getElementById('status');
let playing = false;

function lockMouse() {
  canvas.requestPointerLock?.({ unadjustedMovement: true })?.catch?.(() => canvas.requestPointerLock());
}
canvas.addEventListener('click', () => { if (playing && document.pointerLockElement !== canvas) lockMouse(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  status.dataset.lock = locked ? '' : 'Clique dans le jeu pour reprendre la caméra · ';
  updateStatus();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  camYaw -= e.movementX * MOUSE_SENS;
  camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * MOUSE_SENS, -0.3, 1.3);
});
addEventListener('wheel', (e) => {
  camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 3, 15);
}, { passive: true });

// Touche F : basculer le plein écran
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && playing) {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().then(lockMouse).catch(() => {});
  }
});

// ===================== Réseau =====================
const others = new Map(); // id -> { char, target, ry, anim }
let ws = null;
let playerCount = 1;

function updateStatus() {
  const conn = ws && ws.readyState === 1 ? `${playerCount} joueur(s) en ligne` : 'Déconnecté';
  status.textContent = (status.dataset.lock || '') + conn;
}

function addOther(p) {
  if (others.has(p.id)) return;
  const char = makeCharacter(p.color, p.name);
  char.position.set(p.x, p.y, p.z);
  char.rotation.y = p.ry;
  scene.add(char);
  others.set(p.id, { char, target: new THREE.Vector3(p.x, p.y, p.z), ry: p.ry, anim: p.anim });
  playerCount = others.size + 1; updateStatus();
}

function connect(name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', name }));
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === 'welcome') {
      me.id = d.you.id;
      me.char = makeCharacter(d.you.color, d.you.name);
      me.char.position.set(d.you.x, 0, d.you.z);
      scene.add(me.char);
      d.players.forEach(addOther);
      playerCount = others.size + 1; updateStatus();
    } else if (d.type === 'join') {
      addOther(d.player);
    } else if (d.type === 'move') {
      const o = others.get(d.id);
      if (o) { o.target.set(d.x, d.y, d.z); o.ry = d.ry; o.anim = d.anim; }
    } else if (d.type === 'leave') {
      const o = others.get(d.id);
      if (o) { scene.remove(o.char); others.delete(d.id); }
      playerCount = others.size + 1; updateStatus();
    }
  };
  ws.onclose = () => { updateStatus(); status.textContent += ' — recharge la page (F5)'; };
}

let lastSent = 0, lastPayload = '';
function sendPosition(now) {
  if (!ws || ws.readyState !== 1 || !me.char || now - lastSent < SEND_RATE) return;
  const p = me.char.position;
  const payload = JSON.stringify({
    type: 'move',
    x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
    ry: +me.char.rotation.y.toFixed(2), anim: me.anim
  });
  if (payload !== lastPayload) { ws.send(payload); lastPayload = payload; }
  lastSent = now;
}

// ===================== Menu =====================
const nameInput = document.getElementById('name');
nameInput.value = localStorageGet('rpg3d_name') || '';
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

function start() {
  const name = nameInput.value.trim() || 'Aventurier' + Math.floor(Math.random() * 1000);
  localStorageSet('rpg3d_name', name);
  menu.style.display = 'none';
  playing = true;
  if (document.getElementById('fs').checked) {
    document.documentElement.requestFullscreen?.().catch(() => {}).finally(lockMouse);
  } else {
    lockMouse();
  }
  connect(name);
}
document.getElementById('play').onclick = start;
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

// ===================== Boucle de jeu =====================
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();
const hud = document.getElementById('hud');

function update(dt) {
  if (!me.char) return;
  const c = me.char;

  // Direction voulue, relative à la caméra (KeyW = Z sur clavier AZERTY, etc.)
  let fx = 0, fz = 0;
  if (keys.KeyW || keys.ArrowUp) fz += 1;
  if (keys.KeyS || keys.ArrowDown) fz -= 1;
  if (keys.KeyA || keys.ArrowLeft) fx += 1;
  if (keys.KeyD || keys.ArrowRight) fx -= 1;

  const moving = fx !== 0 || fz !== 0;
  const running = keys.ShiftLeft || keys.ShiftRight;
  const speed = running ? RUN_SPEED : WALK_SPEED;

  if (moving) {
    const len = Math.hypot(fx, fz);
    fx /= len; fz /= len;
    // Avant de la caméra = direction vers laquelle elle regarde (sur le sol)
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const dx = fz * -sin + fx * -cos;
    const dz = fz * -cos + fx * sin;
    c.position.x += dx * speed * dt;
    c.position.z += dz * speed * dt;
    // Le personnage se tourne doucement vers sa direction de marche
    const targetRy = Math.atan2(dx, dz);
    let diff = targetRy - c.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.rotation.y += diff * Math.min(1, dt * 12);
  }

  // Saut + gravité
  if (keys.Space && me.onGround) { me.vel.y = JUMP_FORCE; me.onGround = false; }
  me.vel.y -= GRAVITY * dt;
  c.position.y += me.vel.y * dt;
  if (c.position.y <= 0) { c.position.y = 0; me.vel.y = 0; me.onGround = true; }

  c.position.x = THREE.MathUtils.clamp(c.position.x, -WORLD_LIMIT, WORLD_LIMIT);
  c.position.z = THREE.MathUtils.clamp(c.position.z, -WORLD_LIMIT, WORLD_LIMIT);

  me.anim = moving ? (running ? 'run' : 'walk') : 'idle';
  animateCharacter(c, me.anim, dt, !me.onGround);

  // Caméra 3ème personne : en orbite derrière le personnage
  camTarget.lerp(new THREE.Vector3(c.position.x, c.position.y + 1.6, c.position.z), 0.25);
  const horiz = camDist * Math.cos(camPitch);
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * horiz,
    Math.max(0.3, camTarget.y + camDist * Math.sin(camPitch)),
    camTarget.z + Math.cos(camYaw) * horiz
  );
  camera.lookAt(camTarget);

  // L'ombre du soleil suit le joueur
  sun.position.set(c.position.x + 30, 50, c.position.z + 20);
  sun.target.position.copy(c.position);

  hud.textContent = `x ${c.position.x.toFixed(1)}  z ${c.position.z.toFixed(1)}`;
}

function updateOthers(dt) {
  for (const o of others.values()) {
    const ch = o.char;
    ch.position.lerp(o.target, Math.min(1, dt * 12));
    let diff = o.ry - ch.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    ch.rotation.y += diff * Math.min(1, dt * 12);
    animateCharacter(ch, o.anim, dt, ch.position.y > 0.05);
  }
}

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  updateOthers(dt);
  sendPosition(performance.now());
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
// Vue d'attente derrière le menu
camera.position.set(10, 6, 10);
camera.lookAt(0, 1, 0);
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
