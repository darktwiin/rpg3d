// Le village : lobby jouable. Place centrale avec le portail (lancer une partie),
// la forge (compétences), le piédestal du classement, des maisons et des arbres.
import * as THREE from 'three';
import { plankTexture, stoneTexture, shingleTexture } from './buildings.js';
import { Particles } from './nature.js';
import { noise3 } from './world.js';
import { decorateVillage, Blacksmith, LINES_ARMORY, LINES_SANCTUM } from './villageDecor.js';
import { buildMedieval, roadDist } from './villageMedieval.js';
import { KK, prop } from './models.js';

export const VILLAGE_RADIUS = 32.6;   // on reste dans les remparts (grilles aux portes)
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Relief du village : plat au centre, collines tout autour
export function villageHeight(x, z) {
  const r = Math.hypot(x, z);
  return ss(36, 62, r) * (7 + Math.sin(x * 0.11) * 2 + Math.cos(z * 0.09) * 2);
}
export const VILLAGE_GLSL = /* glsl */`
float villageHeight(vec2 p) {
  float r = length(p);
  return smoothstep(36.0, 62.0, r) * (7.0 + sin(p.x * 0.11) * 2.0 + cos(p.y * 0.09) * 2.0);
}`;

export const SPOTS = {
  portal: { x: 0, z: 0, r: 4.2 },
  forge: { x: -15, z: 3, r: 4.2 },
  board: { x: 15, z: 3, r: 4.2 },
  armory: { x: -11, z: -11.5, r: 4.2 },    // Barbare : changement de classe
  sanctum: { x: 11, z: -11.5, r: 4.2 },    // Gardien de maîtrise (Rogue encapuchonné) : compétences
};
export const SPAWN = { x: 0, z: 9 };

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 4;
  return t;
}
// Tomettes en terre cuite (place du portail) : une seule grande texture posée sans répétition,
// chaque carreau a sa teinte, ses taches et ses joints irréguliers → aucun motif reconnaissable
function cobbleTexture() {
  return canvasTex(2048, 2048, (ctx, w) => {
    ctx.fillStyle = '#7d6a5c'; ctx.fillRect(0, 0, w, w);   // joints
    const n = 30, c = w / n;
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      // carreaux légèrement de travers et de tailles inégales, rangées décalées par endroits
      const off = (gy % 2) * (Math.random() < 0.3 ? c * 0.5 : 0);
      const x = gx * c + off + (Math.random() - 0.5) * 3, y = gy * c + (Math.random() - 0.5) * 3;
      const sw = c - 3 - Math.random() * 3, sh = c - 3 - Math.random() * 3;
      const h = 12 + Math.random() * 16, l = 52 + Math.random() * 16, sat = 18 + Math.random() * 20;
      ctx.save();
      ctx.translate(x + sw / 2, y + sh / 2); ctx.rotate((Math.random() - 0.5) * 0.05);
      ctx.fillStyle = `hsl(${h},${sat}%,${l}%)`;
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
      // usure : taches claires et sombres, petits trous
      for (let k = 0; k < 14; k++) {
        ctx.fillStyle = Math.random() < 0.5 ? `rgba(240,225,205,${Math.random() * 0.18})` : `rgba(90,60,40,${Math.random() * 0.12})`;
        ctx.beginPath(); ctx.ellipse((Math.random() - 0.5) * sw, (Math.random() - 0.5) * sh, 2 + Math.random() * sw * 0.35, 2 + Math.random() * sh * 0.25, Math.random() * 3, 0, Math.PI * 2); ctx.fill();
      }
      for (let k = Math.random() * 6 | 0; k > 0; k--) { ctx.fillStyle = 'rgba(40,20,10,0.5)'; ctx.beginPath(); ctx.arc((Math.random() - 0.5) * sw * 0.8, (Math.random() - 0.5) * sh * 0.8, 0.8 + Math.random() * 1.5, 0, Math.PI * 2); ctx.fill(); }
      // bords un peu plus sombres
      ctx.strokeStyle = 'rgba(50,25,12,0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }
  }, [1, 1]);
}
function textSprite(text, color = '#f0c96a', scale = 1) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  let fs = 64;
  do ctx.font = `bold ${fs}px Georgia, serif`; while (ctx.measureText(text).width > 480 && (fs -= 4) > 24);
  ctx.textAlign = 'center';
  ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 256, 84);
  ctx.fillStyle = color; ctx.fillText(text, 256, 84);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(4 * scale, 1 * scale, 1);
  return s;
}

