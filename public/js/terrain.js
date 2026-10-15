// Sol, rivière et versions GLSL du relief.
// IMPORTANT : terrainHeight() (GLSL) doit rester identique à heightAt() de world.js.
import * as THREE from 'three';
import { heightAt, dirtAt, riverZ, riverDist, noise3, WATER_LEVEL, CLIFF, CAVES, WATERFALL, plateau, waterLevelAt, caveK } from './world.js';

export { heightAt, dirtAt, noise3, WORLD_LIMIT, seededRandom } from './world.js';

// Les grottes sont recopiées dans le shader à partir de world.js
const g = (v) => v.toFixed(4);
const CAVES_GLSL = CAVES.map((c) => `
  { vec2 a = vec2(${g(c.x)}, ${g(c.z)}), b = vec2(${g(c.ex)}, ${g(c.ez)});
    float dC = length(p - a);
    vec2 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    float dT = length(p - a - ab * t);
    float k = max(1.0 - smoothstep(${g(c.r)}, ${g(c.r + 2.5)}, dC), 1.0 - smoothstep(2.3, 4.2, dT));
    h += (${g(c.floor)} - h) * k; }`).join('');

export const TERRAIN_GLSL = /* glsl */`
float riverZ(float x) { return 36.0 + sin(x * 0.023 + 0.4) * 14.0 + sin(x * 0.061 + 1.3) * 5.0; }
float terrainHeight(vec2 p) {
  float h = sin(p.x * 0.045) * cos(p.y * 0.038) * 1.6
    + sin(p.x * 0.013 + 1.3) * sin(p.y * 0.017 + 0.7) * 3.2
    + sin(p.x * 0.11 + p.y * 0.07) * 0.25
    + cos(p.y * 0.13 - p.x * 0.05) * 0.2;
  h *= smoothstep(4.0, 22.0, length(p));
  float bank = 1.0 - smoothstep(3.2, 9.0, abs(p.y - riverZ(p.x)));
  h = h + (-1.7 - h) * bank;
  h -= (1.0 - smoothstep(4.0, 8.0, length(p - vec2(${g(CLIFF.x0 - 2)}, ${g(WATERFALL.z)})))) * 0.9;
  h += smoothstep(${g(CLIFF.x0)}, ${g(CLIFF.x1)}, p.x) * ${g(CLIFF.h)};
  ${CAVES_GLSL}
  return h;
}
float dirtAt(vec2 p) {
  float d = sin(p.x * 0.071 + 1.7 * sin(p.y * 0.043)) * sin(p.y * 0.067 + 1.3 * sin(p.x * 0.037));
  return smoothstep(0.62, 0.85, d);
}
// pas d'herbe sur la falaise, dans l'eau et dans les grottes
float noGrass(vec2 p) {
  float n = 1.0 - smoothstep(5.0, 7.0, abs(p.y - riverZ(p.x)));
  n = max(n, 1.0 - smoothstep(6.0, 8.0, length(p - vec2(${g(CLIFF.x0 - 2)}, ${g(WATERFALL.z)}))));
  n = max(n, smoothstep(${g(CLIFF.x0 - 0.8)}, ${g(CLIFF.x0)}, p.x) * (1.0 - smoothstep(${g(CLIFF.x1)}, ${g(CLIFF.x1 + 0.8)}, p.x)));
  ${CAVES.map((c) => `n = max(n, 1.0 - smoothstep(${g(c.r + 1)}, ${g(c.r + 3)}, length(p - vec2(${g(c.x)}, ${g(c.z)}))));`).join(' ')}
  return n;
}
`;

function makeDetailTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
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

