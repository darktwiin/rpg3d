// ============================================================================
// Audio entièrement généré par le code (aucun fichier son) :
// - musique douce le jour, tension au crépuscule, horreur la nuit
// - ambiance : vent, oiseaux, rivière, grillons, hibou
// - bruitages : épée, hache, pioche, arbres, rochers, constructions, monstres…
// ============================================================================

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 1, music: 0.6, amb: 0.7, sfx: 0.8 };
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
    this.phaseK = { day: 1, dusk: 0, night: 0 };
  }

  // Doit être appelé après un clic de l'utilisateur (règle des navigateurs)
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 2.2;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master); this.ambBus.connect(this.master); this.sfxBus.connect(this.master);

    // Réverbération (salle générée)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.55;
    this.reverb.connect(this.reverbOut).connect(this.master);
    this.musicVerb = ctx.createGain(); this.musicVerb.gain.value = 1;
    this.musicVerb.connect(this.reverb);
    this.sfxVerb = ctx.createGain(); this.sfxVerb.gain.value = 1;
    this.sfxVerb.connect(this.reverb);

    // Écho pour les notes de la mélodie
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.64;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delayOut = ctx.createGain(); this.delayOut.gain.value = 0.5;
    dlp.connect(this.delayOut);

    // Couches musicales
    this.dayMix = ctx.createGain(); this.duskMix = ctx.createGain(); this.nightMix = ctx.createGain();
    for (const g of [this.dayMix, this.duskMix, this.nightMix]) { g.gain.value = 0; g.connect(this.musicBus); g.connect(this.musicVerb); }
    this.delayOut.connect(this.dayMix);

    this.noiseBuf = this.makeNoise(3);
    this.setVolumes(this.vol);
    this.startContinuous();
    this.beat = 0; this.nextBeat = ctx.currentTime + 0.2;
    this.nightBeat = 0; this.nextNight = ctx.currentTime + 0.5;
    this.events = { bird: 1, cricket: 1, owl: 20, nightFx: 4, whisper: 9 };
    this.melodyNote = 4;
  }

  impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  makeNoise(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.5; }
    return buf;
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(2.2 * this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 1.6, t, 0.05);
    this.musicVerb.gain.setTargetAtTime(this.vol.music, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.amb * 0.8, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx * 1.5, t, 0.05);
    this.sfxVerb.gain.setTargetAtTime(this.vol.sfx * 0.6, t, 0.05);
  }

  setListener(x, y, z, rx, rz) { Object.assign(this.listener, { x, y, z, rx, rz }); }

  // ---------- Petits outils ----------
  osc(type, freq, t0, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    o.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  gain(v, dest) { const g = this.ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  filter(type, freq, q, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; if (q != null) f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }
  noise(t0, dur, dest, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true; s.playbackRate.value = rate;
    s.connect(dest); s.start(t0, Math.random() * 2); s.stop(t0 + dur + 0.05);
    return s;
  }
  // Enveloppe : montée a, puis descente exponentielle sur d
  env(g, t0, peak, a, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  panner(pan, dest) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (!p) return dest;
    p.pan.value = clamp(pan, -1, 1); p.connect(dest);
    return p;
  }

  // Sortie positionnée dans l'espace (volume selon la distance, gauche/droite)
  spatial(pos, range = 9, verb = 0.25) {
    const L = this.listener;
    let g = 1, pan = 0;
    if (pos) {
      const dx = pos.x - L.x, dy = (pos.y ?? L.y) - L.y, dz = pos.z - L.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range * 8) return null;
      g = 1 / (1 + (d / range) * (d / range));
      pan = d > 0.5 ? clamp((dx * L.rx + dz * L.rz) / d, -1, 1) * 0.8 : 0;
    }
    const out = this.gain(g);
    out.connect(this.panner(pan, this.sfxBus));
    if (verb > 0) { const v = this.gain(verb * (pos ? 0.6 + (1 - g) * 0.8 : 1)); out.connect(v); v.connect(this.sfxVerb); }
    return out;
  }

  // ======================= Couches continues =======================
  startContinuous() {
    const ctx = this.ctx, t = ctx.currentTime;
    // Vent
    this.windF = this.filter('bandpass', 500, 0.6);
    this.windG = this.gain(0.05, this.ambBus);
    this.windF.connect(this.windG);
    const ws = ctx.createBufferSource(); ws.buffer = this.noiseBuf; ws.loop = true; ws.connect(this.windF); ws.start();
    this.windHi = this.filter('bandpass', 1800, 4);
    this.windHiG = this.gain(0.0, this.ambBus);
    this.windHi.connect(this.windHiG);
    const ws2 = ctx.createBufferSource(); ws2.buffer = this.noiseBuf; ws2.loop = true; ws2.playbackRate.value = 0.7; ws2.connect(this.windHi); ws2.start();
    // Rivière
    this.riverF = this.filter('lowpass', 1100, 0.5);
    const rh = this.filter('highpass', 180, 0.5, this.riverF);
    this.riverG = this.gain(0, this.ambBus);
    // grondement de la cascade
    this.fallG = this.gain(0, this.ambBus);
    const fl = this.filter('lowpass', 900, 0.5, this.fallG);
    const fs = ctx.createBufferSource(); fs.buffer = this.noiseBuf; fs.loop = true; fs.playbackRate.value = 0.6; fs.connect(fl); fs.start();
    this.riverF.connect(this.riverG);
    const rs = ctx.createBufferSource(); rs.buffer = this.noiseBuf; rs.loop = true; rs.playbackRate.value = 1.3; rs.connect(rh); rs.start();
    // Bourdon du crépuscule (monte doucement)
    this.duskF = this.filter('lowpass', 200, 2, this.duskMix);
    this.duskOsc = [55, 58.27, 82.4].map((f) => this.osc('sawtooth', f, t, 1e6, this.duskF));
    this.duskRise = this.osc('sine', 220, t, 1e6, this.gain(0.05, this.duskMix));
    // Bourdons de la nuit
    this.nightF = this.filter('lowpass', 260, 3, this.gain(0.9, this.nightMix));
    this.nightOsc = [36.7, 55].map((f) => this.osc('sawtooth', f, t, 1e6, this.gain(0.2, this.nightF)));
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lg = this.gain(140); lfo.connect(lg); lg.connect(this.nightF.frequency); lfo.start();
    this.nightHigh = this.gain(0.0, this.nightMix);
    for (const f of [1318.5, 1396.9, 987.8]) {
      const g = this.gain(0.012, this.nightHigh);
      this.osc('sine', f, t, 1e6, g);
      const l = ctx.createOscillator(); l.frequency.value = rnd(0.05, 0.13);
      const lgg = this.gain(0.012); l.connect(lgg); lgg.connect(g.gain); l.start();
    }
    // Battement de cœur quand les monstres approchent
    this.heartK = 0; this.nextHeart = t;
  }

  // ======================= Mise à jour (chaque image) =======================
  // phase : { day, dusk, night } (0..1), duskK : avancée du crépuscule, wind : 0..1,
  // riverDist : distance à la rivière, danger : 0..1 (monstres proches)
  update(dt, { day = 1, dusk = 0, night = 0, duskK = 0, wind = 0.5, riverDist = 99, danger = 0, fall = 999 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.phaseK = { day, dusk, night };
    this.dayMix.gain.setTargetAtTime(day * 0.9, t, 1.5);
    this.duskMix.gain.setTargetAtTime(dusk * 0.5, t, 1.5);
    this.nightMix.gain.setTargetAtTime(night * 0.75, t, 2);
    this.duskF.frequency.setTargetAtTime(200 + duskK * 900, t, 0.5);
    this.duskRise.frequency.setTargetAtTime(220 * Math.pow(2, duskK * 1.2), t, 0.5);
    this.nightHigh.gain.setTargetAtTime(0.5 + danger * 0.8, t, 1);
    // Vent : plus fort la nuit, sifflements avec les rafales
    this.windF.frequency.setTargetAtTime(350 + wind * 650, t, 0.3);
    this.windG.gain.setTargetAtTime((0.02 + wind * 0.07) * (1 + night * 0.4), t, 0.3);
    this.windHiG.gain.setTargetAtTime(Math.max(0, wind - 0.6) * 0.04 * (0.5 + night), t, 0.5);
    this.windHi.frequency.setTargetAtTime(1400 + wind * 900, t, 0.5);
    // Rivière
    this.riverG.gain.setTargetAtTime(clamp(1 - riverDist / 28, 0, 1) ** 1.6 * 0.22, t, 0.3);
    this.fallG.gain.setTargetAtTime(clamp(1 - fall / 45, 0, 1) ** 1.8 * 0.5, t, 0.3);

    // Musique : jour (thème folk, flûte + luth), crépuscule (tension), nuit (tambours de guerre)
    this.danger = danger;
    const BEAT = 60 / 92;
    while (this.nextBeat < t + 0.25) {
      if (day > 0.02) this.dayBeat(this.beat, this.nextBeat, BEAT);
      if (dusk > 0.02 && this.beat % 2 === 0) this.duskBeat(this.beat >> 1, this.nextBeat, BEAT * 2, duskK);
      this.beat++;
      this.nextBeat += BEAT;
    }
    const NB = 60 / 104;
    while (this.nextNight < t + 0.3) {
      if (night > 0.02) this.nightBar(this.nightBeat, this.nextNight, NB);
      this.nightBeat++;
      this.nextNight += NB;
    }
    // Battement de cœur
    this.heartK += (danger - this.heartK) * Math.min(1, dt * 2);
    if (this.heartK > 0.08 && t > this.nextHeart) {
      this.heartbeat(t + 0.05, this.heartK);
      this.nextHeart = t + 1.2 - this.heartK * 0.55;
    }

    // Ambiance aléatoire
    const E = this.events;
    for (const k in E) E[k] -= dt;
    if (E.bird < 0) { E.bird = rnd(0.4, 2.6); if (day > 0.4) this.bird(day); }
    if (E.cricket < 0) { E.cricket = rnd(0.3, 1.2); if (night > 0.3 || dusk > 0.6) this.cricket(); }
    if (E.owl < 0) { E.owl = rnd(18, 40); if (night > 0.5) this.owl(); }
    if (E.nightFx < 0) { E.nightFx = rnd(5, 11); if (night > 0.4) this.nightEvent(); }
    if (E.whisper < 0) { E.whisper = rnd(10, 22); if (night > 0.5) this.whisper(); }
  }

  // ---------- Jour : petite ballade folk en ré dorien (flûte, luth, bourdon, tambourin) ----------
  // 4 temps par mesure, 16 mesures : A (flûte) puis B (luth seul, plus calme)
  dayBeat(b, t, BEAT) {
    const PROG = [[50, 0], [48, 1], [46, 2], [48, 1], [50, 0], [45, 3], [46, 2], [45, 3]]; // Rém, Do, Sib, Do, Rém, La, Sib, La
    const CHORD = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7]];
    const bar = Math.floor(b / 4), beat = b % 4;
    const [root, ci] = PROG[bar % 8];
    const ch = CHORD[ci].map((i) => root + i);
    const section = Math.floor(bar / 8) % 2;  // 0 : flûte, 1 : luth seul
    if (beat === 0) {
      this.drone(root - 12, t, BEAT * 4.2);
      if (bar % 8 === 0 && Math.random() < 0.6) this.chime(root + 36, t);
    }
    // luth : arpège en croches
    const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
    for (let i = 0; i < 2; i++) {
      const k = ARP[(beat * 2 + i) % 8];
      const n = ch[k] + 12 + (k === 0 && i === 1 ? 12 : 0);
      if (section === 1 || i === 0 || Math.random() < 0.7) this.lute(n, t + i * BEAT / 2, section ? 0.05 : 0.035);
    }
    // tambourin doux
    if (beat === 0 || beat === 2) this.frameDrum(t, beat === 0 ? 0.11 : 0.06);
    if (section === 0 && Math.random() < 0.25) this.shaker(t + BEAT / 2);
    // flûte : phrases écrites (degrés de la gamme, durée en croches)
    if (section === 0 && beat === 0) {
      const PH = this._phrases ||= [
        [[4, 2], [3, 1], [2, 1], [1, 2], [2, 2]], [[2, 3], [4, 1], [5, 2], [4, 2]], [[7, 2], [6, 1], [5, 1], [4, 4]],
        [[4, 1], [5, 1], [6, 2], [5, 2], [3, 2]], [[2, 2], [4, 2], [3, 1], [2, 1], [0, 2]], [[0, 4], [-1, 2], [0, 2]],
        [[5, 2], [4, 2], [2, 2], [4, 2]], [[3, 3], [2, 1], [1, 2], [-1, 2]],
      ];
      const SC = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81];
      const base = SC.indexOf(root + 12) >= 0 ? SC.indexOf(root + 12) : SC.findIndex((x) => x >= root + 12);
      const ph = PH[(bar + (Math.random() < 0.3 ? 4 : 0)) % PH.length];
      let tt = t;
      for (const [deg, len] of ph) {
        const i = clamp(base + deg + 2, 0, SC.length - 1);
        this.flute(SC[i] + 12, tt, len * BEAT / 2);
        tt += len * BEAT / 2;
      }
    }
  }
  pad(note, t, dur, vol, dest) {
    const g = this.gain(0, dest);
    const f = this.filter('lowpass', 1100, 0.3, g);
    this.osc('triangle', mtof(note), t, dur, f).detune.value = rnd(-6, 6);
    this.osc('sine', mtof(note) * 1.002, t, dur, f);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(vol * 0.8, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  }
  drone(note, t, dur) {
    for (const [n, v] of [[note, 0.05], [note + 7, 0.025], [note + 12, 0.015]]) {
      const g = this.gain(0, this.dayMix);
      const f = this.filter('lowpass', 700, 0.4, g);
      this.osc('triangle', mtof(n), t, dur, f).detune.value = rnd(-4, 4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + 0.6);
      g.gain.linearRampToValueAtTime(v * 0.7, t + dur - 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
    }
  }
  lute(note, t, vol) {
    const g = this.gain(0, this.dayMix);
    const f = this.filter('lowpass', 3200, 1.5, g);
    f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.4);
    const fr = mtof(note);
    this.osc('triangle', fr, t, 1.2, f);
    this.osc('square', fr * 1.003, t, 0.25, this.gain(0.25, f));
    this.env(g, t, vol, 0.003, 1.1);
  }
  flute(note, t, dur) {
    const g = this.gain(0, this.dayMix); g.connect(this.delay);
    const fr = mtof(note);
    const o = this.osc('sine', fr, t, dur + 0.1, g);
    this.osc('triangle', fr * 2, t, dur + 0.1, this.gain(0.08, g));
    const vib = this.ctx.createOscillator(); vib.frequency.value = 5.2;
    const vg = this.gain(0); vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(t + dur + 0.1);
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(fr * 0.008, t + Math.min(0.4, dur));
    const ng = this.gain(0, g); this.noise(t, 0.12, this.filter('bandpass', fr * 2, 3, ng)); this.env(ng, t, 0.3, 0.01, 0.1);
    const v = 0.04;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.05);
    g.gain.setValueAtTime(v * 0.85, t + Math.max(0.06, dur - 0.08));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.08);
  }
  frameDrum(t, v) {
    const g = this.gain(0, this.dayMix);
    const o = this.osc('sine', 110, t, 0.3, g); o.frequency.exponentialRampToValueAtTime(70, t + 0.15);
    this.env(g, t, v, 0.004, 0.22);
    const ng = this.gain(0, this.dayMix); this.noise(t, 0.08, this.filter('bandpass', 900, 1, ng)); this.env(ng, t, v * 0.3, 0.002, 0.06);
  }
  shaker(t) {
    const g = this.gain(0, this.dayMix);
    this.noise(t, 0.06, this.filter('highpass', 6000, 0.7, g));
    this.env(g, t, 0.03, 0.005, 0.05);
  }
  chime(note, t) {
    [0, 7, 12].forEach((d, i) => {
      const g = this.gain(0, this.dayMix); g.connect(this.delay);
      this.osc('sine', mtof(note + d), t + i * 0.18, 2.4, g);
      this.osc('sine', mtof(note + d) * 2.76, t + i * 0.18, 0.6, this.gain(0.12, g));
      this.env(g, t + i * 0.18, 0.025, 0.004, 2.2);
    });
  }

  // ---------- Crépuscule : pulsation qui accélère ----------
  duskBeat(b, t, BEAT, k) {
    // tic-tac d'horloge
    for (let i = 0; i < 2; i++) {
      const tt = t + i * BEAT / 2;
      const g = this.gain(0, this.duskMix);
      const f = this.filter('bandpass', i ? 2400 : 3200, 8, g);
      this.noise(tt, 0.05, f);
      this.env(g, tt, 0.25 + k * 0.25, 0.002, 0.04);
    }
    // basse qui pulse
    const g = this.gain(0, this.duskMix);
    const lp = this.filter('lowpass', 300 + k * 500, 4, g);
    this.osc('sawtooth', mtof(33), t, BEAT, lp);
    this.env(g, t, 0.12 + k * 0.1, 0.01, BEAT * 0.8);
    if (k > 0.5 && b % 2 === 0) this.heartbeat(t + BEAT * 0.25, k * 0.8, this.duskMix);
    // accords dissonants qui montent
    if (b % 8 === 0) {
      const base = 57 + Math.floor(k * 4);
      for (const n of [base, base + 1, base + 6]) this.pad(n, t, BEAT * 8, 0.012 + k * 0.012, this.duskMix);
    }
  }

  // ---------- Nuit : ostinato grave, chœur sombre, tambours de guerre (plus forts quand les monstres approchent) ----------
  nightBar(b, t, NB) {
    const d = this.danger || 0;
    const bar = Math.floor(b / 8), step = b % 8;
    const ROOTS = [38, 38, 34, 36];   // Ré, Ré, Sib, Do
    const r = ROOTS[bar % 4];
    // ostinato de cordes (croches) : 1-1-5-1-b6-5-1-b3
    const OST = [0, 0, 7, 0, 8, 7, 0, 3];
    const g = this.gain(0, this.nightMix);
    const f = this.filter('lowpass', 380 + d * 900, 2, g);
    this.osc('sawtooth', mtof(r + OST[step]), t, NB * 0.9, f);
    this.osc('sawtooth', mtof(r + OST[step] - 12), t, NB * 0.9, this.gain(0.5, f));
    this.env(g, t, step === 0 ? 0.06 : 0.04, 0.01, NB * 0.8);
    // chœur (voyelle « ah » : dents de scie filtrées en formants)
    if (step === 0 && bar % 2 === 0) {
      for (const n of [r + 24, r + 27, r + 31]) {
        const cg = this.gain(0, this.nightMix);
        for (const [fq, q] of [[750, 8], [1150, 10]]) {
          const o = this.osc('sawtooth', mtof(n), t, NB * 16, this.filter('bandpass', fq, q, cg));
          o.detune.value = rnd(-8, 8);
        }
        cg.gain.setValueAtTime(0.0001, t);
        cg.gain.linearRampToValueAtTime(0.05, t + NB * 6);
        cg.gain.linearRampToValueAtTime(0.0001, t + NB * 16);
      }
    }
    // tambours : motif lourd, plus présent avec le danger
    const DR = [1, 0, 0, 0.5, 0, 0, 0.7, 0.4];
    if (DR[step]) this.taiko(t, DR[step] * (0.35 + d * 0.65));
    if (d > 0.4 && (step === 2 || step === 5)) this.taiko(t, 0.2 * d, 160);
    // cloche funèbre
    if (b % 64 === 0) this.bell(r + 24, t);
    if (bar % 4 === 3 && step === 4 && Math.random() < 0.5) this.musicBox(t);
  }
  taiko(t, v, f0 = 90) {
    const g = this.gain(0, this.nightMix);
    const o = this.osc('sine', f0, t, 0.6, g); o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.35);
    this.env(g, t, v, 0.004, 0.5);
    const ng = this.gain(0, this.nightMix); this.noise(t, 0.12, this.filter('lowpass', 1200, 1, ng)); this.env(ng, t, v * 0.35, 0.002, 0.1);
  }
  bell(note, t) {
    for (const [m, v] of [[1, 0.05], [2.4, 0.03], [3.0, 0.02], [4.5, 0.012]]) {
      const g = this.gain(0, this.nightMix);
      this.osc('sine', mtof(note) * m, t, 6, g);
      this.env(g, t, v, 0.005, 5.5);
    }
  }
  musicBox(t) {
    const SC = [74, 77, 81, 82, 86, 85];
    for (let i = 0; i < 4; i++) {
      const n = pick(SC), tt = t + i * 0.42;
      const g = this.gain(0, this.nightMix);
      const o = this.osc('sine', mtof(n), tt, 2, g);
      o.detune.setValueAtTime(0, tt); o.detune.linearRampToValueAtTime(-25, tt + 1.9);
      this.env(g, tt, 0.025, 0.01, 1.8);
    }
  }
  nightEvent() {
    const t = this.ctx.currentTime + 0.05;
    const kind = pick(['boom', 'scrape', 'scrape', 'drone']);
    const out = this.gain(1, this.nightMix);
    const p = this.panner(rnd(-0.8, 0.8), out);
    if (kind === 'boom') {
      const g = this.gain(0, p);
      const o = this.osc('sine', 60, t, 3, g); o.frequency.exponentialRampToValueAtTime(28, t + 2.5);
      this.env(g, t, 0.35, 0.02, 2.8);
      const ng = this.gain(0, p); this.noise(t, 1.5, this.filter('lowpass', 200, 1, ng)); this.env(ng, t, 0.2, 0.01, 1.4);
    } else if (kind === 'scrape') {
      const g = this.gain(0, p);
      const f = this.filter('bandpass', 2500, 9, g);
      f.frequency.exponentialRampToValueAtTime(380, t + 2.6);
      this.noise(t, 2.8, f, 0.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 1.2); g.gain.linearRampToValueAtTime(0.0001, t + 2.7);
    } else {
      const g = this.gain(0, p);
      const o = this.osc('sawtooth', rnd(90, 130), t, 5, this.filter('lowpass', 700, 6, g));
      o.frequency.linearRampToValueAtTime(o.frequency.value * 0.94, t + 5);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 2); g.gain.linearRampToValueAtTime(0.0001, t + 5);
    }
  }
  whisper() {
    const t = this.ctx.currentTime + 0.05;
    const p = this.panner(pick([-0.9, 0.9, -0.6, 0.6]), this.nightMix);
    const g = this.gain(0, p);
    for (const fq of [rnd(450, 650), rnd(1300, 1700), rnd(2400, 2900)]) {
      const f = this.filter('bandpass', fq, 12, g);
      f.frequency.setValueAtTime(fq, t); f.frequency.linearRampToValueAtTime(fq * rnd(0.8, 1.2), t + 1.5);
      this.noise(t, 2, f, 1.2);
    }
    const trem = this.ctx.createOscillator(); trem.frequency.value = rnd(6, 11);
    const tg = this.gain(0.12); trem.connect(tg); tg.connect(g.gain); trem.start(t); trem.stop(t + 2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.5); g.gain.linearRampToValueAtTime(0.0001, t + 1.9);
  }
  heartbeat(t, k, dest) {
    for (const [dt, v] of [[0, 1], [0.22, 0.7]]) {
      const g = this.gain(0, dest || this.sfxBus);
      const o = this.osc('sine', 62, t + dt, 0.3, g);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.2);
      this.env(g, t + dt, 0.45 * k * v, 0.008, 0.22);
    }
  }

  // ---------- Ambiance ----------
  bird(day) {
    const t = this.ctx.currentTime + 0.02;
    const out = this.gain(0.5 + Math.random() * 0.5, this.ambBus);
    const p = this.panner(rnd(-1, 1), out);
    const v = this.gain(0.4); out.connect(v); v.connect(this.sfxVerb);
    const type = Math.floor(Math.random() * 4);
    const base = rnd(2200, 3800);
    if (type === 0) { // série de petits cuicui
      const n = 2 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) {
        const tt = t + i * rnd(0.09, 0.14);
        const g = this.gain(0, p);
        const o = this.osc('sine', base, tt, 0.1, g);
        o.frequency.exponentialRampToValueAtTime(base * rnd(1.3, 1.7), tt + 0.06);
        this.env(g, tt, 0.05 * day, 0.008, 0.07);
      }
    } else if (type === 1) { // gazouillis
      const g = this.gain(0, p);
      const o = this.osc('sine', base, t, 0.7, g);
      const m = this.ctx.createOscillator(); m.frequency.value = rnd(18, 32);
      const mg = this.gain(base * 0.18); m.connect(mg); mg.connect(o.frequency); m.start(t); m.stop(t + 0.7);
      o.frequency.linearRampToValueAtTime(base * 1.2, t + 0.6);
      this.env(g, t, 0.035 * day, 0.04, 0.6);
    } else if (type === 2) { // appel à deux notes "piou-piou"
      for (let i = 0; i < 2; i++) {
        const tt = t + i * 0.28;
        const g = this.gain(0, p);
        const o = this.osc('sine', base * (i ? 0.8 : 1), tt, 0.25, g);
        o.frequency.exponentialRampToValueAtTime(base * (i ? 0.6 : 0.75), tt + 0.2);
        this.env(g, tt, 0.04 * day, 0.01, 0.2);
      }
    } else { // trille rapide
      const g = this.gain(0, p);
      const o = this.osc('triangle', base * 1.2, t, 0.5, this.filter('highpass', 1500, 0.5, g));
      const m = this.ctx.createOscillator(); m.type = 'square'; m.frequency.value = rnd(28, 40);
      const mg = this.gain(base * 0.25); m.connect(mg); mg.connect(o.frequency); m.start(t); m.stop(t + 0.5);
      this.env(g, t, 0.022 * day, 0.02, 0.45);
    }
  }
  cricket() {
    const t = this.ctx.currentTime + 0.02;
    const p = this.panner(rnd(-1, 1), this.ambBus);
    const f = rnd(4200, 4800);
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.045;
      const g = this.gain(0, p);
      this.osc('sine', f, tt, 0.04, g);
      this.env(g, tt, 0.012, 0.005, 0.03);
    }
  }
  owl() {
    const t = this.ctx.currentTime + 0.05;
    const p = this.panner(rnd(-0.8, 0.8), this.ambBus);
    const v = this.gain(0.5); p.connect?.(v); v.connect(this.sfxVerb);
    for (const [dt, f, d] of [[0, 420, 0.25], [0.45, 400, 0.18], [0.75, 410, 0.55]]) {
      const g = this.gain(0, p);
      const o = this.osc('sine', f, t + dt, d + 0.1, g);
      o.frequency.linearRampToValueAtTime(f * 0.92, t + dt + d);
      g.gain.setValueAtTime(0.0001, t + dt); g.gain.linearRampToValueAtTime(0.05, t + dt + 0.05); g.gain.linearRampToValueAtTime(0.0001, t + dt + d);
    }
  }

  // Annonces : la nuit tombe / le jour se lève
  stinger(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    if (kind === 'night') {
      for (const [f, v] of [[55, 0.25], [82.5, 0.12], [123, 0.08], [164.8, 0.05], [233, 0.04]]) {
        const g = this.gain(0, this.musicBus); g.connect(this.musicVerb);
        this.osc('sine', f, t, 7, g);
        this.env(g, t, v, 0.02, 6.5);
      }
      const g = this.gain(0, this.musicBus);
      const f = this.filter('lowpass', 200, 1, g);
      f.frequency.exponentialRampToValueAtTime(2000, t + 3);
      this.noise(t, 3.5, f);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.15, t + 2.8); g.gain.linearRampToValueAtTime(0.0001, t + 3.4);
    } else {
      [60, 64, 67, 72, 76, 79].forEach((n, i) => {
        const g = this.gain(0, this.musicBus); g.connect(this.musicVerb);
        this.osc('sine', mtof(n), t + i * 0.12, 2.5, g);
        this.osc('sine', mtof(n) * 2.76, t + i * 0.12, 0.8, this.gain(0.15, g));
        this.env(g, t + i * 0.12, 0.06, 0.01, 2.2);
      });
    }
  }

  // ======================= Bruitages =======================
  play(name, pos) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const fn = this.sfx[name];
    if (!fn) return;
    const out = this.spatial(pos, fn.range || 9, fn.verb ?? 0.25);
    if (!out) return;
    fn.call(this, this.ctx.currentTime + 0.01, out);
  }

  get sfx() {
    if (this._sfx) return this._sfx;
    const S = {};
    const self = this;
    const thump = (t, out, f0, f1, dur, vol) => {
      const g = self.gain(0, out);
      const o = self.osc('sine', f0, t, dur, g);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
      self.env(g, t, vol, 0.004, dur);
    };
    const burst = (t, out, type, freq, q, dur, vol, a = 0.003, rate = 1) => {
      const g = self.gain(0, out);
      self.noise(t, dur, self.filter(type, freq, q, g), rate);
      self.env(g, t, vol, a, dur);
      return g;
    };
    const ring = (t, out, freqs, dur, vol) => {
      for (const [f, v] of freqs) {
        const g = self.gain(0, out);
        self.osc('sine', f, t, dur, g);
        self.env(g, t, vol * v, 0.002, dur * (0.4 + v * 0.6));
      }
    };

    S.swing = function (t, out) {
      const g = self.gain(0, out);
      const f = self.filter('bandpass', 500, 1.4, g);
      f.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
      f.frequency.exponentialRampToValueAtTime(900, t + 0.22);
      self.noise(t, 0.25, f, 1.2);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    }; S.swing.verb = 0.05;
    S.swordHit = function (t, out) {
      thump(t, out, 140, 60, 0.15, 0.6);
      burst(t, out, 'bandpass', 1400, 1.5, 0.12, 0.5);
      ring(t, out, [[1850, 0.5], [2950, 0.3], [4400, 0.2]], 0.35, 0.08);
    };
    // ----- Coupe de bois : 6 variantes (l'originale + 5) -----
    const CHOPS = [
      { f: 210, ring: [520, 780], crack: 950, q: 2.5, dbl: 0 },
      { f: 180, ring: [460, 690], crack: 800, q: 3.0, dbl: 0 },
      { f: 245, ring: [610, 920], crack: 1150, q: 2.2, dbl: 0 },
      { f: 160, ring: [400, 620], crack: 700, q: 3.5, dbl: 0.045 },   // double « toc-toc »
      { f: 225, ring: [560, 1240], crack: 1300, q: 1.8, dbl: 0, splinter: 1 },
      { f: 195, ring: [490, 735], crack: 880, q: 2.8, dbl: 0.03, splinter: 1 },
    ];
    S.chop = function (t, out) {
      const v = pick(CHOPS), p = rnd(0.94, 1.06);
      const hit = (tt, k) => {
        thump(tt, out, v.f * p, v.f * 0.45 * p, 0.12, 0.7 * k);
        burst(tt, out, 'bandpass', v.crack * p, v.q, 0.09, 0.55 * k);
        burst(tt, out, 'highpass', 3000, 0.7, 0.03, 0.25 * k);
        ring(tt, out, [[v.ring[0] * p, 0.6], [v.ring[1] * p, 0.3]], 0.18, 0.12 * k);
      };
      hit(t, 1);
      if (v.dbl) hit(t + v.dbl, 0.5);
      if (v.splinter) for (let i = 0; i < 3; i++) burst(t + 0.03 + i * rnd(0.02, 0.04), out, 'bandpass', rnd(2500, 4200), 4, 0.025, 0.25);
    };
    // ----- Craquement avant la chute : 6 variantes -----
    S.treeCreak = function (t, out) {
      const v = Math.floor(Math.random() * 6);
      const f0 = [95, 80, 110, 70, 120, 88][v], dur = [1.6, 1.9, 1.3, 2.1, 1.4, 1.7][v];
      const g = self.gain(0, out);
      const f = self.filter('bandpass', [420, 360, 520, 300, 600, 450][v], 6, g);
      const o = self.osc('sawtooth', f0, t, dur, f);
      const m = self.ctx.createOscillator(); m.frequency.value = [7, 5, 9, 4, 11, 6][v];
      const mg = self.gain(18 + v * 3); m.connect(mg); mg.connect(o.frequency); m.start(t); m.stop(t + dur);
      o.frequency.linearRampToValueAtTime(f0 * 0.62, t + dur * 0.95);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + dur * 0.25); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      const snaps = 3 + v % 4;
      for (let i = 0; i < snaps; i++) burst(t + rnd(0, dur * 0.8), out, 'bandpass', rnd(1500, 3200), 3, 0.03, 0.4);
      if (v === 3 || v === 5) burst(t + dur * 0.85, out, 'bandpass', 900, 2, 0.12, 0.6); // gros craquement final
    }; S.treeCreak.range = 14;
    // ----- Chute d'arbre : 6 variantes -----
    const FALLS = [
      { boom: [70, 28], dur: 0.7, rustle: 1.2, crunch: 4 },
      { boom: [60, 24], dur: 0.9, rustle: 1.6, crunch: 6 },
      { boom: [85, 34], dur: 0.55, rustle: 0.9, crunch: 3 },
      { boom: [55, 22], dur: 1.0, rustle: 1.4, crunch: 5, bounce: 0.32 },   // rebondit
      { boom: [78, 30], dur: 0.6, rustle: 2.0, crunch: 8 },                  // beaucoup de branches
      { boom: [66, 26], dur: 0.8, rustle: 1.1, crunch: 4, bounce: 0.25 },
    ];
    S.treeFall = function (t, out) {
      const v = pick(FALLS);
      thump(t, out, v.boom[0], v.boom[1], v.dur, 0.9);
      if (v.bounce) thump(t + v.bounce, out, v.boom[0] * 1.2, v.boom[1], v.dur * 0.5, 0.45);
      burst(t, out, 'lowpass', 500, 0.7, v.dur * 2, 0.6, 0.01);
      burst(t + 0.05, out, 'highpass', 2500, 0.5, v.rustle, 0.35, 0.02, 0.8);
      for (let i = 0; i < v.crunch; i++) burst(t + rnd(0, 0.5), out, 'bandpass', rnd(600, 1600), 3, 0.06, 0.4);
    }; S.treeFall.range = 16; S.treeFall.verb = 0.4;
    // ----- Pioche : 3 variantes -----
    const PICKS = [
      { ring: [2150, 3380, 4720, 6100], dust: 900 },
      { ring: [1780, 2900, 4100, 5300], dust: 700 },
      { ring: [2500, 3700, 5300, 6900], dust: 1100, chip: 1 },
    ];
    S.pick = function (t, out) {
      const v = pick(PICKS), p = rnd(0.95, 1.05);
      ring(t, out, v.ring.map((f, i) => [f * p, [1, 0.6, 0.4, 0.25][i]]), 0.55, 0.12);
      burst(t, out, 'highpass', 2500, 0.7, 0.04, 0.5);
      burst(t + 0.01, out, 'lowpass', v.dust, 0.8, 0.14, 0.45);
      thump(t, out, 110, 60, 0.1, 0.35);
      if (v.chip) for (let i = 0; i < 3; i++) burst(t + 0.05 + i * 0.05, out, 'bandpass', rnd(3000, 5000), 5, 0.02, 0.2);
    };
    // ----- Rocher qui éclate : 3 variantes -----
    S.rockBreak = function (t, out) {
      const v = Math.floor(Math.random() * 3);
      thump(t, out, [90, 75, 110][v], [35, 28, 45][v], [0.5, 0.65, 0.4][v], 0.8);
      const n = [7, 10, 5][v];
      for (let i = 0; i < n; i++) burst(t + rnd(0, [0.35, 0.6, 0.25][v]), out, 'bandpass', rnd(700, 2500), 1.5, rnd(0.04, 0.1), 0.5);
      burst(t, out, 'lowpass', [700, 500, 900][v], 0.7, [0.8, 1.1, 0.6][v], 0.5, 0.005);
      if (v === 1) burst(t + 0.15, out, 'highpass', 2000, 0.6, 0.8, 0.2, 0.05, 0.7);   // gravier qui roule
      if (v === 2) ring(t, out, [[1400, 1], [2300, 0.5]], 0.4, 0.06);                  // éclat cristallin
    }; S.rockBreak.range = 14;
    S.buildPlace = function (t, out) {
      thump(t, out, 160, 70, 0.2, 0.7);
      burst(t, out, 'lowpass', 600, 1, 0.2, 0.5);
      for (let i = 0; i < 3; i++) burst(t + 0.05 + i * 0.05, out, 'bandpass', rnd(900, 1600), 4, 0.03, 0.3);
    };
    S.hammerTap = function (t, out) {
      const p = rnd(0.9, 1.15);
      ring(t, out, [[880 * p, 1], [1760 * p * 1.02, 0.3]], 0.12, 0.12);
      burst(t, out, 'bandpass', 1800 * p, 3, 0.03, 0.35);
      thump(t, out, 240 * p, 120, 0.07, 0.3);
    };
    S.buildDone = function (t, out) {
      thump(t, out, 130, 60, 0.25, 0.6);
      [72, 76, 79, 84].forEach((n, i) => {
        const g = self.gain(0, out);
        self.osc('sine', mtof(n), t + 0.08 + i * 0.07, 1.2, g);
        self.osc('sine', mtof(n) * 2.76, t + 0.08 + i * 0.07, 0.4, self.gain(0.2, g));
        self.env(g, t + 0.08 + i * 0.07, 0.1, 0.005, 1.0);
      });
    }; S.buildDone.verb = 0.5;
    S.woodHit = function (t, out) {
      thump(t, out, 180, 80, 0.12, 0.6);
      burst(t, out, 'bandpass', 800, 2, 0.1, 0.5);
    };
    S.buildBreak = function (t, out) {
      thump(t, out, 90, 40, 0.5, 0.8);
      for (let i = 0; i < 8; i++) burst(t + rnd(0, 0.5), out, 'bandpass', rnd(500, 1500), 3, rnd(0.04, 0.1), 0.45);
    }; S.buildBreak.range = 14;
    S.step = function (t, out) {
      burst(t, out, 'lowpass', 500, 0.8, 0.07, 0.18);
      burst(t, out, 'highpass', 3500, 0.6, 0.06, 0.05);
    }; S.step.verb = 0;
    S.splashStep = function (t, out) {
      burst(t, out, 'bandpass', 1200, 1.2, 0.18, 0.3, 0.01);
      for (let i = 0; i < 3; i++) {
        const g = self.gain(0, out);
        const f0 = rnd(500, 1100);
        const o = self.osc('sine', f0, t + i * 0.04, 0.06, g);
        o.frequency.exponentialRampToValueAtTime(f0 * 1.8, t + i * 0.04 + 0.05);
        self.env(g, t + i * 0.04, 0.05, 0.003, 0.05);
      }
    }; S.splashStep.verb = 0;
    S.jump = function (t, out) { burst(t, out, 'lowpass', 700, 0.8, 0.08, 0.15); };
    S.land = function (t, out) { thump(t, out, 100, 50, 0.12, 0.35); burst(t, out, 'lowpass', 400, 0.8, 0.1, 0.25); };
    S.pickup = function (t, out) {
      const g = self.gain(0, out);
      const o = self.osc('sine', 880, t, 0.15, g);
      o.frequency.exponentialRampToValueAtTime(1500, t + 0.08);
      self.env(g, t, 0.08, 0.005, 0.12);
    }; S.pickup.verb = 0.1;
    S.playerHurt = function (t, out) {
      const g = self.gain(0, out);
      const o = self.osc('sawtooth', 170, t, 0.22, self.filter('lowpass', 900, 3, g));
      o.frequency.exponentialRampToValueAtTime(110, t + 0.2);
      self.env(g, t, 0.25, 0.01, 0.2);
      thump(t, out, 120, 50, 0.15, 0.5);
    };
    S.playerDie = function (t, out) {
      const g = self.gain(0, out);
      const o = self.osc('sawtooth', 200, t, 1.2, self.filter('lowpass', 700, 2, g));
      o.frequency.exponentialRampToValueAtTime(70, t + 1.1);
      self.env(g, t, 0.25, 0.02, 1.1);
      thump(t + 0.6, out, 90, 35, 0.4, 0.6);
    };
    S.gemPick = function (t, out) {
      [76, 79, 83, 88, 91].forEach((n, i) => {
        const g = self.gain(0, out);
        self.osc('sine', mtof(n), t + i * 0.05, 1, g);
        self.osc('triangle', mtof(n) * 2, t + i * 0.05, 0.4, self.gain(0.15, g));
        self.env(g, t + i * 0.05, 0.07, 0.005, 0.9);
      });
    }; S.gemPick.verb = 0.6;
    S.gemDrop = function (t, out) {
      [79, 74, 67].forEach((n, i) => {
        const g = self.gain(0, out);
        self.osc('sine', mtof(n), t + i * 0.07, 1, g);
        self.env(g, t + i * 0.07, 0.07, 0.005, 0.9);
      });
      thump(t + 0.1, out, 140, 70, 0.2, 0.3);
    }; S.gemDrop.verb = 0.6;
    S.gemHit = function (t, out) {
      ring(t, out, [[2637, 1], [3520, 0.7], [4186, 0.5], [5274, 0.4]], 0.9, 0.12);
      burst(t, out, 'highpass', 4000, 0.7, 0.15, 0.4);
      thump(t, out, 160, 60, 0.2, 0.4);
    }; S.gemHit.range = 20; S.gemHit.verb = 0.6;
    S.ui = function (t, out) {
      const g = self.gain(0, out);
      self.osc('sine', 1200, t, 0.05, g);
      self.env(g, t, 0.05, 0.002, 0.04);
    }; S.ui.verb = 0;
    // ----- Monstres -----
    S.monsterGrowl = function (t, out) {
      const dur = rnd(0.9, 1.6), f0 = rnd(60, 90);
      const g = self.gain(0, out);
      const lp = self.filter('lowpass', 650, 3, g);
      const o = self.osc('sawtooth', f0, t, dur, lp);
      const m = self.ctx.createOscillator(); m.frequency.value = rnd(22, 38);
      const mg = self.gain(f0 * 0.5); m.connect(mg); mg.connect(o.frequency); m.start(t); m.stop(t + dur);
      o.frequency.linearRampToValueAtTime(f0 * 0.8, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.4, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      const ng = self.gain(0, out); self.noise(t, dur, self.filter('bandpass', 600, 2, ng));
      ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(0.15, t + dur * 0.3); ng.gain.linearRampToValueAtTime(0.0001, t + dur);
    }; S.monsterGrowl.range = 11; S.monsterGrowl.verb = 0.35;
    S.monsterAttack = function (t, out) {
      const g = self.gain(0, out);
      const lp = self.filter('lowpass', 1400, 2, g);
      const o = self.osc('sawtooth', 150, t, 0.7, lp);
      o.frequency.linearRampToValueAtTime(210, t + 0.35);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.65);
      const o2 = self.osc('square', 152, t, 0.7, self.gain(0.3, lp));
      o2.frequency.linearRampToValueAtTime(205, t + 0.35);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      burst(t, out, 'bandpass', 900, 1, 0.6, 0.25, 0.2);
      S.swing.call(self, t + 0.48, out);
    }; S.monsterAttack.range = 12; S.monsterAttack.verb = 0.35;
    S.monsterHurt = function (t, out) {
      const g = self.gain(0, out);
      const o = self.osc('sawtooth', 320, t, 0.3, self.filter('lowpass', 1800, 4, g));
      o.frequency.exponentialRampToValueAtTime(160, t + 0.25);
      self.env(g, t, 0.3, 0.01, 0.25);
      thump(t, out, 130, 55, 0.14, 0.55);
      burst(t, out, 'bandpass', 1100, 1.5, 0.1, 0.4);
    }; S.monsterHurt.range = 12;
    S.monsterDie = function (t, out) {
      const g = self.gain(0, out);
      const o = self.osc('sawtooth', 240, t, 1.8, self.filter('lowpass', 1200, 5, g));
      o.frequency.exponentialRampToValueAtTime(45, t + 1.7);
      const v = self.ctx.createOscillator(); v.frequency.value = 9;
      const vg = self.gain(25); v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 1.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      const ng = burst(t + 1.6, out, 'lowpass', 400, 0.6, 1.5, 0.25, 0.3);
      void ng;
    }; S.monsterDie.range = 14; S.monsterDie.verb = 0.5;
    S.monsterBurn = function (t, out) {
      burst(t, out, 'highpass', 3000, 0.5, 1.6, 0.3, 0.2, 1.4);
      const g = self.gain(0, out);
      const o = self.osc('sawtooth', 400, t, 1.4, self.filter('bandpass', 1200, 3, g));
      o.frequency.exponentialRampToValueAtTime(120, t + 1.3);
      self.env(g, t, 0.18, 0.05, 1.3);
    }; S.monsterBurn.range = 14;
    S.monsterSpawn = function (t, out) {
      thump(t, out, 55, 30, 1.2, 0.5);
      const g = self.gain(0, out);
      const f = self.filter('bandpass', 200, 3, g);
      f.frequency.exponentialRampToValueAtTime(1500, t + 1.2);
      self.noise(t, 1.3, f);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25, t + 0.9); g.gain.linearRampToValueAtTime(0.0001, t + 1.3);
    }; S.monsterSpawn.range = 16; S.monsterSpawn.verb = 0.5;
    S.runnerGrowl = function (t, out) {
      const dur = rnd(0.4, 0.7), f0 = rnd(180, 260);
      const g = self.gain(0, out);
      const o = self.osc('sawtooth', f0, t, dur, self.filter('bandpass', 1400, 2, g));
      const m = self.ctx.createOscillator(); m.frequency.value = rnd(30, 45);
      const mg = self.gain(f0 * 0.4); m.connect(mg); mg.connect(o.frequency); m.start(t); m.stop(t + dur);
      o.frequency.linearRampToValueAtTime(f0 * 1.4, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25, t + 0.05); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    }; S.runnerGrowl.range = 10; S.runnerGrowl.verb = 0.2;
    S.runnerAttack = function (t, out) {
      const g = self.gain(0, out);
      const o = self.osc('sawtooth', 300, t, 0.3, self.filter('bandpass', 1800, 2, g));
      o.frequency.exponentialRampToValueAtTime(520, t + 0.15);
      self.env(g, t, 0.3, 0.01, 0.25);
      S.swing.call(self, t + 0.15, out);
    }; S.runnerAttack.range = 10;
    S.spitCharge = function (t, out) {
      const g = self.gain(0, out);
      const f = self.filter('bandpass', 300, 4, g);
      f.frequency.exponentialRampToValueAtTime(1800, t + 0.9);
      self.noise(t, 1, f, 0.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.85); g.gain.linearRampToValueAtTime(0.0001, t + 1);
      const g2 = self.gain(0, out);
      const o = self.osc('sine', 90, t, 1, g2); o.frequency.linearRampToValueAtTime(220, t + 0.9);
      g2.gain.setValueAtTime(0.0001, t); g2.gain.linearRampToValueAtTime(0.25, t + 0.8); g2.gain.linearRampToValueAtTime(0.0001, t + 1);
    }; S.spitCharge.range = 14;
    S.spit = function (t, out) {
      burst(t, out, 'bandpass', 900, 1.2, 0.25, 0.6, 0.005);
      const g = self.gain(0, out);
      const o = self.osc('sine', 500, t, 0.3, g); o.frequency.exponentialRampToValueAtTime(150, t + 0.25);
      self.env(g, t, 0.3, 0.005, 0.25);
    }; S.spit.range = 16;
    S.spitHit = function (t, out) {
      burst(t, out, 'lowpass', 1500, 0.8, 0.4, 0.6, 0.005);
      for (let i = 0; i < 5; i++) {
        const g = self.gain(0, out), f0 = rnd(300, 900), tt = t + rnd(0, 0.2);
        const o = self.osc('sine', f0, tt, 0.08, g); o.frequency.exponentialRampToValueAtTime(f0 * 2, tt + 0.06);
        self.env(g, tt, 0.12, 0.003, 0.07);
      }
      burst(t, out, 'highpass', 3000, 0.5, 0.5, 0.2, 0.02);
    }; S.spitHit.range = 14;
    S.collect = function (t, out) {
      const g = self.gain(0, out);
      const f0 = rnd(900, 1300);
      const o = self.osc('triangle', f0, t, 0.08, g);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + 0.05);
      self.env(g, t, 0.06, 0.003, 0.07);
    }; S.collect.verb = 0;
    // bouclier qui pare un coup : choc métallique
    S.shieldBlock = function (t, out) {
      ring(t, out, [[620, 1], [1480, 0.6], [2350, 0.35], [3900, 0.15]], 0.35, 0.16);
      thump(t, out, 180, 90, 0.1, 0.4);
      burst(t, out, 'highpass', 2500, 0.8, 0.06, 0.3);
    }; S.shieldBlock.range = 12;
    // boule de feu du mage
    S.fire = function (t, out) {
      const g = burst(t, out, 'lowpass', 900, 0.7, 0.55, 0.55, 0.01);
      void g;
      burst(t, out, 'bandpass', 2400, 0.9, 0.35, 0.25, 0.02);
      thump(t, out, 120, 50, 0.3, 0.45);
    }; S.fire.range = 16;
    // bûche qui tombe au sol : petit « toc » boisé
    S.logDrop = function (t, out) {
      const f = rnd(380, 520);
      ring(t, out, [[f, 1], [f * 2.3, 0.4], [f * 3.9, 0.15]], 0.12, 0.12);
      thump(t, out, 160, 80, 0.08, 0.25);
      burst(t, out, 'bandpass', 1500, 1.2, 0.04, 0.12);
    }; S.logDrop.range = 10; S.logDrop.verb = 0.1;
    // caillou qui tombe : clic sec
    S.pebbleDrop = function (t, out) {
      burst(t, out, 'highpass', rnd(2500, 4000), 0.9, 0.035, 0.35);
      ring(t, out, [[rnd(1800, 2600), 1]], 0.05, 0.06);
      thump(t, out, 220, 120, 0.04, 0.12);
    }; S.pebbleDrop.range = 10; S.pebbleDrop.verb = 0.1;
    // crâne qui tombe et roule
    S.skullDrop = function (t, out) {
      thump(t, out, 260, 130, 0.07, 0.3);
      burst(t, out, 'bandpass', 1800, 1.5, 0.05, 0.25);
      for (let i = 1; i < 5; i++) {
        thump(t + 0.1 + i * 0.09 + Math.random() * 0.03, out, 240 - i * 15, 120, 0.05, 0.18 / i);
        burst(t + 0.1 + i * 0.09, out, 'bandpass', 2200, 2, 0.03, 0.15 / i);
      }
    }; S.skullDrop.range = 14;
    S.bushHit = function (t, out) {
      burst(t, out, 'bandpass', 2500, 0.8, 0.18, 0.4, 0.005, 1.2);
      burst(t, out, 'lowpass', 600, 0.8, 0.1, 0.2);
    };
    S.levelUp = function (t, out) {
      [60, 67, 72, 76, 79, 84].forEach((n, i) => {
        const g = self.gain(0, out);
        self.osc('triangle', mtof(n), t + i * 0.06, 0.6, g);
        self.osc('sine', mtof(n + 12), t + i * 0.06, 0.4, self.gain(0.3, g));
        self.env(g, t + i * 0.06, 0.09, 0.005, 0.5);
      });
      thump(t, out, 120, 60, 0.3, 0.4);
    }; S.levelUp.verb = 0.6;
    S.anvil = function (t, out) {
      ring(t, out, [[1250, 1], [2640, 0.6], [3900, 0.35], [5200, 0.2]], 0.9, 0.12);
      burst(t, out, 'highpass', 3000, 0.6, 0.05, 0.4);
    }; S.anvil.range = 14; S.anvil.verb = 0.4;
    S.portal = function (t, out) {
      const g = self.gain(0, out);
      const f = self.filter('bandpass', 400, 3, g);
      f.frequency.exponentialRampToValueAtTime(3000, t + 1.5);
      self.noise(t, 1.6, f, 0.7);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.4, t + 1.2); g.gain.linearRampToValueAtTime(0.0001, t + 1.6);
      [72, 79, 84, 91].forEach((n, i) => { const g2 = self.gain(0, out); self.osc('sine', mtof(n), t + 0.6 + i * 0.1, 1.2, g2); self.env(g2, t + 0.6 + i * 0.1, 0.06, 0.01, 1); });
    }; S.portal.verb = 0.7;
    S.door = function (t, out) {
      const g = self.gain(0, out);
      const o = self.osc('sawtooth', 140, t, 0.45, self.filter('bandpass', 700, 8, g));
      o.frequency.linearRampToValueAtTime(220, t + 0.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 0.45);
      thump(t + 0.35, out, 150, 80, 0.1, 0.2);
    }; S.door.range = 8;
    S.monsterStep = function (t, out) {
      thump(t, out, 75, 40, 0.12, 0.35);
      burst(t, out, 'lowpass', 300, 0.8, 0.08, 0.2);
    }; S.monsterStep.range = 7; S.monsterStep.verb = 0;
    S.thud = function (t, out) {
      thump(t, out, 80, 30, 0.45, 0.8);
      burst(t, out, 'lowpass', 400, 0.7, 0.4, 0.4);
    }; S.thud.range = 12;
    // ---------- Monstres : voix retravaillées (formants + grain + râle) ----------
    const shaper = (k) => {
      const ws = self.ctx.createWaveShaper(), n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
      ws.curve = c; return ws;
    };
    // voix : f = [[temps, fréquence], ...], formants = [[fréquence, Q, gain], ...]
    const voice = (t, out, o) => {
      const dur = o.dur;
      const mix = self.gain(0, out);
      mix.gain.setValueAtTime(0.0001, t);
      mix.gain.linearRampToValueAtTime(o.vol, t + (o.att ?? 0.08));
      mix.gain.setValueAtTime(o.vol * 0.85, t + dur * 0.7);
      mix.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // râle : modulation d'amplitude rapide (texture de grognement)
      const rattle = self.gain(1, null);
      const rl = self.ctx.createOscillator(); rl.frequency.value = o.rattle || 28;
      const rg = self.gain(o.rattleDepth ?? 0.6); rl.connect(rg); rg.connect(rattle.gain); rl.start(t); rl.stop(t + dur + 0.1);
      const sh = shaper(o.grit ?? 6);
      sh.connect(rattle);
      for (const [f, q, g] of o.formants) rattle.connect(self.filter('bandpass', f, q, self.gain(g, mix)));
      const lp = self.filter('lowpass', o.lp || 3000, 0.7, mix); rattle.connect(lp);
      const src = self.osc('sawtooth', o.f[0][1], t, dur, sh);
      const sub = self.osc('square', o.f[0][1] / 2, t, dur, self.gain(0.35, sh));
      for (const [dt, f] of o.f.slice(1)) {
        src.frequency.exponentialRampToValueAtTime(f, t + dt);
        sub.frequency.exponentialRampToValueAtTime(f / 2, t + dt);
      }
      const vib = self.ctx.createOscillator(); vib.frequency.value = o.vibRate || rnd(5, 8);
      const vg = self.gain(o.f[0][1] * (o.vib ?? 0.05)); vib.connect(vg); vg.connect(src.frequency); vg.connect(sub.detune); vib.start(t); vib.stop(t + dur + 0.1);
      if (o.breath) {
        const bg = self.gain(0, out);
        self.noise(t, dur, self.filter('bandpass', o.breathF || 900, 1.2, bg), 0.9);
        bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(o.breath, t + dur * 0.2); bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      }
    };
    const BRUTE_F = [[280, 5, 1.2], [620, 6, 0.9], [1150, 7, 0.5], [2400, 8, 0.2]];
    S.monsterGrowl = function (t, out) {
      const f0 = rnd(62, 78), dur = rnd(1.2, 1.9);
      voice(t, out, { dur, vol: 0.32, f: [[0, f0], [dur * 0.4, f0 * 1.25], [dur, f0 * 0.8]], formants: BRUTE_F, rattle: rnd(24, 34), grit: 9, breath: 0.12, breathF: 500, lp: 1500 });
    }; S.monsterGrowl.range = 12; S.monsterGrowl.verb = 0.35;
    S.monsterAttack = function (t, out) {
      voice(t, out, { dur: 0.75, vol: 0.45, att: 0.05, f: [[0, 85], [0.35, 170], [0.75, 70]], formants: [[380, 4, 1.2], [820, 5, 1], [1500, 6, 0.6], [2800, 8, 0.25]], rattle: 32, grit: 12, breath: 0.2, breathF: 1200, lp: 2400 });
      S.swing.call(self, t + 0.5, out);
    }; S.monsterAttack.range = 13; S.monsterAttack.verb = 0.35;
    S.monsterHurt = function (t, out) {
      voice(t, out, { dur: 0.38, vol: 0.4, att: 0.01, f: [[0, 210], [0.38, 120]], formants: [[450, 4, 1.2], [1000, 5, 0.8], [2200, 7, 0.4]], rattle: 40, grit: 10, breath: 0.15, lp: 2600 });
      thump(t, out, 130, 55, 0.14, 0.55);
      burst(t, out, 'bandpass', 900, 1.5, 0.12, 0.45);
    }; S.monsterHurt.range = 12;
    S.monsterDie = function (t, out) {
      voice(t, out, { dur: 2.2, vol: 0.38, f: [[0, 150], [0.3, 190], [2.2, 38]], formants: BRUTE_F, rattle: 22, rattleDepth: 0.8, grit: 8, breath: 0.18, breathF: 600, lp: 1800, vib: 0.08, vibRate: 4 });
      burst(t + 1.7, out, 'lowpass', 400, 0.6, 1.4, 0.25, 0.3);
    }; S.monsterDie.range = 15; S.monsterDie.verb = 0.5;
    // Griffu : cris aigus et cliquetis
    S.runnerGrowl = function (t, out) {
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const tt = t + i * rnd(0.06, 0.1), f0 = rnd(520, 780);
        voice(tt, out, { dur: 0.09, vol: 0.18, att: 0.005, f: [[0, f0], [0.09, f0 * 1.4]], formants: [[1400, 5, 1], [2900, 6, 0.6]], rattle: 60, grit: 5, lp: 5000, vib: 0.02 });
      }
      voice(t + n * 0.08, out, { dur: 0.45, vol: 0.2, f: [[0, 600], [0.2, 950], [0.45, 500]], formants: [[1300, 4, 1], [2600, 6, 0.7], [4000, 8, 0.3]], rattle: 48, grit: 7, breath: 0.08, breathF: 3000, lp: 6000 });
    }; S.runnerGrowl.range = 10; S.runnerGrowl.verb = 0.2;
    S.runnerAttack = function (t, out) {
      voice(t, out, { dur: 0.35, vol: 0.32, att: 0.01, f: [[0, 700], [0.12, 1300], [0.35, 600]], formants: [[1500, 4, 1.2], [3000, 6, 0.8]], rattle: 55, grit: 8, breath: 0.12, breathF: 3500, lp: 7000 });
      S.swing.call(self, t + 0.18, out);
    }; S.runnerAttack.range = 10;
    // Cracheur : gargouillis
    const gurgle = (t, out, dur, vol) => {
      const g = self.gain(0, out);
      const f = self.filter('bandpass', 500, 3, g);
      self.noise(t, dur, f, 0.6);
      const am = self.ctx.createOscillator(); am.frequency.value = rnd(11, 18);
      const ag = self.gain(vol * 0.8); am.connect(ag); ag.connect(g.gain); am.start(t); am.stop(t + dur);
      const fm = self.ctx.createOscillator(); fm.frequency.value = rnd(3, 6);
      const fg = self.gain(250); fm.connect(fg); fg.connect(f.frequency); fm.start(t); fm.stop(t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      for (let i = 0; i < 5; i++) {
        const tt = t + rnd(0, dur), f0 = rnd(200, 500), bg = self.gain(0, out);
        const o = self.osc('sine', f0, tt, 0.08, bg); o.frequency.exponentialRampToValueAtTime(f0 * 2.2, tt + 0.07);
        self.env(bg, tt, vol * 0.5, 0.004, 0.07);
      }
    };
    S.spitterGrowl = function (t, out) {
      gurgle(t, out, rnd(0.8, 1.3), 0.3);
      voice(t, out, { dur: 0.9, vol: 0.18, f: [[0, 110], [0.5, 95], [0.9, 80]], formants: [[350, 5, 1], [900, 6, 0.6]], rattle: 16, rattleDepth: 0.9, grit: 6, lp: 1400 });
    }; S.spitterGrowl.range = 11; S.spitterGrowl.verb = 0.3;
    S.spitCharge = function (t, out) {
      gurgle(t, out, 1.0, 0.4);
      const g = self.gain(0, out);
      const f = self.filter('bandpass', 300, 4, g);
      f.frequency.exponentialRampToValueAtTime(1800, t + 0.95);
      self.noise(t, 1, f, 0.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.9); g.gain.linearRampToValueAtTime(0.0001, t + 1.02);
    }; S.spitCharge.range = 14;
    // Tours
    S.bow = function (t, out) {
      const g = self.gain(0, out);
      const o = self.osc('triangle', 220, t, 0.15, self.filter('lowpass', 1800, 2, g));
      o.frequency.exponentialRampToValueAtTime(120, t + 0.12);
      self.env(g, t, 0.18, 0.002, 0.12);
      burst(t + 0.01, out, 'highpass', 3000, 0.6, 0.12, 0.12, 0.01);
    }; S.bow.range = 10; S.bow.verb = 0.1;
    S.frost = function (t, out) {
      ring(t, out, [[2093, 1], [2637, 0.7], [3136, 0.5], [4186, 0.3]], 1.0, 0.05);
      const g = self.gain(0, out);
      const f = self.filter('highpass', 4000, 0.7, g);
      self.noise(t, 0.6, f, 1.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    }; S.frost.range = 12; S.frost.verb = 0.5;
    S.sparkHit = function (t, out) {
      burst(t, out, 'highpass', 5000, 0.7, 0.05, 0.25);
    }; S.sparkHit.verb = 0;
    this._sfx = S;
    return S;
  }
}
