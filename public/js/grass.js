// Herbe animée : des dizaines de milliers de brins dessinés en une seule fois.
// La "dalle" d'herbe suit le joueur ; chaque brin ondule au vent et s'écarte quand on passe.
import * as THREE from 'three';
import { TERRAIN_GLSL } from './terrain.js';

const TILE = 42;
const COUNT = 75000;

const vert = /* glsl */`
attribute vec4 aOffset;   // x, z dans la dalle, taille, angle
attribute float aRand;
uniform float uTime;
uniform vec2 uCenter;
uniform vec3 uPlayer;
uniform vec3 uWind;       // direction x, z + force
uniform sampler2D uMask;  // zones sans herbe (sols construits)
varying float vY;
varying float vRand;
varying vec3 vWorld;
${TERRAIN_GLSL}
void main() {
  const float T = ${TILE.toFixed(1)};
  vec2 wp = uCenter + mod(aOffset.xy - uCenter + T * 0.5, T) - T * 0.5;
  float dist = length(wp - uCenter);
  float fade = 1.0 - smoothstep(T * 0.3, T * 0.48, dist);
  float s = aOffset.z * fade * (1.0 - smoothstep(0.25, 0.7, dirtAt(wp)));
  s *= 1.0 - step(96.0, max(abs(wp.x), abs(wp.y)));
  float gh = terrainHeight(wp);
  s *= smoothstep(5.0, 7.0, abs(wp.y - riverZ(wp.x)));   // pas d'herbe dans la rivière
  s *= 1.0 - texture2D(uMask, wp / 200.0 + 0.5).r;       // ni sous les constructions
  if (aRand > 0.985) s *= 1.25; // les fleurs dépassent un peu

  vec3 p = position;
  float ca = cos(aOffset.w), sa = sin(aOffset.w);
  p.xz = mat2(ca, -sa, sa, ca) * p.xz;
  p *= s;
  float y01 = position.y;

  // Vent : petite ondulation + rafales qui traversent le champ
  float w = sin(uTime * 1.8 + wp.x * 0.35 + wp.y * 0.25) * 0.5 + sin(uTime * 3.3 + wp.x * 0.9 - wp.y * 0.6) * 0.2;
  float gust = smoothstep(-0.2, 1.0, sin(uTime * 0.7 - dot(wp, uWind.xy) * 0.09));
  vec2 off = uWind.xy * (0.12 + w * 0.22 + gust * 0.55) * uWind.z;

  // Le joueur écarte l'herbe
  vec2 tp = wp - uPlayer.xz;
  float pd = length(tp);
  float push = (1.0 - smoothstep(0.2, 1.2, pd)) * (1.0 - step(1.2, abs(uPlayer.y - gh)));
  off += (tp / max(pd, 0.001)) * push * 1.1;

  float k = y01 * y01;
  p.xz += off * k * s;
  p.y *= 1.0 - min(length(off), 1.2) * 0.4 * k;

  vec3 world = vec3(wp.x, gh - 0.02, wp.y) + p;
  vY = y01; vRand = aRand; vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const frag = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying float vY;
varying float vRand;
varying vec3 vWorld;
void main() {
  vec3 base = mix(vec3(0.035, 0.14, 0.02), vec3(0.06, 0.2, 0.025), vRand);
  vec3 tip = mix(vec3(0.16, 0.36, 0.06), vec3(0.3, 0.44, 0.09), fract(vRand * 7.0));
  vec3 c = mix(base, tip, smoothstep(0.0, 1.0, vY));
  if (vRand > 0.985 && vY > 0.78) {
    float f = fract(vRand * 53.0);
    c = f < 0.33 ? vec3(0.9, 0.08, 0.06) : (f < 0.66 ? vec3(1.0, 0.75, 0.05) : vec3(0.95, 0.9, 1.0));
  }
  vec3 V = normalize(cameraPosition - vWorld);
  float diff = 0.6 + 0.4 * max(uSunDir.y, 0.0);
  float trans = pow(max(dot(-V, uSunDir), 0.0), 3.0) * vY * 0.9; // lumière à travers les brins
  vec3 lit = c * (uAmbient + uSunColor * (diff + trans)) * (0.45 + 0.55 * vY);
  float fogF = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
  gl_FragColor = vec4(mix(lit, uFogColor, fogF), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Grass {
  constructor(scene, wind, count = COUNT) {
    // Un brin = 7 sommets, plus fin vers la pointe
    const w = [0.07, 0.055, 0.035];
    const ys = [0, 0.4, 0.75];
    const verts = [];
    for (let i = 0; i < 3; i++) verts.push(-w[i], ys[i], 0, w[i], ys[i], 0);
    verts.push(0, 1, 0);
    const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6];
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    const off = new Float32Array(count * 4), rnd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      off[i * 4] = Math.random() * TILE;
      off[i * 4 + 1] = Math.random() * TILE;
      off[i * 4 + 2] = 0.25 + Math.random() * 0.38;
      off[i * 4 + 3] = Math.random() * Math.PI * 2;
      rnd[i] = Math.random();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 1));
    geo.instanceCount = count;

    this.uniforms = {
      uTime: wind.uTime,
      uWind: wind.uWind,
      uCenter: { value: new THREE.Vector2() },
      uMask: { value: this.makeMask() },
      uPlayer: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uAmbient: { value: new THREE.Color(0.3, 0.3, 0.3) },
      uFogColor: { value: new THREE.Color() },
      uFogNear: { value: 30 },
      uFogFar: { value: 170 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  makeMask() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    this.maskCtx = c.getContext('2d');
    this.maskCtx.fillStyle = '#000'; this.maskCtx.fillRect(0, 0, 512, 512);
    this.maskTex = new THREE.CanvasTexture(c);
    this.maskTex.flipY = false;
    return this.maskTex;
  }
  // floors : liste de {x, z} (centres de cases de 2 m)
  setMask(floors) {
    const ctx = this.maskCtx, k = 512 / 200;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#fff';
    for (const f of floors) ctx.fillRect((f.x - 1.15 + 100) * k, (f.z - 1.15 + 100) * k, 2.3 * k, 2.3 * k);
    this.maskTex.needsUpdate = true;
  }

  update(player, center, sunDir, sunColor, ambient, fog) {
    const u = this.uniforms;
    u.uPlayer.value.copy(player);
    u.uCenter.value.set(center.x, center.z);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor);
    u.uAmbient.value.copy(ambient);
    u.uFogColor.value.copy(fog.color);
    u.uFogNear.value = fog.near;
    u.uFogFar.value = fog.far;
  }
}
