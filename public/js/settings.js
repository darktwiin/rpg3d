// Réglages du joueur (volumes, sensibilité, graphismes, touches), sauvegardés dans le navigateur.

export const ACTIONS = [
  ['forward', 'Avancer'], ['back', 'Reculer'], ['left', 'Gauche'], ['right', 'Droite'],
  ['jump', 'Sauter'], ['run', 'Courir'], ['interact', 'Interagir / Joyau'], ['skill', 'Compétence de classe'], ['build', 'Menu construction'], ['demolish', 'Déconstruire'],
  ['map', 'Carte'], ['chat', 'Chat'], ['repair', 'Réparer (construction)'], ['punch', 'Coup de poing (allié)'], ['inventory', 'Inventaire / héros'],
];
export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', run: 'ShiftLeft',
  interact: 'KeyF', skill: 'KeyE', build: 'KeyB', demolish: 'KeyF', map: 'KeyM', chat: 'Enter', repair: 'KeyR', punch: 'KeyG', inventory: 'KeyI',
};
const DEFAULTS = { master: 20, music: 60, amb: 70, sfx: 80, sens: 100, quality: 'high', keys: { ...DEFAULT_KEYS } };

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export const settings = (() => {
  let s = {};
  try { s = JSON.parse(lsGet('rpg3d_settings') || '{}'); } catch {}
  const out = { ...DEFAULTS, ...s, keys: { ...DEFAULT_KEYS, ...(s.keys || {}) } };
  // v0.0.5 : construction passe sur B, déconstruire sur F
  if ((s.kv || 0) < 2) { if (out.keys.build === 'KeyF') out.keys.build = 'KeyB'; out.keys.demolish = 'KeyF'; out.kv = 2; }
  // v0.1.0 : volume général à 20 % par défaut (le jeu était trop fort au lancement)
  if ((out.kv || 0) < 3) { out.master = 20; out.kv = 3; }
  // v0.1.6 : la compétence de classe prend E, interagir passe sur F (déconstruire reste sur F en construction)
  if ((out.kv || 0) < 4) { out.keys.interact = 'KeyF'; out.keys.skill = 'KeyE'; out.kv = 4; }
  const legacyQ = lsGet('rpg3d_quality');
  if (!s.quality && legacyQ) out.quality = legacyQ;
  return out;
})();
export function saveSettings() { lsSet('rpg3d_settings', JSON.stringify(settings)); }
export { lsGet, lsSet };

// Nom lisible d'une touche (respecte le clavier AZERTY quand le navigateur le permet)
const SPECIAL = {
  Space: 'Espace', ShiftLeft: 'Maj G', ShiftRight: 'Maj D', ControlLeft: 'Ctrl G', ControlRight: 'Ctrl D',
  AltLeft: 'Alt', AltRight: 'Alt Gr', Enter: 'Entrée', Tab: 'Tab', Backspace: 'Retour', CapsLock: 'Verr Maj',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Échap',
};
let layoutMap = null;
navigator.keyboard?.getLayoutMap?.().then((m) => { layoutMap = m; window.dispatchEvent(new Event('layoutready')); }).catch(() => {});
export function keyLabel(code) {
  if (SPECIAL[code]) return SPECIAL[code];
  const l = layoutMap?.get(code);
  if (l) return l.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Pavé ' + code.slice(6);
  return code;
}
