// Page du héros (touche I) : caractéristiques, équipement porté, inventaire trié par rareté.
// + coffres d'objets lâchés par les monstres.
import * as THREE from 'three';
import * as W from './world.js';
import { modelIcon, propIcon, characterPortrait, prop } from './models.js';

const $ = (id) => document.getElementById(id);

// ---------- Icônes ----------
const CHEST_COL = { Knight: ['#9aa6b8', '#5d6b80'], Barbarian: ['#a8743e', '#6b4420'], Mage: ['#7a5cc8', '#4a3290'], Rogue: ['#4f9a5a', '#2f6a3a'] };
const svg = (inner) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
function slotSvg(it) {
  const c = W.RARITIES[it.r].color;
  switch (it.slot) {
    case 'hat': return svg(`<path d="M10 44 Q32 52 54 44 L48 40 Q42 14 30 10 Q34 22 22 40 Z" fill="#7a4a2a" stroke="#3a2010" stroke-width="2"/><path d="M14 44 Q32 50 50 44" fill="none" stroke="${c}" stroke-width="4"/><path d="M40 20 q10 -8 14 2" fill="none" stroke="${c}" stroke-width="3"/>`);
    case 'ring': return svg(`<circle cx="32" cy="38" r="15" fill="none" stroke="#d8b040" stroke-width="6"/><circle cx="32" cy="38" r="15" fill="none" stroke="#8a6a10" stroke-width="1.5"/><path d="M24 22 L32 12 L40 22 L32 28 Z" fill="${c}" stroke="#3a2010" stroke-width="2"/>`);
    case 'boots': return svg(`<path d="M18 10 h16 v30 l16 6 q6 2 6 8 v4 H14 v-8 Z" fill="#7a4a2a" stroke="#3a2010" stroke-width="2"/><rect x="16" y="14" width="20" height="5" fill="${c}"/><path d="M14 54 H56" stroke="#3a2010" stroke-width="3"/>`);
    case 'chest': {
      const [a, b] = CHEST_COL[it.cls] || CHEST_COL.Knight;
      return svg(`<path d="M20 8 L32 14 L44 8 L56 18 L50 28 L48 56 H16 L14 28 L8 18 Z" fill="${a}" stroke="#2a1a0a" stroke-width="2"/><path d="M32 14 V56" stroke="${b}" stroke-width="3"/><path d="M16 40 H48" stroke="${c}" stroke-width="4"/>`);
    }
  }
  return '';
}
const iconCache = new Map();
export function itemIcon(it) {
  if (it.slot === 'weapon') {
    const key = 'w' + it.cls;
    if (!iconCache.has(key)) {
      const url = it.cls === 'Knight' ? modelIcon('a_sword_1handed', 96, 0.6, 0.3) : propIcon({ Barbarian: 'x_waraxe', Mage: 'x_staff', Rogue: 'x_bow' }[it.cls] || 'x_waraxe', 96);
      iconCache.set(key, `<img src="${url}" alt="">`);
    }
    return iconCache.get(key);
  }
  return slotSvg(it);
}
const rarityBg = (r) => {
  const c = W.RARITIES[r].color;
  return `background: radial-gradient(circle at 50% 40%, ${c}55, ${c}18 70%), #f6e6c8; border-color: ${c};`;
};

