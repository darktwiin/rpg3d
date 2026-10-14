// Le Joyau : cristal lumineux que les monstres veulent détruire. Il peut être porté.
import * as THREE from 'three';
import { heightAt, GEM_HP } from './world.js';

export class Gem {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.group = new THREE.Group();
    scene.add(this.group);

    // Cristal principal + éclats autour
    const geo = new THREE.OctahedronGeometry(0.42, 0);
    geo.scale(1, 1.7, 1);
    this.mat = new THREE.MeshStandardMaterial({
      color: '#b98cff', emissive: '#7a3dff', emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1,
      flatShading: true, transparent: true, opacity: 0.92,
    });
    this.crystal = new THREE.Mesh(geo, this.mat);
    this.crystal.castShadow = true;
    this.inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0).scale(1, 1.6, 1), new THREE.MeshBasicMaterial({ color: '#f3e6ff' }));
    this.crystal.add(this.inner);
    this.shards = [];
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0).scale(1, 1.8, 1), this.mat);
      this.crystal.add(s);
      this.shards.push(s);
    }
    this.float = new THREE.Group();
    this.float.add(this.crystal);
    this.group.add(this.float);

    // Halo lumineux
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(230,200,255,0.9)'); g.addColorStop(0.25, 'rgba(160,100,255,0.35)'); g.addColorStop(1, 'rgba(120,60,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halo.scale.setScalar(3);
    this.float.add(this.halo);

    // Cercle de runes au sol
    const rc = document.createElement('canvas');
    rc.width = rc.height = 256;
    const r = rc.getContext('2d');
    r.strokeStyle = 'rgba(200,160,255,0.9)'; r.lineWidth = 4;
    r.beginPath(); r.arc(128, 128, 118, 0, Math.PI * 2); r.stroke();
    r.lineWidth = 2;
    r.beginPath(); r.arc(128, 128, 96, 0, Math.PI * 2); r.stroke();
    r.font = 'bold 22px serif'; r.fillStyle = 'rgba(220,190,255,0.95)'; r.textAlign = 'center';
    const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ';
    for (let i = 0; i < 12; i++) {
      r.save(); r.translate(128, 128); r.rotate(i / 12 * Math.PI * 2); r.fillText(runes[i], 0, -101); r.restore();
    }
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, b = a + Math.PI * 2 / 3;
      r.beginPath(); r.moveTo(128 + Math.cos(a) * 90, 128 + Math.sin(a) * 90); r.lineTo(128 + Math.cos(b) * 90, 128 + Math.sin(b) * 90); r.stroke();
    }
    this.circle = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(rc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.circle.rotation.x = -Math.PI / 2;
    this.group.add(this.circle);

    this.light = new THREE.PointLight(0xa070ff, 6, 14, 1.6);
    this.light.position.y = 1.4;
    this.float.add(this.light);

    // Petites étincelles
    const N = 40;
    const pos = new Float32Array(N * 3);
    this.sparkSeeds = Float32Array.from({ length: N }, () => Math.random() * 100);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ map: this.halo.material.map, color: 0xe0c8ff, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    this.float.add(this.sparks);

    this.state = { x: 0, z: 0, y: null, carrier: null, hp: GEM_HP };
    this.hitT = 9;
    this.time = 0;
    this.pos = new THREE.Vector3();
  }

  set(st) {
    Object.assign(this.state, st);
    if (this.state.hp > 0 && this.broken) { this.broken = false; this.float.visible = true; }
  }

  // Le Joyau vole en éclats
  shatter() {
    if (this.broken) return;
    this.broken = true;
    const p = this.crystal.getWorldPosition(new THREE.Vector3());
    this.float.visible = false;
    for (let i = 0; i < 40; i++) {
      this.fx.spawn({
        geo: this.fx.sphere, mat: this.mat, pos: p,
        vel: new THREE.Vector3((Math.random() - 0.5) * 9, 2 + Math.random() * 6, (Math.random() - 0.5) * 9),
        size: 0.05 + Math.random() * 0.12, life: 3 + Math.random() * 2, gravity: 14, bounce: 0.4, spin: 10,
      });
    }
    this.fx.puff(p, 0xb98cff, 10, 0.6);
  }

  hit() {
    this.hitT = 0;
    const p = this.crystal.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 8; i++) {
      this.fx.spawn({
        geo: this.fx.box, mat: this.shardMat ||= new THREE.MeshBasicMaterial({ color: 0xc9a2ff }), pos: p,
        vel: new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4),
        size: 0.04 + Math.random() * 0.05, life: 1, gravity: 12,
      });
    }
  }

  // carrierPos : position où le joyau est tenu (ou null s'il est posé)
  update(dt, carrierPos) {
    const t = (this.time += dt);
    this.hitT += dt;
    const st = this.state;
    const hpK = Math.max(0, st.hp / GEM_HP);
    let base;
    if (carrierPos) {
      this.group.position.copy(carrierPos);
      this.float.position.y = 0;
      this.float.scale.setScalar(0.55);
      this.circle.visible = false;
      base = carrierPos;
    } else {
      const gy = st.y != null ? st.y : heightAt(st.x, st.z);
      this.group.position.set(st.x, gy + 0.03, st.z);
      this.float.position.y = 1.25 + Math.sin(t * 1.5) * 0.12;
      this.float.scale.setScalar(1);
      this.circle.visible = true;
      this.circle.rotation.z = t * 0.15;
      this.circle.material.opacity = 0.55 + Math.sin(t * 2) * 0.15;
    }
    this.pos.copy(this.group.position);
    this.crystal.rotation.y = t * 0.6;
    const shake = this.hitT < 0.3 ? (0.3 - this.hitT) * 0.4 : 0;
    this.crystal.position.set((Math.random() - 0.5) * shake, 0, (Math.random() - 0.5) * shake);
    this.shards.forEach((s, i) => {
      const a = t * 0.9 + i / 5 * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.62, Math.sin(t * 2 + i) * 0.25, Math.sin(a) * 0.62);
      s.rotation.y = -t;
    });
    // Couleur : vire au rouge quand il est abîmé, flash blanc quand il est frappé
    const flash = this.hitT < 0.2 ? 1 - this.hitT / 0.2 : 0;
    this.mat.color.setRGB(0.73 + (1 - hpK) * 0.25, 0.55 * hpK + 0.2, 1.0 * hpK + 0.3);
    this.mat.emissive.setRGB(0.48 + flash * 0.5 + (1 - hpK) * 0.3, 0.24 * hpK + flash * 0.5, 1.0 * hpK + flash * 0.5);
    const pulse = 0.8 + Math.sin(t * 3) * 0.2;
    this.light.intensity = (5 + flash * 10) * pulse;
    this.light.color.setRGB(0.63 + (1 - hpK) * 0.35, 0.44 * hpK + 0.1, 1.0 * hpK + 0.2);
    this.halo.material.opacity = 0.7 * pulse;
    const sp = this.sparks.geometry.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const s = this.sparkSeeds[i];
      const life = (t * 0.4 + s) % 1;
      const a = s * 7 + t * 0.5;
      const r = 0.5 + (s % 1) * 0.8;
      sp.setXYZ(i, Math.cos(a) * r, -0.8 + life * 2.2, Math.sin(a) * r);
    }
    sp.needsUpdate = true;
    return base;
  }
}
