// Lieux spéciaux de la carte : la cascade, la grotte cachée derrière, la caverne,
// et la Larme de la cascade (relique qui permet de tuer les monstres en un coup pendant une nuit).
import * as THREE from 'three';
import { CAVES, CLIFF, WATERFALL, WATER_LEVEL, RELIC_POS, heightAt, noise3, seededRandom } from './world.js';
import { stoneTexture } from './buildings.js';
import { staticGeometry, atlasTexture } from './models.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------- Rideau d'eau ----------------
const fallVert = /* glsl */`
varying vec2 vUv; varying vec3 vWorld;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const fallFrag = /* glsl */`
uniform float uTime; uniform vec3 uLight; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
varying vec2 vUv; varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
void main() {
  float u = vUv.x, v = vUv.y;                  // v = 0 en haut, 1 en bas
  float streak = noise(vec2(u * 38.0, v * 3.0 - uTime * 2.6)) * 0.6 + noise(vec2(u * 90.0, v * 7.0 - uTime * 3.4)) * 0.4;
  float foamTop = 1.0 - smoothstep(0.0, 0.12, v);
  float foamBot = smoothstep(0.75, 1.0, v);
  vec3 deep = vec3(0.16, 0.36, 0.42), white = vec3(0.92, 0.97, 1.0);
  vec3 col = mix(deep, white, clamp(streak * 0.8 + foamTop * 0.6 + foamBot * 0.8 - 0.15, 0.0, 1.0));
  col *= uLight;
  float edge = smoothstep(0.0, 0.05, u) * smoothstep(1.0, 0.95, u);
  float alpha = (0.55 + streak * 0.35 + foamBot * 0.3) * edge;
  float fogF = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
  gl_FragColor = vec4(mix(col, uFogColor, fogF), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Dôme de roche creux avec une ouverture (une arche) vers l'entrée
function caveDome(c, mat, seed) {
  const R = c.r + 0.9;
  const geo = new THREE.SphereGeometry(1, 48, 22, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * 3 + seed, v.y * 3, v.z * 3) * 0.12 + noise3(v.x * 8 + seed, v.y * 8, v.z * 8) * 0.04;
    p.setXYZ(i, v.x * R * (1 + n), v.y * c.h * (1 + n * 0.6) - 0.3, v.z * R * (1 + n));
  }
  // découpe de l'arche : on enlève les triangles du côté de l'entrée, en bas
  const ang = Math.atan2(c.ez - c.z, c.ex - c.x);
  const keep = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    A.fromBufferAttribute(p, i); B.fromBufferAttribute(p, i + 1); C.fromBufferAttribute(p, i + 2);
    const cx = (A.x + B.x + C.x) / 3, cy = (A.y + B.y + C.y) / 3, cz = (A.z + B.z + C.z) / 3;
    let da = Math.atan2(cz, cx) - ang;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const archH = Math.min(c.h * 0.75, 3.6);
    const halfW = 2.1 / R;
    const inside = Math.abs(da) < halfW * Math.sqrt(Math.max(0, 1 - Math.pow(cy / archH, 2)));
    if (!inside) keep.push(i);
  }
  const out = new THREE.BufferGeometry();
  const pos = new Float32Array(keep.length * 9);
  keep.forEach((i, k) => { for (let j = 0; j < 9; j++) pos[k * 9 + j] = p.array[i * 3 + j]; });
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  const uv = new Float32Array(keep.length * 6);
  for (let i = 0; i < keep.length * 3; i++) { uv[i * 2] = (pos[i * 3] + pos[i * 3 + 2]) * 0.15; uv[i * 2 + 1] = pos[i * 3 + 1] * 0.15; }
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(out, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.position.set(c.x, c.floor, c.z);
  return { mesh, R, ang };
}

export class Features {
  constructor(scene, fx, audio) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.time = 0;
    const tex = stoneTexture();
    tex.repeat.set(1, 1);
    this.rockMat = new THREE.MeshStandardMaterial({ map: tex, color: '#8a857c', roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
    // gemmes du Pirate Kit, qui brillent dans le noir
    this.crystalMat = {
      grotto: new THREE.MeshStandardMaterial({ map: atlasTexture(), emissive: '#2ab4ff', emissiveIntensity: 0.55, roughness: 0.15, flatShading: true }),
      cavern: new THREE.MeshStandardMaterial({ map: atlasTexture(), emissive: '#c040ff', emissiveIntensity: 0.55, roughness: 0.2, flatShading: true }),
      green: new THREE.MeshStandardMaterial({ map: atlasTexture(), emissive: '#60ff30', emissiveIntensity: 0.45, roughness: 0.2, flatShading: true }),
    };
    const gemGeo = (n) => { const g = staticGeometry(n).clone(); g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); return g; };
    this.gemGeos = { grotto: gemGeo('Gem_Blue'), cavern: gemGeo('Gem_Pink'), green: gemGeo('Gem_Green') };
    this.colliders = [];
    this.buildCaves();
    this.buildWaterfall();
    this.buildRelic();
  }

  // ---------------- Grottes ----------------
  buildCaves() {
    const rand = seededRandom(99);
    CAVES.forEach((c, ci) => {
      const g = new THREE.Group();
      this.scene.add(g);
      const { mesh, R, ang } = caveDome(c, this.rockMat, ci * 10);
      g.add(mesh);
      this.colliders.push({ c, R, ang });
      // blocs de roche autour de l'arche et sur le dôme
      for (let i = 0; i < 14; i++) {
        const a = rand() * Math.PI * 2;
        let da = Math.atan2(Math.sin(a - ang), Math.cos(a - ang));
        if (Math.abs(da) < 0.45) continue;
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 + rand() * 1.3, 0), this.rockMat);
        b.position.set(c.x + Math.cos(a) * (R + 0.4), c.floor + rand() * 1.2, c.z + Math.sin(a) * (R + 0.4));
        b.rotation.set(rand() * 3, rand() * 3, 0);
        b.castShadow = true;
        g.add(b);
      }
      // stalactites et cristaux lumineux
      const cm = this.crystalMat[c.id];
      for (let i = 0; i < 16; i++) {
        const a = rand() * Math.PI * 2, d = rand() * (R - 1.5);
        const ceil = c.floor + c.h * Math.sqrt(Math.max(0.05, 1 - Math.pow(d / R, 2))) - 0.5;
        const len = 0.4 + rand() * 1.2;
        const st = new THREE.Mesh(new THREE.ConeGeometry(0.12 + rand() * 0.1, len, 5), this.rockMat);
        st.rotation.x = Math.PI;
        st.position.set(c.x + Math.cos(a) * d, ceil - len / 2, c.z + Math.sin(a) * d);
        g.add(st);
      }
      for (let i = 0; i < 9; i++) {
        let a = rand() * Math.PI * 2;
        if (Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang))) < 0.6) a += Math.PI;
        const d = R - 1.0 - rand() * 0.6;
        const cluster = new THREE.Group();
        cluster.position.set(c.x + Math.cos(a) * d, c.floor + rand() * 0.6, c.z + Math.sin(a) * d);
        for (let k = 0; k < 4; k++) {
          const kind = c.id === 'cavern' && k === 3 ? 'green' : c.id;
          const cr = new THREE.Mesh(this.gemGeos[kind], kind === 'green' ? this.crystalMat.green : cm);
          cr.scale.setScalar(0.7 + rand() * 0.9);
          cr.position.set((rand() - 0.5) * 0.5, -0.1, (rand() - 0.5) * 0.5);
          cr.rotation.set((rand() - 0.5) * 0.8, rand() * 3, (rand() - 0.5) * 0.8);
          cr.castShadow = true;
          cluster.add(cr);
        }
        g.add(cluster);
      }
      // champignons lumineux dans la caverne
      if (c.id === 'cavern') {
        const capMat = new THREE.MeshStandardMaterial({ color: '#7affc8', emissive: '#20d890', emissiveIntensity: 1.1 });
        const stemMat = new THREE.MeshStandardMaterial({ color: '#d8e0d0' });
        for (let i = 0; i < 12; i++) {
          const a = rand() * Math.PI * 2, d = 1 + rand() * (R - 2.5);
          const m = new THREE.Group();
          m.position.set(c.x + Math.cos(a) * d, c.floor, c.z + Math.sin(a) * d);
          const s = 0.5 + rand() * 0.8;
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.35, 6), stemMat); stem.position.y = 0.17;
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMat); cap.position.y = 0.33;
          m.add(stem, cap); m.scale.setScalar(s);
          g.add(m);
        }
      }
      const light = new THREE.PointLight(c.id === 'grotto' ? 0x5ac8ff : 0xa070ff, 7, R * 2.6, 1.4);
      light.position.set(c.x, c.floor + 2.4, c.z);
      g.add(light);
      c.light = light;
      // lumière de l'entrée de la caverne
      if (c.id === 'cavern') {
        const torch = new THREE.PointLight(0xffa040, 5, 9, 1.5);
        torch.position.set(c.x + Math.cos(ang) * (R + 0.8), c.floor + 2.2, c.z + Math.sin(ang) * (R + 0.8));
        g.add(torch);
        const fire = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 6), new THREE.MeshBasicMaterial({ color: '#ffb040' }));
        fire.position.copy(torch.position).add(new THREE.Vector3(0, -0.3, 0));
        g.add(fire);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.8, 6), new THREE.MeshStandardMaterial({ color: '#5e3d22' }));
        pole.position.copy(torch.position).add(new THREE.Vector3(0, -1.3, 0));
        g.add(pole);
        this.torch = torch;
      }
    });
  }

  // ---------------- Cascade ----------------
  buildWaterfall() {
    const top = WATER_LEVEL + CLIFF.h + 0.15, bottom = WATER_LEVEL - 0.1;
    const z0 = WATERFALL.z - 6.6, z1 = CAVES[0].z - 3.4;  // couvre aussi l'entrée de la grotte
    const zA = Math.min(z0, z1), zB = WATERFALL.z + 6.6;
    const NU = 40, NV = 24;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= NV; j++) {
      const t = j / NV;
      // courbe : l'eau jaillit un peu vers l'avant puis tombe
      const x = CLIFF.x1 + 0.1 - (CLIFF.x1 - CLIFF.x0 + 1.6) * Math.sin(t * Math.PI / 2) * (0.6 + 0.4 * t);
      const y = top + (bottom - top) * t * t * 0.6 + (bottom - top) * t * 0.4;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        pos.push(x + Math.sin(u * 17) * 0.08, y, zA + (zB - zA) * u);
        uv.push(u, t);
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + NU + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.fallUniforms = { uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) }, uFogColor: { value: new THREE.Color() }, uFogNear: { value: 30 }, uFogFar: { value: 170 } };
    const sheet = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: fallVert, fragmentShader: fallFrag, uniforms: this.fallUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    sheet.renderOrder = 2;
    this.scene.add(sheet);
    // linteau de roche au-dessus de l'entrée de la grotte
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 7.5, 3, 2, 6), this.rockMat.clone());
    lintel.material.side = THREE.FrontSide;
    lintel.material.color.set('#9a958c');
    const lp = lintel.geometry.attributes.position;
    for (let i = 0; i < lp.count; i++) { const x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i); const n = noise3(x * 1.3, y * 1.3 + 5, z * 1.3); lp.setXYZ(i, x * (1 + n * 0.15), y * (1 + n * 0.2), z); }
    lintel.geometry.computeVertexNormals();
    lintel.position.set(CLIFF.x1 - 0.2, WATER_LEVEL + CLIFF.h + 0.6, CAVES[0].z);
    lintel.castShadow = true;
    this.scene.add(lintel);
    // écume au pied
    const foam = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.55, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2;
    foam.scale.set(3, (zB - zA) / 2 + 1, 1);
    foam.position.set(CLIFF.x0 - 1.4, WATER_LEVEL + 0.02, (zA + zB) / 2);
    this.scene.add(foam);
    this.foam = foam;
    this.fallBase = { x: CLIFF.x0 - 1.4, zA, zB, y: WATER_LEVEL };
    this.mistMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.dropMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff });
    this.mistT = 0;
  }

  // ---------------- Relique ----------------
  buildRelic() {
    const g = new THREE.Group();
    const y = heightAt(RELIC_POS.x, RELIC_POS.z);
    g.position.set(RELIC_POS.x, y, RELIC_POS.z);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.9, 8), this.rockMat);
    ped.position.y = 0.45; ped.castShadow = true;
    g.add(ped);
    // la Larme de la cascade : la gemme bleue du Pirate Kit
    const tear = staticGeometry('Gem_Blue').clone();
    tear.computeBoundingBox();
    tear.translate(0, -(tear.boundingBox.min.y + tear.boundingBox.max.y) / 2, 0);
    tear.scale(0.75, 0.75, 0.75);
    this.relicMat = new THREE.MeshStandardMaterial({ map: atlasTexture(), emissive: '#30b8ff', emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.1, flatShading: true });
    this.relic = new THREE.Mesh(tear, this.relicMat);
    this.relic.position.y = 1.45;
    g.add(this.relic);
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(200,240,255,1)'); gr.addColorStop(0.3, 'rgba(80,190,255,0.5)'); gr.addColorStop(1, 'rgba(40,140,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
    this.relicGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.relicGlow.scale.setScalar(2);
    this.relic.add(this.relicGlow);
    this.relicLight = new THREE.PointLight(0x5ac8ff, 5, 7, 1.6);
    this.relicLight.position.y = 1.6;
    g.add(this.relicLight);
    this.relicGroup = g;
    this.scene.add(g);
    this.relicTaken = false;
  }
  setRelic(taken) {
    if (taken && !this.relicTaken) {
      const p = this.relic.getWorldPosition(new THREE.Vector3());
      for (let i = 0; i < 24; i++) {
        this.fx.spawn({ geo: this.fx.box, mat: this.dropMat, pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4), size: 0.05, life: 1.2, gravity: 3, spin: 6 });
      }
    }
    this.relicTaken = taken;
    this.relic.visible = !taken;
    this.relicLight.intensity = taken ? 0 : 5;
  }

  // Les parois des grottes bloquent le joueur (sauf l'entrée)
  collide(pos, radius) {
    for (const { c, R, ang } of this.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz);
      if (d > R + 1.6 || d < R - 1.6 || pos.y > c.floor + c.h) continue;
      let da = Math.atan2(dz, dx) - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < 1.9 / Math.max(d, 1)) continue;   // dans l'arche
      const inner = R - 0.75 - radius, outer = R + 0.6 + radius;
      if (d > inner && d < outer) {
        const target = d - inner < outer - d ? inner : outer;
        pos.x = c.x + dx / d * target; pos.z = c.z + dz / d * target;
      }
    }
    // la relique
    if (!this.relicTaken) {
      const dx = pos.x - RELIC_POS.x, dz = pos.z - RELIC_POS.z, d = Math.hypot(dx, dz), min = 0.6 + radius;
      if (d < min && d > 0.001) { pos.x = RELIC_POS.x + dx / d * min; pos.z = RELIC_POS.z + dz / d * min; }
    }
  }

  distToRelic(x, z) { return this.relicTaken ? Infinity : Math.hypot(x - RELIC_POS.x, z - RELIC_POS.z); }
  distToFall(x, z) {
    const b = this.fallBase;
    const dz = Math.max(0, b.zA - z, z - b.zB);
    return Math.hypot(x - b.x, dz);
  }

  update(dt, light, fog) {
    const t = (this.time += dt);
    const u = this.fallUniforms;
    u.uTime.value = t;
    u.uLight.value.copy(light);
    u.uFogColor.value.copy(fog.color); u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
    this.foam.material.opacity = 0.45 + Math.sin(t * 5) * 0.08;
    // brume et gouttes au pied de la cascade
    this.mistT -= dt;
    if (this.mistT <= 0) {
      this.mistT = 0.06;
      const b = this.fallBase;
      const z = b.zA + Math.random() * (b.zB - b.zA);
      this.fx.spawn({ geo: this.fx.sphere, mat: this.mistMat, pos: new THREE.Vector3(b.x - Math.random(), b.y + 0.2, z), vel: new THREE.Vector3(-0.8 - Math.random(), 0.8 + Math.random() * 1.2, (Math.random() - 0.5)), size: 0.4 + Math.random() * 0.5, life: 1.6, gravity: -0.3, drag: 1.2, spin: 0, puff: false });
      this.fx.spawn({ geo: this.fx.box, mat: this.dropMat, pos: new THREE.Vector3(b.x, b.y + 0.2, z), vel: new THREE.Vector3(-1 - Math.random() * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2), size: 0.04, life: 0.8, gravity: 12, spin: 0 });
    }
    // relique qui flotte
    if (!this.relicTaken) {
      this.relic.position.y = 1.45 + Math.sin(t * 1.8) * 0.08;
      this.relic.rotation.y = t;
      this.relicLight.intensity = 4.5 + Math.sin(t * 3) * 0.8;
    }
    for (const c of CAVES) if (c.light) c.light.intensity = 6.5 + Math.sin(t * 1.3 + c.x) * 0.6;
    if (this.torch) this.torch.intensity = 4.5 + Math.sin(t * 13) * 0.5 + Math.random() * 0.5;
  }
}
void ss;