// ---------- Page du héros ----------
export class HeroPage {
  constructor(ctx) {
    this.ctx = ctx;   // { profile, me, getMods, send, audio, inHub, setMode }
    this.sel = null;
    // l'info-bulle doit être hors du panneau (son ombre portée change le repère des éléments « fixed »)
    document.body.append($('item-tip'));
    $('hero-class-btn').onclick = () => { $('hero-classes').hidden = !$('hero-classes').hidden; ctx.audio.play('ui'); this.renderClasses(); };
    for (const el of document.querySelectorAll('#heropanel .slot')) {
      el.onclick = () => { const s = el.dataset.slot; if (this.ctx.profile.equip?.[s]) { ctx.send({ type: 'unequip', slot: s }); ctx.audio.play('ui'); } };
      el.onmouseenter = (e) => { const it = this.equipped(el.dataset.slot); if (it) this.tip(it, e, true); };
      el.onmouseleave = () => this.tip(null);
    }
  }
  equipped(slot) { const p = this.ctx.profile; return (p.items || []).find((i) => i.id === p.equip?.[slot]) || null; }
  wearable(it) { return !it.cls || it.cls === this.ctx.me.skin; }
  // mode : null (touche I), 'forge' (sélection multiple : fusion, fonte), 'class' (au Barbare)
  open(mode = null) {
    this.mode = mode; this.pick = new Set();
    this.ctx.setMode('hero');
    $('hero-classes').hidden = mode !== 'class';
    if (mode === 'class') this.renderClasses();
    this.render();
  }
  render() {
    const { profile: P, me } = this.ctx;
    const mods = this.ctx.getMods();
    const lvl = W.levelOf(P.xp || 0);
    if (this._skin !== me.skin) {
      this._skin = me.skin;
      $('hero-portrait').src = characterPortrait(me.skin, 180, 270);
      $('hero-face').src = characterPortrait(me.skin, 120, 150);
    }
    $('hero-name').textContent = me.name;
    $('hero-class').textContent = W.CLASS_NAMES[me.skin] + ' — ' + (W.SKINS.find((s) => s.id === me.skin)?.role || '');
    $('hero-level').textContent = `Niveau ${lvl} · ${P.xp - W.xpForLevel(lvl)} / ${W.xpForLevel(lvl + 1) - W.xpForLevel(lvl)} XP`;
    const cls = W.classOf(me.skin), g = mods.gear || { dmg: 0, hp: 0, spd: 0 };
    const row = (ico, name, val, gear) => `<div class="stat-row"><span>${ico} ${name}</span><b>${val}${gear ? `<span class="gear">${gear}</span>` : ''}</b></div>`;
    $('hero-statlist').innerHTML = [
      row('❤', 'Points de vie', mods.maxHp, g.hp ? `(+${g.hp} objets)` : ''),
      row('⚔', 'Dégâts', `${Math.round(cls.dmg * mods.dmg)}`, g.dmg ? `(+${Math.round(g.dmg)} %)` : ''),
      row('⏱', 'Vitesse d’attaque', `×${mods.atkSpeed.toFixed(2)}`),
      row('👟', 'Vitesse de déplacement', `${Math.round(mods.speed * 100)} %`, g.spd ? `(+${Math.min(40, g.spd).toFixed(1)} %)` : ''),
      row('💨', 'Endurance', mods.stamina),
      row('🛡', 'Dégâts reçus', `${Math.round(mods.armor * 100)} %`),
      row('◆', 'Éclats', P.shards),
      row('🔥', 'Férite', P.ferite || 0),
    ].join('');
    const atBarb = this.mode === 'class';
    $('hero-class-btn').disabled = !atBarb;
    $('hero-class-btn').textContent = atBarb ? `Changer de classe (${Math.min(P.shards, W.CLASS_CHANGE_COST)} ◆ · niveau remis à 1)` : 'Changer de classe : parle au Barbare du village';
    // emplacements portés
    for (const el of document.querySelectorAll('#heropanel .slot')) {
      const it = this.equipped(el.dataset.slot);
      el.classList.toggle('filled', !!it);
      el.style.cssText = el.style.cssText.replace(/background[^;]*;|border-color[^;]*;/g, '');
      if (it) { el.innerHTML = `<div class="item-ico">${itemIcon(it)}</div>`; el.setAttribute('style', el.getAttribute('style').split(';').filter((x) => /left|right|top/.test(x)).join(';') + ';' + rarityBg(it.r)); }
      else { el.innerHTML = `<div class="ph">${W.SLOT_BY_ID[el.dataset.slot].name}</div>`; el.setAttribute('style', el.getAttribute('style').split(';').filter((x) => /left|right|top/.test(x)).join(';')); }
    }
    // inventaire trié par rareté
    const items = [...(P.items || [])].sort((a, b) => b.r - a.r || b.val - a.val);
    $('hero-count').textContent = items.length;
    const worn = new Set(Object.values(P.equip || {}));
    const box = $('hero-items');
    box.innerHTML = '';
    for (const it of items) {
      const c = document.createElement('div');
      c.className = 'inv-cell' + (worn.has(it.id) ? ' worn' : '') + (this.wearable(it) ? '' : ' other') + (this.sel === it.id ? ' sel' : '') + (this.pick?.has(it.id) ? ' pick' : '');
      c.setAttribute('style', rarityBg(it.r));
      c.innerHTML = `<div class="item-ico">${itemIcon(it)}</div>`;
      c.onclick = () => {
        if (this.mode === 'forge') { this.pick.has(it.id) ? this.pick.delete(it.id) : this.pick.add(it.id); this.sel = null; }
        else this.sel = it.id;
        this.ctx.audio.play('ui'); this.render();
      };
      c.ondblclick = () => { if (this.mode !== 'forge') this.equip(it); };
      c.onmouseenter = (e) => this.tip(it, e);
      c.onmousemove = (e) => this.tip(it, e);
      c.onmouseleave = () => this.tip(null);
      box.append(c);
    }
    if (!items.length) box.innerHTML = '<div class="hint" style="grid-column:1/-1">Aucun objet pour le moment. Les monstres lâchent parfois un coffre (1 %) : plus la nuit est avancée, plus l’objet est rare.</div>';
    this.renderSel();
  }
  // Forge : fusion (5 objets identiques → rareté supérieure, 70 %) et fonte (→ férite)
  renderForge() {
    const items = this.ctx.profile.items || [];
    for (const id of this.pick) if (!items.some((i) => i.id === id)) this.pick.delete(id);
    const picked = items.filter((i) => this.pick.has(i.id));
    const key = picked[0] && W.fuseKey(picked[0]);
    const same = picked.every((i) => W.fuseKey(i) === key);
    const canFuse = picked.length === W.FUSE_COUNT && same && picked[0].r < W.RARITIES.length - 1;
    const twins = key ? items.filter((i) => W.fuseKey(i) === key) : [];
    const ferite = picked.reduce((t, i) => t + W.FERITE[i.r], 0);
    const box = $('hero-sel');
    box.innerHTML = `<div class="nm">⚒ Forge</div>
      <div>Sélection : <b>${picked.length}</b> objet${picked.length > 1 ? 's' : ''}${picked.length && !same ? ' (différents)' : ''}</div>
      <div class="hint">Fusion : ${W.FUSE_COUNT} objets identiques (type, classe, rareté) → rareté supérieure, ${Math.round(W.FUSE_CHANCE * 100)} % de réussite (sinon ils fondent).</div>
      <div class="btns">
        <button class="btn small" id="fg-five" ${picked.length === 1 && twins.length >= W.FUSE_COUNT ? '' : 'disabled'}>Choisir ${W.FUSE_COUNT} identiques</button>
        <button class="btn small primary" id="fg-fuse" ${canFuse ? '' : 'disabled'}>Fusionner</button>
        <button class="btn small ghost" id="fg-smelt" ${picked.length ? '' : 'disabled'}>Fondre (+${ferite} férite)</button>
      </div>`;
    $('fg-five').onclick = () => {
      const worn = new Set(Object.values(this.ctx.profile.equip || {}));
      const pool = [...twins].sort((a, b) => worn.has(a.id) - worn.has(b.id) || a.val - b.val);
      this.pick = new Set(pool.slice(0, W.FUSE_COUNT).map((i) => i.id)); this.ctx.audio.play('ui'); this.render();
    };
    $('fg-fuse').onclick = () => { this.ctx.send({ type: 'fuse', ids: [...this.pick] }); this.pick.clear(); };
    $('fg-smelt').onclick = () => {
      if (!$('fg-smelt').dataset.sure) { $('fg-smelt').dataset.sure = 1; $('fg-smelt').textContent = 'Sûr ? Re-clique'; return; }
      this.ctx.send({ type: 'smelt', ids: [...this.pick] }); this.pick.clear(); this.ctx.audio.play('anvil');
    };
  }
  renderSel() {
    if (this.mode === 'forge') return this.renderForge();
    const it = (this.ctx.profile.items || []).find((i) => i.id === this.sel);
    const box = $('hero-sel');
    if (!it) { box.innerHTML = '<div class="hint">Clique sur un objet pour le voir. Clique sur un emplacement pour retirer l’objet porté.</div>'; return; }
    const worn = this.ctx.profile.equip?.[it.slot] === it.id;
    box.innerHTML = `<div class="nm" style="color:${W.RARITIES[it.r].color};text-shadow:0 1px 0 #3a2010">${it.name}</div>
      <div>${W.RARITIES[it.r].name} · ${W.SLOT_BY_ID[it.slot].name}${it.cls ? ' · ' + W.CLASS_NAMES[it.cls] : ''} · nuit ${it.lvl}</div><div><b>${W.statLabel(it)}</b></div>
      <div class="btns"><button class="btn small" id="sel-eq" ${this.wearable(it) ? '' : 'disabled'}>${worn ? 'Retirer' : 'Équiper'}</button><button class="btn small ghost" id="sel-drop">Jeter</button></div>`;
    $('sel-eq').onclick = () => (worn ? this.ctx.send({ type: 'unequip', slot: it.slot }) : this.equip(it));
    $('sel-drop').onclick = () => {
      if (!$('sel-drop').dataset.sure) { $('sel-drop').dataset.sure = 1; $('sel-drop').textContent = 'Sûr ? Re-clique'; return; }
      this.ctx.send({ type: 'discard', id: it.id }); this.sel = null; this.ctx.audio.play('ui');
    };
  }
  equip(it) {
    if (!this.wearable(it)) { this.ctx.toast(`Objet pour la classe ${W.CLASS_NAMES[it.cls]}`); return; }
    this.ctx.send({ type: 'equip', id: it.id });
    this.ctx.audio.play('gemPick');
  }
  renderClasses() {
    const box = $('hero-classes');
    box.innerHTML = '';
    for (const s of W.SKINS) {
      const b = document.createElement('button');
      b.className = 'btn small' + (s.id === this.ctx.me.skin ? ' primary' : '');
      b.textContent = s.name;
      b.title = s.role;
      b.disabled = s.id === this.ctx.me.skin;
      b.onclick = () => { this.ctx.send({ type: 'setClass', skin: s.id }); $('hero-classes').hidden = true; };
      box.append(b);
    }
  }
  tip(it, e, isWorn = false) {
    const el = $('item-tip');
    if (!it) { el.hidden = true; return; }
    const cur = !isWorn ? this.equipped(it.slot) : null;
    let cmp = '';
    if (cur && cur.id !== it.id && cur.stat === it.stat) {
      const d = Math.round((it.val - cur.val) * 10) / 10;
      cmp = `<div class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲ +' : '▼ '}${d} par rapport à « ${cur.name} »</div>`;
    }
    el.innerHTML = `<div class="nm" style="color:${W.RARITIES[it.r].color}">${it.name}</div><div>${W.RARITIES[it.r].name} · ${W.SLOT_BY_ID[it.slot].name}${it.cls ? ' · ' + W.CLASS_NAMES[it.cls] : ''}</div>
      <div><b>${W.statLabel(it)}</b></div>${cmp}${this.wearable(it) ? '' : `<div class="down">Réservé à la classe ${W.CLASS_NAMES[it.cls]}</div>`}<div style="opacity:.7">Trouvé à la nuit ${it.lvl}</div>`;
    el.hidden = false;
    const x = Math.min(innerWidth - 270, e.clientX + 14), y = Math.min(innerHeight - 130, e.clientY + 14);
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
}

// ---------- Coffres au sol ----------
export class Loots {
  constructor(scene) { this.scene = scene; this.map = new Map(); this.t = 0; }
  add(l) {
    if (this.map.has(l.id)) return;
    const g = new THREE.Group();
    const chest = prop(W.RARITIES[l.item.r] && l.item.r >= 4 ? 'd_chest_gold' : 'd_chest', 0.5);
    g.add(chest);
    const col = new THREE.Color(W.RARITIES[l.item.r].color);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 6, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 3;
    g.add(beam);
    const light = new THREE.PointLight(col, 2.5, 6);
    light.position.y = 1;
    g.add(light);
    g.position.set(l.x, l.y, l.z);
    this.scene.add(g);
    this.map.set(l.id, { ...l, g, beam, chest, sent: -9 });
  }
  remove(id) { const l = this.map.get(id); if (!l) return; this.scene.remove(l.g); this.map.delete(id); }
  clear() { for (const id of [...this.map.keys()]) this.remove(id); }
  // ramassage automatique en marchant dessus
  update(dt, pos, send) {
    this.t += dt;
    for (const l of this.map.values()) {
      l.chest.rotation.y += dt * 0.8;
      l.chest.position.y = 0.15 + Math.sin(this.t * 3) * 0.08;
      l.beam.material.opacity = 0.25 + Math.sin(this.t * 4) * 0.1;
      if (pos && Math.hypot(pos.x - l.x, pos.z - l.z) < 1.6 && this.t - l.sent > 0.8) { l.sent = this.t; send({ type: 'lootTake', id: l.id }); }
    }
  }
}
