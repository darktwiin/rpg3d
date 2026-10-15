// Modèles 3D : packs KayKit (Kay Lousberg, CC0) et quelques objets du Pirate Kit (Quaternius, CC0).
// - personnages animés (aventuriers + squelettes) qui partagent le même squelette « Rig_Medium »
// - objets fixes (nature, décor du village, outils) qui partagent une petite texture par pack
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Les personnages KayKit mesurent ~2,3 unités : on les ramène à ~1,8 m (et le décor avec)
export const KK = 0.78;

const PIRATE = ['Wood', 'Rocks', 'Gem_Blue', 'Gem_Green', 'Gem_Pink'];
export const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue',
  'Skeleton_Minion', 'Skeleton_Rogue', 'Skeleton_Mage', 'Skeleton_Warrior'];
const ANIMS = ['Rig_Medium_General', 'Rig_Medium_MovementBasic', 'Rig_Medium_CombatMelee', 'Rig_Medium_CombatRanged',
  'Rig_Medium_Tools', 'Rig_Medium_Special', 'Rig_Medium_Simulation'];
// texture partagée selon le pack (préfixe du nom)
const TEX_OF = (n) => n === 'a_sword_1handed' ? 'knight_texture' : n === 'a_mug_full' ? 'barbarian_texture'
  : ({ f: 'forest_texture', d: 'dungeon_texture', t: 'tools_bits_texture', s: 'skeleton_texture' })[n[0]];

const GLTF = {};
let atlas = null;           // palette du Pirate Kit
let animations = [];
const textures = {};

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  const statics = await (await fetch('models/kk/manifest.json')).json();
  const jobs = [
    ...PIRATE.map((n) => [n, `models/${n}.glb`]),
    ...CHARACTERS.map((n) => [n, `models/kk/${n}.glb`]),
    ...ANIMS.map((n) => [n, `models/kk/${n}.glb`]),
    // tous les objets fixes sont rangés dans un seul fichier, une « scène » par objet
    ['__decor', 'models/kk/decor.glb'],
    // constructions en bois (Wood Frame Base Build Set)
    ['__wood', 'models/kk/wood.glb'],
    // armes des styles de combat (bouclier, hache de guerre, bâton, arc, flèche)
    ['__weapons', 'models/kk/weapons.glb'],
  ];
  const texNames = [...new Set(statics.map(TEX_OF).filter(Boolean))];
  const total = jobs.length + texNames.length;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  const tl = new THREE.TextureLoader();
  await Promise.all([
    ...jobs.map(async ([n, url]) => { GLTF[n] = await loader.loadAsync(url); tick(); }),
    ...texNames.map(async (t) => {
      const tex = await tl.loadAsync(`models/kk/tex/${t}.png`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;   // convention glTF
      textures[t] = tex;
      tick();
    }),
  ]);
  for (const sc of GLTF.__decor.scenes) GLTF[sc.name] = { scene: sc };
  for (const sc of GLTF.__weapons.scenes) {
    GLTF[sc.name] = { scene: sc };
    sc.traverse((o) => { if (o.isMesh) { o.material.metalness = 0; o.material.roughness = 0.7; } });
  }
  // bois : couleurs unies, mates (une seule copie de chaque matériau pour tous les morceaux)
  const woodMats = new Map();
  for (const sc of GLTF.__wood.scenes) {
    GLTF[sc.name] = { scene: sc };
    sc.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material, key = src.name + src.color.getHexString();
      if (!woodMats.has(key)) woodMats.set(key, new THREE.MeshStandardMaterial({ color: src.color, roughness: src.name.startsWith('Cloth') ? 0.95 : 0.82, metalness: 0, side: src.name.startsWith('Cloth') ? THREE.DoubleSide : THREE.FrontSide }));
      o.material = woodMats.get(key);
    });
  }
  void statics;
  GLTF.Wood.scene.traverse((o) => { if (!atlas && o.isMesh && o.material.map) atlas = o.material.map; });
  atlas.magFilter = atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.needsUpdate = true;
  animations = ANIMS.flatMap((n) => GLTF[n].animations);
}

export const has = (name) => !!GLTF[name];
export const atlasTexture = () => atlas;

