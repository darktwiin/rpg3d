// Ciel dynamique : dégradé selon l'heure, soleil, lune, étoiles et nuages qui défilent avec le vent.
import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // toujours au fond
}`;

const frag = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uNight;
uniform float uTime;
uniform vec2 uCloudOffset;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float t = pow(1.0 - max(y, 0.0), 3.0);
  vec3 col = mix(uZenith, uHorizon, t);
  if (y < 0.0) col = uHorizon * (1.0 + y * 0.6);

  // Halo et disque du soleil
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 5.0) * 0.18 + pow(sd, 60.0) * 0.5);
  col += uSunColor * smoothstep(0.9990, 0.9995, sd) * 12.0;

  // Lune (à l'opposé du soleil)
  float md = max(dot(d, -uSunDir), 0.0);
  col += vec3(0.8, 0.85, 1.0) * smoothstep(0.9993, 0.9996, md) * 2.0 * uNight;
  col += vec3(0.25, 0.3, 0.5) * pow(md, 40.0) * 0.4 * uNight;

  // Étoiles
  if (y > 0.0 && uNight > 0.01) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float h = hash3(cell);
    float star = step(0.9975, h) * smoothstep(0.45, 0.0, length(fract(sp) - 0.5));
    float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + h * 100.0);
    col += vec3(star) * uNight * 3.0 * twinkle * smoothstep(0.0, 0.2, y);
  }

  // Nuages
  if (y > 0.0) {
    vec2 uv = d.xz / (y + 0.12) * 0.9 + uCloudOffset;
    float n = fbm(uv);
    float n2 = fbm(uv * 2.5 - uCloudOffset * 0.5);
    float cov = smoothstep(0.48, 0.78, n * 0.8 + n2 * 0.25);
    float light = clamp(n2 * 1.2 - 0.1 + dot(normalize(vec3(uv.x, 1.0, uv.y)), uSunDir) * 0.2, 0.0, 1.0);
    vec3 cloud = mix(uCloudDark, uCloudLit, light);
    cloud += uSunColor * pow(sd, 6.0) * 0.5; // bord des nuages éclairé
    float fade = smoothstep(0.0, 0.22, y);
    col = mix(col, cloud, cov * fade * 0.92);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() },
      uCloudDark: { value: new THREE.Color() },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uCloudOffset: { value: new THREE.Vector2() },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(450, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);

    // Palettes (couleurs linéaires)
    const L = (r, g, b) => new THREE.Color().setRGB(r, g, b);
    this.p = {
      dayZ: L(0.09, 0.27, 0.72), dayH: L(0.55, 0.72, 0.92),
      setZ: L(0.14, 0.17, 0.42), setH: L(1.0, 0.42, 0.16),
      nightZ: L(0.004, 0.008, 0.025), nightH: L(0.025, 0.04, 0.09),
    };
  }

  // sunDir : direction normalisée vers le soleil ; time en secondes
  update(camera, sunDir, time, cloudOffset) {
    const u = this.uniforms;
    this.mesh.position.copy(camera.position);
    u.uSunDir.value.copy(sunDir);
    u.uTime.value = time;
    u.uCloudOffset.value.copy(cloudOffset);

    const e = sunDir.y;
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const day = ss(-0.12, 0.25, e);
    const sunset = (1 - ss(0.02, 0.4, e)) * ss(-0.2, 0.0, e);
    const p = this.p;

    u.uZenith.value.copy(p.nightZ).lerp(p.dayZ, day).lerp(p.setZ, sunset * 0.6);
    u.uHorizon.value.copy(p.nightH).lerp(p.dayH, day).lerp(p.setH, sunset * 0.85);
    u.uSunColor.value.setRGB(1.0, 0.75 + 0.2 * (1 - sunset), 0.5 + 0.4 * (1 - sunset)).multiplyScalar(ss(-0.05, 0.05, e));
    u.uCloudLit.value.setRGB(1, 0.97, 0.94).multiplyScalar(day * 1.1).lerp(new THREE.Color().setRGB(1.0, 0.55, 0.35), sunset * 0.6);
    u.uCloudLit.value.r += 0.05; u.uCloudLit.value.g += 0.055; u.uCloudLit.value.b += 0.08;
    u.uCloudDark.value.setRGB(0.45, 0.5, 0.6).multiplyScalar(day).lerp(new THREE.Color().setRGB(0.5, 0.3, 0.35), sunset * 0.5);
    u.uCloudDark.value.r += 0.02; u.uCloudDark.value.g += 0.025; u.uCloudDark.value.b += 0.04;
    u.uNight.value = 1 - day;
    return { day, sunset, horizon: u.uHorizon.value };
  }
}