// Tourbillon du portail
const portalVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const portalFrag = `
uniform float uTime; uniform float uPower; varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float sw = sin(a * 5.0 + r * 12.0 - uTime * 3.0) * 0.5 + 0.5;
  float sw2 = sin(a * 3.0 - r * 8.0 + uTime * 2.0) * 0.5 + 0.5;
  vec3 c = mix(vec3(0.25, 0.05, 0.6), vec3(0.75, 0.45, 1.0), sw * 0.7 + sw2 * 0.3);
  c += vec3(1.0, 0.9, 1.0) * pow(1.0 - r, 3.0) * (1.2 + uPower);
  float edge = smoothstep(1.0, 0.85, r);
  gl_FragColor = vec4(c * (0.8 + uPower * 0.6), edge * 0.92);
}`;

export class Village {
  constructor(scene, nature) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.fx = new Particles(this.root);
    this.fx.groundFn = villageHeight;
    this.colliders = [];   // cercles {x, z, r}
    this.platforms = [];   // zones surélevées {x, z, r, h}
    this.time = 0;
    this.lights = [];
    const planks = plankTexture(), stone = stoneTexture(), shingles = shingleTexture();
    const M = {
      planks: new THREE.MeshStandardMaterial({ map: planks, roughness: 0.85 }),
      planksDark: new THREE.MeshStandardMaterial({ map: planks, color: '#9a7656', roughness: 0.9 }),
      log: new THREE.MeshStandardMaterial({ color: '#5e3d22', roughness: 0.9 }),
      stone: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 }),
      stoneLight: new THREE.MeshStandardMaterial({ map: stone, color: '#dcd6cc', roughness: 0.95 }),
      shingles: new THREE.MeshStandardMaterial({ map: shingles, color: '#b0786a', roughness: 0.9 }),
      plaster: new THREE.MeshStandardMaterial({ color: '#e8dcc4', roughness: 0.95 }),
      window: new THREE.MeshStandardMaterial({ color: '#ffcf7a', emissive: '#ffa640', emissiveIntensity: 0.9 }),
      iron: new THREE.MeshStandardMaterial({ color: '#3d4045', metalness: 0.7, roughness: 0.4 }),
      rune: new THREE.MeshStandardMaterial({ color: '#c9a2ff', emissive: '#9a5aff', emissiveIntensity: 1.4 }),
      fire: new THREE.MeshBasicMaterial({ color: '#ffb040' }),
    };
    this.M = M;
    const add = (parent, geo, mat, x, y, z, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.y = ry;
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    this.add = add;

    // ---------------- Sol ----------------
    const geo = new THREE.CircleGeometry(95, 96, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    // plus de détails près du centre
    const g2 = new THREE.PlaneGeometry(190, 190, 160, 160);
    g2.rotateX(-Math.PI / 2);
    const pos = g2.attributes.position;
    const col = new Float32Array(pos.count * 3), c = new THREE.Color();
    const grassA = new THREE.Color('#4f8f2e'), grassB = new THREE.Color('#72a63a'), dirt = new THREE.Color('#8a6e4c');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, villageHeight(x, z));
      const n = noise3(x * 0.1, z * 0.1, 3) * 0.5 + 0.5;
      c.copy(grassA).lerp(grassB, n);
      const pd = this.pathDist(x, z);
      if (pd < 2.2) c.lerp(dirt, ss(2.2, 1.0, pd));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g2.computeVertexNormals();
    const ground = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    ground.receiveShadow = true;
    this.root.add(ground);
    geo.dispose();

    // Place pavée
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(9.5, 64), new THREE.MeshStandardMaterial({ map: cobbleTexture(), roughness: 0.95 }));
    plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02;
    plaza.receiveShadow = true;
    this.root.add(plaza);
    const curb = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.18, 6, 64), M.stone);
    curb.rotation.x = Math.PI / 2; curb.position.y = 0.04;
    this.root.add(curb);

    this.buildPortal(M);
    this.buildForge(M);
    this.buildWorkshops(M);
    this.buildBoard(M);
    buildMedieval(this, villageHeight);   // maisons, quartier extérieur, château, grilles
    this.buildLanterns(M);
    this.buildTrees(nature);
    // décor KayKit (remparts, bannières, tonneaux, étals…) et le forgeron
    decorateVillage(this, SPOTS, villageHeight);
    this.smith = new Blacksmith(this, new THREE.Vector3(1.1, 0.25, -0.75), 0);   // derrière l'enclume
    this.npcs = [
      new Blacksmith(this, new THREE.Vector3(0, 0.25, -1.2), 0, { group: this.armoryGroup, model: 'Barbarian', tool: 't_axe', lines: LINES_ARMORY }),
      new Blacksmith(this, new THREE.Vector3(0, 0.25, -1.2), 0, { group: this.sanctumGroup, model: 'Rogue_Hooded', tool: null, lines: LINES_SANCTUM }),
    ];

    // Panneaux au-dessus des lieux
    const sign = (t, x, y, z, col) => { const s = textSprite(t, col, 0.8); s.position.set(x, y, z); this.root.add(s); };
    sign('Portail', 0, 5.4, 0, '#d8b8ff');
    sign('Forge', SPOTS.forge.x, 5.6, SPOTS.forge.z, '#ffb070');
    sign('Classement', SPOTS.board.x, 5.6, SPOTS.board.z, '#f0c96a');
    sign('Salle d’armes', SPOTS.armory.x, 5.6, SPOTS.armory.z, '#ff9070');
    sign('Maîtrise', SPOTS.sanctum.x, 5.6, SPOTS.sanctum.z, '#c0a8ff');
  }

  pathDist(x, z) {
    // chemins de terre : vers le sud (arrivée), le nord, et le tour des maisons
    const dSouth = Math.abs(x) + Math.max(0, -z) * 10;
    const dNorth = Math.abs(x) + Math.max(0, z) * 10;
    const ring = Math.abs(Math.hypot(x, z) - 20);
    return Math.min(dSouth, dNorth, ring, roadDist(x, z));   // + routes hors remparts
  }

  // ---------------- Portail ----------------
  buildPortal(M) {
    const g = new THREE.Group();
    this.root.add(g);
    // estrade à deux marches
    this.add(g, new THREE.CylinderGeometry(3.3, 3.5, 0.25, 32), M.stoneLight, 0, 0.12, 0);
    this.add(g, new THREE.CylinderGeometry(2.5, 2.6, 0.25, 32), M.stoneLight, 0, 0.37, 0);
    this.platforms.push({ x: 0, z: 0, r: 3.4, h: 0.25 }, { x: 0, z: 0, r: 2.55, h: 0.5 });
    // anneau de pierre debout
    const ring = this.add(g, new THREE.TorusGeometry(1.7, 0.26, 12, 40), M.stone, 0, 2.35, 0);
    ring.rotation.y = Math.PI / 2 * 0;
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const rune = this.add(g, new THREE.BoxGeometry(0.16, 0.22, 0.56), M.rune, Math.cos(a) * 1.7, 2.35 + Math.sin(a) * 1.7, 0);
      rune.rotation.z = a;
    }
    for (const sx of [-1, 1]) this.add(g, new THREE.BoxGeometry(0.6, 0.9, 0.7), M.stone, sx * 1.3, 0.9, 0);
    this.portalUniforms = { uTime: { value: 0 }, uPower: { value: 0 } };
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 48), new THREE.ShaderMaterial({
      vertexShader: portalVert, fragmentShader: portalFrag, uniforms: this.portalUniforms, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    disc.position.set(0, 2.35, 0);
    g.add(disc);
    // 4 obélisques avec cristaux
    this.crystals = [];
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + Math.PI / 4, r = 5.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      this.add(g, new THREE.CylinderGeometry(0.25, 0.4, 1.6, 6), M.stone, x, 0.8, z);
      const cr = this.add(g, new THREE.OctahedronGeometry(0.28, 0).scale(1, 1.7, 1), M.rune, x, 2.0, z);
      this.crystals.push(cr);
      this.colliders.push({ x, z, r: 0.5 });
    }
    this.colliders.push({ x: 0, z: 0, r: 1.25, minY: 0.4 });
    this.portalLight = new THREE.PointLight(0xa070ff, 8, 16, 1.6);
    this.portalLight.position.set(0, 2.4, 0.5);
    g.add(this.portalLight);
    this.portal = g;
  }

  // ---------------- Forge ----------------
  // Abri ouvert vers la place (sol, 4 poteaux, toit, mur du fond) : forge et ateliers des PNJ
  stallShell(M, spot, ry, roofMat = M.shingles, posts = true) {
    const g = new THREE.Group();
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = ry;
    this.root.add(g);
    this.add(g, new THREE.BoxGeometry(6, 0.25, 4.6), M.stone, 0, 0.12, -0.6);
    if (posts) for (const [px, pz] of [[-2.8, 1.4], [2.8, 1.4], [-2.8, -2.6], [2.8, -2.6]]) this.add(g, new THREE.CylinderGeometry(0.15, 0.17, 3.4, 8), M.log, px, 1.7, pz);
    const roof = this.add(g, new THREE.BoxGeometry(6.6, 0.16, 5.2), roofMat, 0, 3.55, -0.6);
    roof.rotation.x = -0.18;
    this.add(g, new THREE.BoxGeometry(6.2, 2.4, 0.3), M.planksDark, 0, 1.45, -2.75);
    g.updateMatrixWorld(true);
    for (const [px, pz] of [[-2.8, 1.4], [2.8, 1.4], [-2.8, -2.6], [2.8, -2.6]]) {
      const w = g.localToWorld(new THREE.Vector3(px, 0, pz));
      this.colliders.push({ x: w.x, z: w.z, r: 0.25 });
    }
    return g;
  }
  // Ateliers des deux PNJ : même abri que la forge, identité propre (couleur du toit, lumière)
  buildWorkshops(M) {
    const face = (s) => Math.atan2(-s.x, -s.z);   // ouverts vers le portail
    const mk = (spot, col, roofCol) => {
      const g = this.stallShell(M, spot, face(spot), new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.9 }), false);
      // colonnes de pierre sculptées aux 4 coins, poutre de façade, murets latéraux et marche d'entrée
      for (const [px, pz] of [[-2.8, 1.4], [2.8, 1.4], [-2.8, -2.6], [2.8, -2.6]]) {
        const c = prop('d_pillar_decorated', 1);
        const b = new THREE.Box3().setFromObject(c), h = b.max.y - b.min.y;
        c.scale.multiplyScalar(3.35 / h);
        c.position.set(px, 0.25, pz);
        g.add(c);
      }
      this.add(g, new THREE.BoxGeometry(6.2, 0.3, 0.3), M.log, 0, 3.3, 1.4);
      this.add(g, new THREE.BoxGeometry(6.2, 0.3, 0.3), M.log, 0, 3.3, -2.6);
      for (const sx of [-1, 1]) this.add(g, new THREE.BoxGeometry(0.3, 1.0, 3.4), M.stone, sx * 2.85, 0.75, -0.75);
      this.add(g, new THREE.BoxGeometry(3.2, 0.14, 0.7), M.stone, 0, 0.07, 1.95);
      const l = new THREE.PointLight(col, 4, 8, 1.5);
      l.position.set(0, 2.6, -1.2);
      g.add(l);
      for (let i = -3; i <= 3; i++) { const w = g.localToWorld(new THREE.Vector3(i, 0, -2.75)); this.colliders.push({ x: w.x, z: w.z, r: 0.4 }); }
      const c = g.localToWorld(new THREE.Vector3(0, 0, -0.6));
      this.platforms.push({ x: c.x, z: c.z, r: 2.6, h: 0.25 });
      return g;
    };
    this.armoryGroup = mk(SPOTS.armory, 0xff5030, '#8a2a20');    // salle d'armes : rouge
    this.sanctumGroup = mk(SPOTS.sanctum, 0x8a6aff, '#3a3060');  // sanctuaire : violet
  }

  buildForge(M) {
    const { x, z } = SPOTS.forge;
    const g = this.stallShell(M, SPOTS.forge, Math.PI / 2);   // ouverte vers la place
    // fourneau
    this.add(g, new THREE.BoxGeometry(2, 1.8, 1.5), M.stone, -1.6, 0.9, -1.8);
    const mouth = this.add(g, new THREE.BoxGeometry(0.9, 0.6, 0.1), M.fire, -1.6, 0.8, -1.03);
    mouth.castShadow = false;
    this.add(g, new THREE.BoxGeometry(0.8, 3.6, 0.8), M.stone, -1.6, 3.4, -2.1);
    this.chimneyTop = new THREE.Vector3();
    this.chimneyLocal = new THREE.Vector3(-1.6, 5.3, -2.1);
    // (enclume, meule, établi et outils : voir villageDecor.js)
    this.forgeLight = new THREE.PointLight(0xff8a30, 6, 9, 1.5);
    this.forgeLight.position.set(-1.6, 1.0, -0.6);
    g.add(this.forgeLight);
    g.updateMatrixWorld(true);
    this.anvilPos = g.localToWorld(new THREE.Vector3(1.1, 0.9, 0));
    this.forgeGroup = g;
    this.colliders.push({ x: x - 1.8, z: z + 1.6, r: 1.4 });
    // mur du fond
    for (let i = -3; i <= 3; i++) { const w = g.localToWorld(new THREE.Vector3(i, 0, -2.75)); this.colliders.push({ x: w.x, z: w.z, r: 0.4 }); }
    this.platforms.push({ x: x - 0.6, z, r: 3.2, h: 0.25, box: { hx: 2.3, hz: 3 } });
  }

  // ---------------- Piédestal du classement ----------------
  buildBoard(M) {
    const { x, z } = SPOTS.board;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = -Math.PI / 2;  // face à la place
    this.root.add(g);
    this.add(g, new THREE.CylinderGeometry(1.7, 1.9, 0.3, 8), M.stoneLight, 0, 0.15, 0);
    this.add(g, new THREE.CylinderGeometry(1.2, 1.4, 0.3, 8), M.stoneLight, 0, 0.45, 0);
    this.platforms.push({ x, z, r: 1.8, h: 0.3 }, { x, z, r: 1.3, h: 0.6 });
    this.add(g, new THREE.BoxGeometry(0.5, 1.6, 0.5), M.stone, 0, 1.4, 0);
    this.add(g, new THREE.BoxGeometry(3.6, 2.6, 0.3), M.stone, 0, 3.2, -0.1);
    this.add(g, new THREE.BoxGeometry(3.9, 0.25, 0.45), M.stoneLight, 0, 4.55, -0.1);
    const c = document.createElement('canvas');
    c.width = 768; c.height = 560;
    this.boardCanvas = c;
    this.boardTex = new THREE.CanvasTexture(c);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.boardTex.anisotropy = 4;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.4), new THREE.MeshBasicMaterial({ map: this.boardTex }));
    face.position.set(0, 3.2, 0.06);
    g.add(face);
    this.colliders.push({ x, z, r: 1.0 });
    this.drawBoard({ 1: [], 2: [], 3: [], 4: [] });
  }

  drawBoard(board) {
    const ctx = this.boardCanvas.getContext('2d');
    const W = 768, H = 560;
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#2b2418'); grd.addColorStop(1, '#16120c');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#c9a050'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.fillStyle = '#f0c96a'; ctx.font = 'bold 48px Georgia'; ctx.textAlign = 'center';
    ctx.fillText('Classement', W / 2, 66);
    const titles = { 1: 'Solo', 2: 'Duo', 3: 'Trio', 4: 'Équipe de 4' };
    for (let k = 1; k <= 4; k++) {
      const cx = k % 2 ? 30 : W / 2 + 10, cy = k <= 2 ? 100 : 320;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e8b86a'; ctx.font = 'bold 32px Georgia';
      ctx.fillText(titles[k], cx, cy + 30);
      const list = board[k] || [];
      ctx.font = '24px system-ui, sans-serif';
      for (let i = 0; i < 3; i++) {
        const e = list[i];
        ctx.fillStyle = ['#ffd700', '#d0d0d8', '#d08a50'][i];
        ctx.fillText(`${i + 1}.`, cx, cy + 70 + i * 40);
        ctx.fillStyle = e ? '#f2ead8' : '#776a55';
        let names = e ? e.names.join(', ') : '—';
        while (ctx.measureText(names).width > 250 && names.length > 4) names = names.slice(0, -2);
        if (e && names !== e.names.join(', ')) names += '…';
        ctx.fillText(names, cx + 34, cy + 70 + i * 40);
        if (e) { ctx.fillStyle = '#c49bff'; ctx.textAlign = 'right'; ctx.fillText(`${e.nights} nuit${e.nights > 1 ? 's' : ''}`, cx + 336, cy + 70 + i * 40); ctx.textAlign = 'left'; }
      }
    }
    this.boardTex.needsUpdate = true;
  }

  // ---------------- Maisons ----------------
  buildHouses(M) {
    const spots = [[-26, -12], [-10, -27], [10, -27], [26, -12], [-27, 14], [27, 14], [-12, 27], [12, 27]];
    this.houseSpots = [];
    spots.forEach(([x, z], i) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = Math.atan2(-x, -z);  // la porte regarde la place
      this.root.add(g);
      const w = 4.4 + (i % 3) * 0.6, d = 4, h = 2.6;
      this.houseSpots.push([x, z, w, d, g.rotation.y]);
      this.add(g, new THREE.BoxGeometry(w + 0.3, 0.5, d + 0.3), M.stone, 0, 0.25, 0);
      this.add(g, new THREE.BoxGeometry(w, h, d), i % 2 ? M.plaster : M.planks, 0, 0.5 + h / 2, 0);
      // colombages
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.add(g, new THREE.BoxGeometry(0.2, h, 0.2), M.log, sx * w / 2, 0.5 + h / 2, sz * d / 2);
      this.add(g, new THREE.BoxGeometry(w + 0.1, 0.18, d + 0.1), M.log, 0, 0.5 + h, 0);
      // toit à deux pans
      const rh = 1.7, slope = Math.hypot(d / 2 + 0.4, rh);
      for (const s of [-1, 1]) {
        const pan = this.add(g, new THREE.BoxGeometry(w + 0.8, 0.14, slope), M.shingles, 0, 0.5 + h + rh / 2, s * (d / 4 + 0.1));
        pan.rotation.x = s * Math.atan2(rh, d / 2 + 0.4);
      }
      const gable = new THREE.Shape();
      gable.moveTo(-d / 2, 0); gable.lineTo(d / 2, 0); gable.lineTo(0, rh); gable.closePath();
      const gg = new THREE.ExtrudeGeometry(gable, { depth: w - 0.02, bevelEnabled: false });
      gg.translate(0, 0, -(w - 0.02) / 2);
      gg.rotateY(Math.PI / 2);
      this.add(g, gg, i % 2 ? M.plaster : M.planks, 0, 0.5 + h, 0);
      // porte, fenêtres, cheminée
      this.add(g, new THREE.BoxGeometry(0.9, 1.7, 0.1), M.planksDark, 0, 1.35, d / 2 + 0.03);
      for (const sx of [-1, 1]) {
        this.add(g, new THREE.BoxGeometry(0.7, 0.6, 0.08), M.window, sx * w * 0.3, 1.9, d / 2 + 0.03);
        this.add(g, new THREE.BoxGeometry(0.08, 0.6, 0.12), M.log, sx * w * 0.3, 1.9, d / 2 + 0.05);
      }
      this.add(g, new THREE.BoxGeometry(0.6, 1.8, 0.6), M.stone, w * 0.3, 0.5 + h + 1.2, -d * 0.2);
      this.colliders.push({ x, z, r: Math.max(w, d) / 2 + 0.4 });
    });
  }

  buildLanterns(M) {
    const glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,220,150,1)'); g.addColorStop(0.3, 'rgba(255,170,70,0.45)'); g.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.glows = [];
    // angles (degrés) choisis pour éviter la forge, le classement, la salle d'armes et le sanctuaire
    for (const deg of [78, 102, 150, 258, 282]) {
      const a = deg * Math.PI / 180, r = 21.8;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = villageHeight(x, z);
      this.add(this.root, new THREE.CylinderGeometry(0.07, 0.1, 2.8, 8), M.log, x, y + 1.4, z);
      // potence tournée vers le chemin, la lanterne pend dessous
      const ix = -Math.cos(a), iz = -Math.sin(a);
      this.add(this.root, new THREE.BoxGeometry(0.08, 0.08, 0.7), M.log, x + ix * 0.3, y + 2.75, z + iz * 0.3).rotation.y = Math.atan2(ix, iz);
      const lan = prop('t_lantern', KK * 1.2);
      lan.position.set(x + ix * 0.55, y + 2.05, z + iz * 0.55);
      this.root.add(lan);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.position.set(x + ix * 0.55, y + 2.3, z + iz * 0.55); s.scale.setScalar(1.8);
      this.root.add(s);
      this.glows.push(s);
      this.colliders.push({ x, z, r: 0.2 });
    }
  }

  buildTrees(nature) {
    const rand = (() => { let s = 77; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
    for (let i = 0; i < 70; i++) {
      const a = rand() * Math.PI * 2, r = 37 + rand() * 28;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 5) continue;  // garder les portes dégagées
      if (this.noTree?.some((n) => Math.hypot(n.x - x, n.z - z) < n.r)) continue;
      // arbres du pack KayKit Forest, comme dans le monde
      const proto = nature.palms[i % nature.palms.length];
      const g = new THREE.Group();
      g.position.set(x, villageHeight(x, z) - 0.1, z);
      g.scale.setScalar((0.9 + rand() * 0.4) * KK);
      const t = new THREE.Mesh(proto.geo, nature.mat.palm);
      t.rotation.y = rand() * Math.PI * 2;
      t.castShadow = true;
      g.add(t);
      this.root.add(g);
      if (r < 42) this.colliders.push({ x, z, r: 0.45 });
    }
    for (let i = 0; i < 30; i++) {
      const a = rand() * Math.PI * 2, r = 14 + rand() * 17;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1.2) || this.pathDist(x, z) < 2) continue;
      const b = new THREE.Mesh(nature.bushGeos[i % nature.bushGeos.length], nature.mat.leaf);
      b.position.set(x, -0.1, z);
      b.scale.setScalar(0.7 + rand() * 0.5);
      b.castShadow = true;
      this.root.add(b);
    }
  }

  // ---------------- Physique ----------------
  groundAt(x, z, feetY) {
    let h = villageHeight(x, z);
    for (const p of this.platforms) {
      const inside = p.box ? Math.abs(x - p.x) < p.box.hx && Math.abs(z - p.z) < p.box.hz : Math.hypot(x - p.x, z - p.z) < p.r;
      if (inside && p.h <= feetY + 0.4) h = Math.max(h, p.h);
    }
    return h;
  }
  collide(pos, radius) {
    for (const c of this.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const min = c.r + radius;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 0.0001) { pos.x = c.x + dx / d * min; pos.z = c.z + dz / d * min; }
    }
    const r = Math.hypot(pos.x, pos.z);
    if (r > VILLAGE_RADIUS) { pos.x *= VILLAGE_RADIUS / r; pos.z *= VILLAGE_RADIUS / r; }
  }
  // Zones sans herbe (pour le masque de l'herbe)
  drawGrassMask(ctx, k) {
    const P = (v) => (v + 150) * k;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(P(0), P(0), 10 * k, 0, Math.PI * 2); ctx.fill();
    for (let x = -100; x < 100; x += 0.8) for (let z = -100; z < 100; z += 0.8) {
      if (Math.abs(x) > 45 || Math.abs(z) > 45) continue;
      if (this.pathDist(x, z) < 1.3) ctx.fillRect(P(x) - 0.5 * k, P(z) - 0.5 * k, k, k);
    }
    ctx.fillRect(P(SPOTS.forge.x - 2.6), P(SPOTS.forge.z - 3.3), 5.2 * k, 6.6 * k);
    ctx.beginPath(); ctx.arc(P(SPOTS.board.x), P(SPOTS.board.z), 2 * k, 0, Math.PI * 2); ctx.fill();
  }

  update(dt, focus) {
    const t = (this.time += dt);
    this.portalUniforms.uTime.value = t;
    this.portal.children.forEach(() => {});
    this.crystals.forEach((c, i) => { c.rotation.y = t + i; c.position.y = 2.0 + Math.sin(t * 1.5 + i) * 0.12; });
    this.portalLight.intensity = 7 + Math.sin(t * 2) * 1.5 + this.portalUniforms.uPower.value * 10;
    this.forgeLight.intensity = 5 + Math.sin(t * 13) * 0.8 + Math.sin(t * 7.3) * 0.8 + Math.random() * 0.6;
    for (const gl of this.glows) gl.material.opacity = 0.8 + Math.sin(t * 3 + gl.position.x) * 0.1;
    // fumée de la cheminée et étincelles
    this.smokeT = (this.smokeT || 0) - dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.25;
      const p = this.forgeGroup.localToWorld(this.chimneyLocal.clone());
      this.fx.puff(p, 0x9a948c, 1, 0.45);
    }
    this.sparkT = (this.sparkT || 0) - dt;
    if (this.sparkT <= 0) {
      this.sparkT = 0.1 + Math.random() * 0.3;
      const p = this.forgeGroup.localToWorld(new THREE.Vector3(-1.6, 0.9, -1.0));
      this.fx.spawn({ geo: this.fx.box, mat: this.sparkMat ||= new THREE.MeshBasicMaterial({ color: 0xffc060 }), pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5), size: 0.03, life: 0.8, gravity: 3, spin: 0 });
    }
    // particules du portail
    this.pT = (this.pT || 0) - dt;
    if (this.pT <= 0) {
      this.pT = 0.08;
      const a = Math.random() * Math.PI * 2;
      this.fx.spawn({ geo: this.fx.box, mat: this.pMat ||= new THREE.MeshBasicMaterial({ color: 0xd2b0ff }), pos: new THREE.Vector3(Math.cos(a) * 2.2, 0.6, Math.sin(a) * 2.2), vel: new THREE.Vector3(-Math.cos(a) * 0.4, 1.2 + Math.random(), -Math.sin(a) * 0.4), size: 0.04, life: 2, gravity: -0.2, drag: 0.3, spin: 4 });
    }
    this.smith.update(dt, focus);
    for (const n of this.npcs) n.update(dt, focus);
    this.fx.update(dt, new THREE.Vector3(1, 0, 0.3));
  }

  // effet quand le groupe part en partie
  charge(k) { this.portalUniforms.uPower.value = k; }
}