const matCache = new Map();
// Matériau mat (non métallique) qui utilise la palette du Pirate Kit
export function atlasMaterial(opts = {}) {
  const key = 'atlas' + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.85, metalness: 0, ...opts }));
  return matCache.get(key);
}
// Texture et matériau partagés d'un objet KayKit
export function textureOf(name) { return textures[TEX_OF(name)] || atlas; }
export function modelMaterial(name, opts = {}) {
  const t = TEX_OF(name);
  if (!t) return atlasMaterial(opts);
  const key = t + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ map: textures[t], roughness: 0.75, metalness: 0, ...opts }));
  return matCache.get(key);
}

const geoCache = new Map();
// Toute la géométrie d'un modèle fusionnée en une seule
export function staticGeometry(name) {
  if (geoCache.has(name)) return geoCache.get(name);
  const scene = GLTF[name].scene;
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    parts.push(g);
  });
  const geo = parts.length > 1 ? mergeGeometries(parts) : parts[0];
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geoCache.set(name, geo);
  return geo;
}

// Copie d'un objet de décor (géométries partagées, matériau partagé du pack)
export function prop(name, scale = KK) {
  const src = GLTF[name].scene;
  const o = src.clone(true);
  o.traverse((m) => {
    if (!m.isMesh) return;
    if (name.startsWith('w_') || name.startsWith('x_')) { /* matériaux déjà prêts */ }
    else if (m.material?.name !== 'glass') m.material = modelMaterial(name);
    else m.material = new THREE.MeshStandardMaterial({ color: '#ffd890', emissive: '#ffa040', emissiveIntensity: 0.8, transparent: true, opacity: 0.85 });
    m.castShadow = true; m.receiveShadow = true;
  });
  o.scale.setScalar(scale);
  return o;
}

// Copie d'un personnage animé (squelette indépendant) + toutes les animations KayKit
export function skinnedModel(name) {
  const src = GLTF[name];
  return { scene: cloneSkinned(src.scene), animations };
}

// Petite image d'un modèle (icônes de l'inventaire)
const iconCache = new Map();
let iconRenderer = null;
function getIconRenderer(size) {
  if (!iconRenderer) {
    iconRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    iconRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  iconRenderer.setSize(size, size);
  return iconRenderer;
}
function iconScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 4, 3); scene.add(d);
  return scene;
}
export function modelIcon(name, size = 64, yaw = 0.6, pitch = 0.45) {
  const key = name + size;
  if (iconCache.has(key)) return iconCache.get(key);
  const r = getIconRenderer(size);
  const scene = iconScene();
  const mesh = new THREE.Mesh(staticGeometry(name), PIRATE.includes(name) ? atlasMaterial() : modelMaterial(name));
  scene.add(mesh);
  const box = new THREE.Box3().setFromObject(mesh);
  const c = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() * 0.5;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const dist = R / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02;
  cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, c.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  cam.lookAt(c);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

// Image d'un objet de décor / d'une pièce de construction (fenêtre de construction)
export function propIcon(name, size = 96, yaw = 0.7, pitch = 0.42) {
  const key = 'prop' + name + size;
  if (iconCache.has(key)) return iconCache.get(key);
  const r = getIconRenderer(size);
  r.setSize(size, size);
  const scene = iconScene();
  const o = prop(name, 1);
  scene.add(o);
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  const c = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() * 0.5;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const dist = R / Math.sin(THREE.MathUtils.degToRad(15)) * 1.0;
  cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, c.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  cam.lookAt(c);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

// Portrait d'un personnage (choix de l'apparence), en pose de repos
export function characterPortrait(name, w = 120, h = 150) {
  const key = 'portrait' + name + w;
  if (iconCache.has(key)) return iconCache.get(key);
  const r = getIconRenderer(w);
  r.setSize(w, h);
  const scene = iconScene();
  const { scene: model } = skinnedModel(name);
  scene.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const idle = animations.find((a) => a.name === 'Idle_A');
  if (idle) { mixer.clipAction(idle).play(); mixer.setTime(0.3); }
  model.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera(28, w / h, 0.01, 100);
  cam.position.set(1.6, 2.0, 5.2);
  cam.lookAt(0, 1.15, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  mixer.stopAllAction();
  iconCache.set(key, url);
  return url;
}
