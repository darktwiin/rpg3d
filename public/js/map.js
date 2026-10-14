// Carte du monde (touche M) et mini-carte (coin de l'écran).
import * as THREE from 'three';
import { heightAt, WATER_LEVEL, WORLD_LIMIT, riverDist } from './world.js';
import { groundColor } from './terrain.js';

const WORLD = 200; // la carte couvre de -100 à +100 m

export class WorldMap {
  constructor() {
    // Image du terrain calculée une fois (2 pixels par mètre)
    const S = 400;
    this.terrain = document.createElement('canvas');
    this.terrain.width = this.terrain.height = S;
    const ctx = this.terrain.getContext('2d');
    const img = ctx.createImageData(S, S);
    const c = new THREE.Color();
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const x = px / S * WORLD - WORLD / 2, z = py / S * WORLD - WORLD / 2;
      const h = heightAt(x, z);
      if (h < WATER_LEVEL && riverDist(x, z) < 8) {
        const d = WATER_LEVEL - h;
        c.setRGB(0.12 - d * 0.04, 0.32 - d * 0.06, 0.45 - d * 0.05);
      } else {
        groundColor(x, z, c);
        // ombrage du relief
        const sh = (heightAt(x + 1, z + 1) - h) * -0.25;
        c.r += sh; c.g += sh; c.b += sh;
        c.convertLinearToSRGB();
        c.multiplyScalar(0.88);
      }
      if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) c.multiplyScalar(0.45);
      const i = (py * S + px) * 4;
      img.data[i] = c.r * 255; img.data[i + 1] = c.g * 255; img.data[i + 2] = c.b * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // data : { me, others, monsters, resources, buildings, gem, camYaw }
  drawFull(canvas, data, tpMode) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, k = W / WORLD;
    ctx.drawImage(this.terrain, 0, 0, W, W);
    const P = (x, z) => [(x + WORLD / 2) * k, (z + WORLD / 2) * k];
    // grille
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
    for (let g = -100; g <= 100; g += 20) {
      const [a] = P(g, 0); ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(a, W); ctx.stroke();
      const [, b] = P(0, g); ctx.beginPath(); ctx.moveTo(0, b); ctx.lineTo(W, b); ctx.stroke();
    }
    this.drawItems(ctx, data, P, k, 1.4);
    // boussole
    ctx.fillStyle = '#f0c96a'; ctx.font = 'bold 22px Georgia'; ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 26);
    if (tpMode) {
      ctx.fillStyle = 'rgba(240,201,106,0.9)'; ctx.font = 'bold 18px system-ui';
      ctx.fillText('Clique pour te téléporter', W / 2, W - 16);
    }
  }

  drawMini(canvas, data) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, R = 32; // rayon visible en mètres
    const k = W / (R * 2);
    const me = data.me;
    ctx.save();
    ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    // La mini-carte tourne avec la caméra : l'avant est toujours en haut
    const fx = -Math.sin(data.camYaw), fz = -Math.cos(data.camYaw);
    const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    ctx.rotate(rot);
    const tk = this.terrain.width / WORLD;
    ctx.drawImage(this.terrain, (me.x - R + WORLD / 2) * tk, (me.z - R + WORLD / 2) * tk, R * 2 * tk, R * 2 * tk, -W / 2, -W / 2, W, W);
    const P = (x, z) => [(x - me.x) * k, (z - me.z) * k];
    this.drawItems(ctx, data, P, k, 1, -rot);
    ctx.restore();
    this.rot = rot;
  }

  drawItems(ctx, d, P, k, scale, textRot = 0) {
    const dot = (x, z, r, fill, stroke) => {
      const [a, b] = P(x, z);
      ctx.beginPath(); ctx.arc(a, b, r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    };
    for (const r of d.resources) {
      if (!r.alive) continue;
      if (r.kind === 'tree') dot(r.x, r.z, Math.max(1.5, 1.3 * k * scale * 0.6), r.isPine ? '#1f4a24' : r.autumn ? '#b4621e' : '#2e6b28');
      else dot(r.x, r.z, Math.max(1.5, r.size * k * 0.7), '#9a958d', '#555');
    }
    for (const b of d.buildings) {
      const [a, c] = P(b.x, b.z);
      ctx.fillStyle = b.type === 'roof' ? 'rgba(90,80,70,0.85)' : b.type === 'floor' ? 'rgba(170,120,70,0.9)' : '#5a3a1a';
      if (b.type === 'wall') {
        const w = b.rot ? 0.35 * k : 2 * k, h = b.rot ? 2 * k : 0.35 * k;
        ctx.fillRect(a - w / 2, c - h / 2, Math.max(w, 2), Math.max(h, 2));
      } else ctx.fillRect(a - k, c - k, 2 * k, 2 * k);
    }
    // Joyau
    {
      const [a, b] = P(d.gem.x, d.gem.z);
      const s = 7 * scale;
      ctx.save(); ctx.translate(a, b);
      ctx.shadowColor = '#b98cff'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#c49bff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.7, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    for (const m of d.monsters) dot(m.x, m.z, 3.5 * scale, '#e0332a', '#300');
    const arrow = (x, z, ry, color, size, name) => {
      const [a, b] = P(x, z);
      ctx.save(); ctx.translate(a, b);
      ctx.save();
      // l'avant du personnage est +z dans le monde (vers le bas de la carte quand ry = 0)
      ctx.rotate(-ry + Math.PI);
      ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.7, size * 0.8); ctx.lineTo(0, size * 0.4); ctx.lineTo(-size * 0.7, size * 0.8); ctx.closePath();
      ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
      if (name) {
        ctx.rotate(textRot);
        ctx.font = `bold ${11 * scale}px system-ui`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
        ctx.strokeText(name, 0, -size - 4); ctx.fillText(name, 0, -size - 4);
      }
      ctx.restore();
    };
    for (const o of d.others) arrow(o.x, o.z, o.ry, o.color, 6 * scale, scale > 1 ? o.name : null);
    arrow(d.me.x, d.me.z, d.me.ry, '#ffffff', 7 * scale, null);
  }

  // Position du monde à partir d'un clic sur la grande carte
  worldFromClick(canvas, ev) {
    const r = canvas.getBoundingClientRect();
    const u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
    return { x: u * WORLD - WORLD / 2, z: v * WORLD - WORLD / 2 };
  }
}