// Couleur du sol à un endroit (utilisée aussi pour la carte)
const C = {
  grassA: new THREE.Color('#4a8a2c'), grassB: new THREE.Color('#6b9e34'), grassC: new THREE.Color('#3b7426'),
  dirt: new THREE.Color('#7d6448'), dirtDark: new THREE.Color('#62503c'),
  rock: new THREE.Color('#77736c'), rockDark: new THREE.Color('#57534d'),
  sand: new THREE.Color('#b9a57a'), mud: new THREE.Color('#5d5040'), bed: new THREE.Color('#4a4436'),
};
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function groundColor(x, z, out = new THREE.Color()) {
  const h = heightAt(x, z);
  const n1 = noise3(x * 0.08, z * 0.08, 1) * 0.5 + 0.5;
  const n2 = noise3(x * 0.3, z * 0.3, 7) * 0.5 + 0.5;
  out.copy(C.grassA).lerp(C.grassB, n1).lerp(C.grassC, n2 * 0.5);
  out.multiplyScalar(0.85 + Math.min(1, Math.max(0, (h + 3) / 6)) * 0.25);
  const d = dirtAt(x, z);
  if (d > 0) out.lerp(C.dirt.clone().lerp(C.dirtDark, n2), Math.min(1, d * 1.2));
  // falaise et sol des grottes : roche
  const cliff = smoothstep(CLIFF.x0 - 0.5, CLIFF.x0 + 0.5, x) * (1 - smoothstep(CLIFF.x1 - 0.3, CLIFF.x1 + 0.6, x));
  let cave = 0;
  for (const c of CAVES) cave = Math.max(cave, caveK(c, x, z));
  const rock = Math.max(cliff, cave);
  if (rock > 0) out.lerp(C.rock.clone().lerp(C.rockDark, n2), rock);
  const rd = riverDist(x, z);
  if (rd < 10) {
    const sandK = 1 - THREE.MathUtils.smoothstep(rd, 5.5, 9.5);
    out.lerp(C.sand.clone().lerp(C.mud, n2 * 0.6), sandK * (0.6 + n1 * 0.4));
    out.lerp(C.bed, 1 - THREE.MathUtils.smoothstep(rd, 2.5, 5));
  }
  return out;
}

export function createGround(scene) {
  const SIZE = 400, SEG = 400;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    groundColor(x, z, tmp);
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

// ---------- Eau de la rivière ----------
const waterVert = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec3 p = position;
  p.y += sin(p.x * 0.6 + uTime * 1.5) * 0.03 + sin(p.z * 0.8 - uTime * 1.2) * 0.02;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const waterFrag = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  // le courant coule le long de la rivière (u = abscisse)
  vec2 flow = vec2(vUv.x * 120.0 - uTime * 0.9, vUv.y * 6.0);
  float n1 = noise(flow * vec2(1.0, 1.6));
  float n2 = noise(flow * 2.3 + vec2(uTime * 0.3, 3.1));
  float ripple = n1 * 0.6 + n2 * 0.4;
  vec3 nrm = normalize(vec3((n1 - 0.5) * 0.5, 1.0, (n2 - 0.5) * 0.5));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(V, nrm), 0.0), 3.0);
  float edge = abs(vUv.y - 0.5) * 2.0;
  vec3 deep = vec3(0.03, 0.12, 0.16), shallow = vec3(0.12, 0.32, 0.33);
  vec3 col = mix(deep, shallow, smoothstep(0.2, 1.0, edge) * 0.8 + ripple * 0.2);
  col = mix(col, uSkyColor, fres * 0.55);
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(nrm, H), 0.0), 120.0) * 1.5;
  float foam = smoothstep(0.8, 0.98, edge + ripple * 0.15) + smoothstep(0.82, 0.95, n2) * 0.3;
  col = mix(col, vec3(0.85, 0.9, 0.9) * (0.4 + 0.6 * max(uSunDir.y, 0.1)), foam * 0.5);
  float alpha = mix(0.82, 0.55, edge) ;
  float fogF = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
  gl_FragColor = vec4(mix(col, uFogColor, fogF), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class River {
  constructor(scene) {
    const SEG = 600, W = 13, X0 = -200, X1 = 200;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const x = X0 + (X1 - X0) * i / SEG;
      const zc = riverZ(x);
      for (let j = 0; j <= 4; j++) {
        const t = j / 4;
        pos.push(x, waterLevelAt(x), zc - W / 2 + W * t);
        uv.push(i / SEG, t);
      }
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < 4; j++) {
      const a = i * 5 + j, b = a + 5;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSkyColor: { value: new THREE.Color(0.5, 0.7, 0.9) },
      uFogColor: { value: new THREE.Color() },
      uFogNear: { value: 30 }, uFogFar: { value: 170 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: waterVert, fragmentShader: waterFrag, uniforms: this.uniforms, transparent: true, depthWrite: false,
    }));
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  update(time, sunDir, sunColor, skyColor, fog) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor);
    u.uSkyColor.value.copy(skyColor);
    u.uFogColor.value.copy(fog.color);
    u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
  }
}
