// Relief du monde, sol et fonctions de bruit partagées.
// IMPORTANT : heightAt() (JS) et terrainHeight() (GLSL) doivent rester identiques,
// car l'herbe est placée sur le sol directement dans le shader.
import * as THREE from 'three';

export const WORLD_LIMIT = 95;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function heightAt(x, z) {
  const h = Math.sin(x * 0.045) * Math.cos(z * 0.038) * 1.6
    + Math.sin(x * 0.013 + 1.3) * Math.sin(z * 0.017 + 0.7) * 3.2
    + Math.sin(x * 0.11 + z * 0.07) * 0.25
    + Math.cos(z * 0.13 - x * 0.05) * 0.2;
  return h * smoothstep(4, 22, Math.hypot(x, z));
}

export function dirtAt(x, z) {
  const d = Math.sin(x * 0.071 + 1.7 * Math.sin(z * 0.043)) * Math.sin(z * 0.067 + 1.3 * Math.sin(x * 0.037));
  return smoothstep(0.62, 0.85, d);
}

export const TERRAIN_GLSL = /* glsl */`
float terrainHeight(vec2 p) {
  float h = sin(p.x * 0.045) * cos(p.y * 0.038) * 1.6
    + sin(p.x * 0.013 + 1.3) * sin(p.y * 0.017 + 0.7) * 3.2
    + sin(p.x * 0.11 + p.y * 0.07) * 0.25
    + cos(p.y * 0.13 - p.x * 0.05) * 0.2;
  return h * smoothstep(4.0, 22.0, length(p));
}
float dirtAt(vec2 p) {
  float d = sin(p.x * 0.071 + 1.7 * sin(p.y * 0.043)) * sin(p.y * 0.067 + 1.3 * sin(p.x * 0.037));
  return smoothstep(0.62, 0.85, d);
}
`;

// ---------- Bruit (utilisé pour générer les modèles) ----------
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
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ---------- Sol ----------
function makeDetailTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Bruit qui se répète sans couture
    const n = (noise3(x / 16, y / 16, 0) * 0.5 + noise3(x / 5, y / 5, 3) * 0.35 + Math.random() * 0.3);
    const v = 215 + n * 40;
    const i = (y * size + x) * 4;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v * 0.97; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createGround(scene) {
  const SIZE = 400, SEG = 280;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grassA = new THREE.Color('#4a8a2c'), grassB = new THREE.Color('#6b9e34'), grassC = new THREE.Color('#3b7426');
  const dirtCol = new THREE.Color('#7d6448'), dirtDark = new THREE.Color('#62503c');
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n1 = noise3(x * 0.08, z * 0.08, 1) * 0.5 + 0.5;
    const n2 = noise3(x * 0.3, z * 0.3, 7) * 0.5 + 0.5;
    tmp.copy(grassA).lerp(grassB, n1).lerp(grassC, n2 * 0.5);
    tmp.multiplyScalar(0.85 + Math.min(1, Math.max(0, (h + 3) / 6)) * 0.25); // vallées plus sombres
    const d = dirtAt(x, z);
    if (d > 0) tmp.lerp(tmp.clone().copy(dirtCol).lerp(dirtDark, n2), Math.min(1, d * 1.2));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: makeDetailTexture(), roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
