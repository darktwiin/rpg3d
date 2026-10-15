// Herbe animée : des milliers de touffes d'herbe (8 modèles du pack KayKit Forest Nature),
// dessinées en quelques appels. La "dalle" d'herbe suit le joueur ; chaque touffe ondule
// au vent et s'écarte quand on passe.
import * as THREE from 'three';
import { staticGeometry, textureOf } from './models.js';
const TUFTS = ['1_A', '1_B', '1_C', '1_D', '2_A', '2_B', '2_C', '2_D'].map((n) => 'f_Grass_' + n);
import { TERRAIN_GLSL } from './terrain.js';
import { VILLAGE_GLSL } from './village.js';

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
uniform float uFlat;      // 1 = village
uniform float uH;         // hauteur du modèle de touffe
varying vec2 vUv;
varying float vY;
varying float vRand;
varying vec3 vWorld;
${TERRAIN_GLSL}
${VILLAGE_GLSL}
void main() {
  const float T = ${TILE.toFixed(1)};
  vec2 wp = uCenter + mod(aOffset.xy - uCenter + T * 0.5, T) - T * 0.5;
  float dist = length(wp - uCenter);
  float fade = 1.0 - smoothstep(T * 0.3, T * 0.48, dist);
  float s = aOffset.z * fade * (1.0 - smoothstep(0.25, 0.7, dirtAt(wp)));
  s *= 1.0 - step(141.0, max(abs(wp.x), abs(wp.y)));
  float gh = mix(terrainHeight(wp), villageHeight(wp), uFlat);
  s *= max(uFlat, 1.0 - noGrass(wp));   // pas d'herbe dans l'eau, sur la falaise, dans les grottes
  s *= 1.0 - texture2D(uMask, wp / 300.0 + 0.5).r;       // ni sous les constructions
  vec3 p = position;
  float ca = cos(aOffset.w), sa = sin(aOffset.w);
  p.xz = mat2(ca, -sa, sa, ca) * p.xz;
  p *= s;
  float y01 = clamp(position.y / uH, 0.0, 1.0);

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
  vY = y01; vRand = aRand; vWorld = world; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const frag = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform sampler2D uMap;
varying vec2 vUv;
varying float vY;
varying float vRand;
varying vec3 vWorld;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  c *= 0.85 + vRand * 0.3;   // chaque touffe a sa nuance
  vec3 V = normalize(cameraPosition - vWorld);
  float diff = 0.6 + 0.4 * max(uSunDir.y, 0.0);
  float trans = pow(max(dot(-V, uSunDir), 0.0), 3.0) * vY * 0.9; // lumière à travers les brins
  vec3 lit = c * (uAmbient + uSunColor * (diff + trans)) * (0.55 + 0.45 * vY);
  float fogF = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
  gl_FragColor = vec4(mix(lit, uFogColor, fogF), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Grass {
  constructor(scene, wind, count = COUNT) {
    // Une touffe remplace ~5 anciens brins
    const total = Math.round(count / 5);

    this.uniforms = {
      uTime: wind.uTime,
      uWind: wind.uWind,
      uCenter: { value: new THREE.Vector2() },
      uMask: { value: this.makeMask() },
      uFlat: { value: 0 },
      uPlayer: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uAmbient: { value: new THREE.Color(0.3, 0.3, 0.3) },
      uFogColor: { value: new THREE.Color() },
      uFogNear: { value: 30 },
      uFogFar: { value: 170 },
      uMap: { value: textureOf('f_Grass_1_A') },
    };
    // une série de touffes par modèle (les petites touffes sont plus nombreuses)
    const weights = [1.4, 1.2, 0.8, 0.5, 1.4, 1.2, 0.8, 0.5];
    const wsum = weights.reduce((a, b) => a + b, 0);
    this.meshes = TUFTS.map((name, k) => {
      const src = staticGeometry(name);
      const n = Math.max(1, Math.round(total * weights[k] / wsum));
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', src.attributes.position);
      geo.setAttribute('uv', src.attributes.uv);
      const off = new Float32Array(n * 4), rnd = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        off[i * 4] = Math.random() * TILE;
        off[i * 4 + 1] = Math.random() * TILE;
        off[i * 4 + 2] = 0.55 + Math.random() * 0.5;
        off[i * 4 + 3] = Math.random() * Math.PI * 2;
        rnd[i] = Math.random();
      }
      geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
      geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 1));
      geo.instanceCount = n;
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        vertexShader: vert, fragmentShader: frag,
        uniforms: { ...this.uniforms, uH: { value: src.boundingBox.max.y || 1 } },
        side: THREE.DoubleSide,
      }));
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    });
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
  // Mode village : sol plat et zones sans herbe dessinées par le village
  setVillage(village) {
    this.uniforms.uFlat.value = village ? 1 : 0;
    const ctx = this.maskCtx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 512, 512);
    if (village) village.drawGrassMask(ctx, 512 / 300);
    this.maskTex.needsUpdate = true;
  }
  // floors : liste de {x, z} (centres de cases de 2 m)
  setMask(floors) {
    const ctx = this.maskCtx, k = 512 / 300;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#fff';
    for (const f of floors) ctx.fillRect((f.x - 1.15 + 150) * k, (f.z - 1.15 + 150) * k, 2.3 * k, 2.3 * k);
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
