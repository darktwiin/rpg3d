// ============================================================================
// Règles et géographie du monde, PARTAGÉES entre le navigateur et le serveur.
// Ce fichier ne doit rien importer (ni Three.js, ni le DOM).
// IMPORTANT : heightAt() doit rester identique à terrainHeight() dans terrain.js (GLSL).
// ============================================================================

export const VERSION = '0.0.3';

// ---------- Monde ----------
export const WORLD_LIMIT = 95;
export const WATER_LEVEL = -0.55;
export const GEM_HOME = { x: 0, z: 0 };

// ---------- Temps (secondes) ----------
export const DAY_LEN = 360;        // 6 min de jour
export const NIGHT_LEN = 180;      // 3 min de nuit
export const CYCLE = DAY_LEN + NIGHT_LEN;
export const DUSK_WARN = 35;       // musique de stress avant la nuit
export const START_TIME = 30;      // la partie commence au petit matin

// ---------- Combat ----------
export const PLAYER_HP = 100;
export const GEM_HP = 600;
export const MONSTER_HP = 60;
export const SWORD_DMG = 20;
export const MONSTER_DMG_PLAYER = 16;
export const MONSTER_DMG_GEM = 25;
export const MONSTER_DMG_BUILD = 40;
export const RESPAWN_DELAY = 8;
export const MAX_PLAYERS = 4;

// ---------- Ressources ----------
export const TREE_HP = 5;
export const ROCK_HP = 4;
export const TREE_VARIANTS = 6;    // 0-2 chênes, 3 chêne d'automne, 4-5 sapins
export const ROCK_VARIANTS = 4;

// ---------- Construction ----------
export const GRID = 2;
export const WALL_H = 2.5;
export const BUILD_TIME = 3;
export const BUILD_RANGE = 7;
export const PIECES = {
  floor: { name: 'Sol', cost: { wood: 2, stone: 2 }, hp: 250 },
  wall: { name: 'Mur', cost: { wood: 3, stone: 0 }, hp: 400 },
  roof: { name: 'Toit', cost: { wood: 2, stone: 1 }, hp: 250 },
};
export const PIECE_ORDER = ['floor', 'wall', 'roof'];

// ---------- Outils ----------
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w) * 2 - 1;
}
export function seededRandom(seed) {
  let s = Math.floor(seed) % 2147483647; if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ---------- Rivière ----------
export function riverZ(x) {
  return 36 + Math.sin(x * 0.023 + 0.4) * 14 + Math.sin(x * 0.061 + 1.3) * 5;
}
export function riverDist(x, z) {
  return Math.abs(z - riverZ(x));
}

// ---------- Relief ----------
export function heightAt(x, z) {
  let h = Math.sin(x * 0.045) * Math.cos(z * 0.038) * 1.6
    + Math.sin(x * 0.013 + 1.3) * Math.sin(z * 0.017 + 0.7) * 3.2
    + Math.sin(x * 0.11 + z * 0.07) * 0.25
    + Math.cos(z * 0.13 - x * 0.05) * 0.2;
  h *= smoothstep(4, 22, Math.hypot(x, z));
  const bank = 1 - smoothstep(3.2, 9.0, riverDist(x, z));
  return h + (-1.7 - h) * bank;
}

export function dirtAt(x, z) {
  const d = Math.sin(x * 0.071 + 1.7 * Math.sin(z * 0.043)) * Math.sin(z * 0.067 + 1.3 * Math.sin(x * 0.037));
  return smoothstep(0.62, 0.85, d);
}

export const isWater = (x, z) => riverDist(x, z) < 7.5 && heightAt(x, z) < WATER_LEVEL - 0.15;

// ---------- Placement des arbres et rochers ----------
export function isFreeSpot(x, z, others, minDist, extra = []) {
  if (Math.abs(x) > WORLD_LIMIT - 3 || Math.abs(z) > WORLD_LIMIT - 3) return false;
  if (Math.hypot(x - GEM_HOME.x, z - GEM_HOME.z) < 11) return false;
  if (riverDist(x, z) < 9.5) return false;
  for (const o of others) if (Math.hypot(o.x - x, o.z - z) < minDist + (o.k === 'r' ? o.s : 0.8)) return false;
  for (const e of extra) if (Math.hypot(e.x - x, e.z - z) < e.r) return false;
  return true;
}

export function makeResource(rand, id, kind, x, z) {
  return kind === 't'
    ? { id, k: 't', x: +x.toFixed(2), z: +z.toFixed(2), v: rand() < 0.35 ? 4 + Math.floor(rand() * 2) : Math.floor(rand() * 4), s: +(0.85 + rand() * 0.35).toFixed(2), rot: 0 }
    : { id, k: 'r', x: +x.toFixed(2), z: +z.toFixed(2), v: Math.floor(rand() * ROCK_VARIANTS), s: +(0.55 + rand() * 0.95).toFixed(2), rot: +(rand() * 6.28).toFixed(2) };
}

export function generateResources(seed) {
  const rand = seededRandom(seed);
  const list = [];
  let n = 0;
  const L = WORLD_LIMIT - 3;
  for (let i = 0; i < 1500 && list.filter((r) => r.k === 't').length < 150; i++) {
    const x = (rand() * 2 - 1) * L, z = (rand() * 2 - 1) * L;
    if (!isFreeSpot(x, z, list, 2.2)) continue;
    list.push(makeResource(rand, 'n' + n++, 't', x, z));
  }
  for (let i = 0; i < 900 && list.filter((r) => r.k === 'r').length < 70; i++) {
    const x = (rand() * 2 - 1) * L, z = (rand() * 2 - 1) * L;
    if (!isFreeSpot(x, z, list, 2.0)) continue;
    list.push(makeResource(rand, 'n' + n++, 'r', x, z));
  }
  // Quelques ressources près du départ pour bien commencer
  const near = [[9, 7, 't'], [-11, 4, 't'], [6, -12, 't'], [-7, -10, 'r'], [13, -3, 'r']];
  for (const [x, z, k] of near) list.push(makeResource(rand, 'n' + n++, k, x, z));
  return list;
}

export const resourceRadius = (r) => (r.k === 't' ? 0.45 * r.s : r.s * 0.9);

// ---------- Bâtiments (géométrie partagée pour les collisions) ----------
export function wallBox(b) {
  // Rectangle au sol d'un mur : centre, demi-longueurs en x et z
  return b.rot ? { x: b.x, z: b.z, hx: 0.16, hz: GRID / 2 + 0.05 } : { x: b.x, z: b.z, hx: GRID / 2 + 0.05, hz: 0.16 };
}
export function pieceTop(b) {
  if (b.type === 'floor') return b.y;
  if (b.type === 'roof') return b.y + 0.35;
  return b.y + WALL_H;
}
// Distance d'un point au rectangle (0 si dedans)
export function distToBox(px, pz, box) {
  const dx = Math.max(Math.abs(px - box.x) - box.hx, 0);
  const dz = Math.max(Math.abs(pz - box.z) - box.hz, 0);
  return Math.hypot(dx, dz);
}
export function slotKey(type, x, z, rot) {
  return `${type}:${Math.round(x * 2)}:${Math.round(z * 2)}:${type === 'wall' ? rot : 0}`;
}
