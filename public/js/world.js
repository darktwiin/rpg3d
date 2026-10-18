// ============================================================================
// Règles et géographie du monde, PARTAGÉES entre le navigateur et le serveur.
// Ce fichier ne doit rien importer (ni Three.js, ni le DOM).
// IMPORTANT : heightAt() doit rester identique à terrainHeight() dans terrain.js (GLSL).
// ============================================================================

export const VERSION = '0.1.8';

// ---------- Monde ----------
export const WORLD_LIMIT = 140;
export const MAP_HALF = 150;          // la carte couvre de -150 à +150 m
export const WATER_LEVEL = -0.55;
export const GEM_HOME = { x: 0, z: 0 };

// ---------- Temps (secondes) ----------
export const DAY_LEN = 240;        // 4 min de jour
export const NIGHT_LEN = 120;      // 2 min de nuit
export const CYCLE = DAY_LEN + NIGHT_LEN;
export const DUSK_WARN = 30;       // musique de stress avant la nuit
export const START_TIME = 20;      // la partie commence au petit matin

// ---------- Combat ----------
export const PLAYER_HP = 100;
export const GEM_HP = 600;
export const SWORD_DMG = 20;
export const RESPAWN_DELAY = 8;
export const MAX_PLAYERS = 4;

// Les trois sortes de monstres
export const MONSTERS = {
  brute: { name: 'Rôdeur', hp: 60, speed: 3.5, dmgP: 16, dmgGem: 25, dmgB: 40, reach: 1.5, cd: 1.7, hitAt: 0.5, scale: 1, radius: 0.5 },
  runner: { name: 'Griffu', hp: 30, speed: 6.4, dmgP: 8, dmgGem: 12, dmgB: 20, reach: 1.1, cd: 1.0, hitAt: 0.3, scale: 0.54, radius: 0.29 },
  spitter: { name: 'Mage squelette', hp: 45, speed: 2.6, dmgP: 22, dmgGem: 30, dmgB: 30, reach: 13, cd: 4.5, hitAt: 1.0, scale: 0.95, radius: 0.5, ranged: true },
  // Colosse : guerrier en armure avec hache et bouclier, à partir de la nuit 8
  tank: { name: 'Colosse', hp: 160, speed: 2.7, dmgP: 26, dmgGem: 40, dmgB: 70, reach: 2.0, cd: 2.1, hitAt: 0.6, scale: 1.38, radius: 0.75 },
};
export const TANK_NIGHT = 8;
// Joyau : on ne peut le porter que 10 s, puis il faut attendre 10 s avant de le reprendre
export const GEM_CARRY = 10, GEM_REST = 10;
// Déconstruire rend la moitié des matériaux ; réparer coûte la moitié du prix × la part de vie perdue
export const refundOf = (type) => { const c = PIECES[type].cost, out = {}; for (const r of RES_KEYS) out[r] = Math.ceil((c[r] || 0) / 2); return out; };
export function repairCost(b, mods) {
  const c = pieceCost(b.type, mods), k = Math.max(0, 1 - b.hp / b.max), out = {};
  for (const r of RES_KEYS) out[r] = Math.ceil((c[r] || 0) * 0.5 * k);
  return out;
}
// Coup de poing entre alliés (pour rire) : assomme 2 s
export const PUNCH = { reach: 1.8, stun: 2, cd: 1.2 };

// Apparences jouables (pack KayKit Adventurers). Le Ranger (cape bleue) est réservé au forgeron.
export const SKINS = [
// Chaque apparence a son style de combat.
  { id: 'Knight', name: 'Guerrier', role: 'Épée + bouclier (clic droit : parer)' },
  { id: 'Barbarian', name: 'Barbare', role: 'Hache (coups rapides en arc)' },
  { id: 'Mage', name: 'Mage', role: 'Boule de feu (zone + brûlure)' },
  { id: 'Rogue', name: 'Voleuse', role: 'Arc (lent, puissant, à distance)' },
];
export const skinOk = (s) => SKINS.some((k) => k.id === s);
// Styles de combat (dégâts de base, temps entre deux coups en secondes, portée…)
export const CLASSES = {
  Knight: { kind: 'slash', weapon: 'sword', dmg: 20, cd: 0.42, reach: 3.6, block: 0.2 },          // parade : 80 % de dégâts en moins
  Barbarian: { kind: 'cleave', weapon: 'waraxe', dmg: 24, cd: 0.47, reach: 3.7, cleave: 3.2 },  // touche tous les monstres devant lui
  // mage : boule de feu lancée au loin, dégâts en zone à l'impact puis brûlure (1 par seconde pendant 3 s)
  Mage: { kind: 'staff', weapon: 'staff', dmg: 12, cd: 0.8, range: 20, aoe: 2.8, burn: { dps: 1, dur: 3 }, missile: true },
  Rogue: { kind: 'shoot', weapon: 'bow', dmg: 40, cd: 1.0, range: 26, ranged: true },
};
export const classOf = (skin) => CLASSES[skin] || CLASSES.Knight;
export const MONSTER_HP = MONSTERS.brute.hp;
// Nombre de monstres présents en même temps pendant la nuit
// k = avancement de la nuit (0 au début, 1 à l'aube) : ils sont deux fois plus nombreux à la fin
export function nightTarget(night, players, k = 0) {
  return Math.round(1.2 * (10 + 6 * (night - 1)) * (1 + Math.min(1, Math.max(0, k))) * Math.pow(1.2, Math.max(0, players - 1)));
}
export const CHASE_GIVEUP = 8;   // secondes de poursuite sans toucher le joueur avant d'abandonner
export const SPAWN_MIN = 68, SPAWN_MAX = 88;   // distance d'apparition autour du Joyau

// ---------- Progression ----------
// Éclats gagnés à la fin de la nuit n (exponentiel : 1, 2, 3, 6, 10, 19, 34…)
export const shardsForNight = (n) => Math.max(1, Math.round(Math.pow(1.8, n - 1)));

// ---------- Ressources ----------
export const TREE_HP = 4;
export const ROCK_HP = 4;
export const BUSH_HP = 2;
export const TREE_VARIANTS = 6;    // 0-2 chênes, 3 chêne d'automne, 4-5 sapins
export const ROCK_VARIANTS = 4;
export const RES_HP = { t: TREE_HP, r: ROCK_HP, b: BUSH_HP };
// Ce que rapporte une ressource une fois détruite : entre 1 et 3 (+ bonus des compétences)
export const RES_KIND = { t: 'wood', r: 'stone', b: 'twig' };
export const RES_NAMES = { wood: 'Bois', stone: 'Pierre', twig: 'Brindilles' };
export const RES_KEYS = ['wood', 'stone', 'twig'];
export function rollYield(k, mods, rnd = Math.random, rich = false) {
  let n = Math.max(1 + Math.floor(rnd() * 3), mods.minYield);
  n += mods.allBonus + (k === 'r' ? mods.stoneBonus : mods.woodBonus) + (k === 'b' && mods.bush ? 1 : 0);
  if (rich) n += 3;
  if (mods.lucky && rnd() < 0.25) n *= 2;
  return n;
}
export const BUSH_HEAL = 15;

// ---------- Construction ----------
export const GRID = 2;
export const WALL_H = 2.0;          // hauteur d'un étage (murs du Wood Frame Build Set)
export const MAX_LEVEL = 4;         // étages au-dessus du sol
export const BUILD_TIME = 3;
export const BUILD_RANGE = 7;
export const PIECES = {
  floor: { name: 'Plancher', cost: { wood: 2, stone: 1 }, hp: 250 },
  base: { name: 'Charpente', cost: { wood: 4, stone: 0 }, hp: 350 },
  path: { name: 'Dalle de chemin', cost: { wood: 0, stone: 1 }, hp: 150 },
  wall: { name: 'Mur', cost: { wood: 2, stone: 0 }, hp: 400, blocks: true },
  window: { name: 'Fenêtre', cost: { wood: 2, stone: 0 }, hp: 340, blocks: true },
  roof: { name: 'Toit', cost: { wood: 1, twig: 3 }, hp: 250 },
  stairs: { name: 'Escalier', cost: { wood: 3, stone: 0 }, hp: 250 },
  door: { name: 'Porte', cost: { wood: 3, stone: 0 }, hp: 350, blocks: true },
  stonewall: { name: 'Mur de pierre', cost: { wood: 0, stone: 4 }, hp: 1000, blocks: true, skill: 'c_stone' },
  spikes: { name: 'Pieux', cost: { wood: 2, stone: 1 }, hp: 200, skill: 'c_spikes' },
  tower: { name: 'Tour d’archer', cost: { wood: 5, stone: 3 }, hp: 500, tower: true, skill: 'c_tower' },
  frost: { name: 'Tour de givre', cost: { wood: 3, stone: 5 }, hp: 500, tower: true, skill: 'c_frost' },
};
export const PIECE_ORDER = ['floor', 'base', 'wall', 'window', 'door', 'stairs', 'roof', 'path', 'stonewall', 'spikes', 'tower', 'frost'];
export const TOWER = { range: 15, rate: 0.33, dmg: 1, heavyDmg: 3 };
export const FROST = { range: 8, slow: 0.45, pulse: 1 };
export const isWallType = (t) => t === 'wall' || t === 'door' || t === 'stonewall' || t === 'window';
export const SPIKE_DPS = 14;
export const PATH_SPEED = 1.15;  // +15 % de vitesse sur les dalles de chemin

// ---------- Compétences (achetées au Gardien de maîtrise avec les éclats) ----------
// col/row : position dans l'arbre ; req : compétences nécessaires avant
export const SKILL_TREES = [
  { id: 'build', name: 'Constructeur', icon: '🔨', color: '#e0a54a' },
  { id: 'gather', name: 'Récolteur', icon: '🪓', color: '#7fc46a' },
  { id: 'fight', name: 'Combattant', icon: '⚔', color: '#e06a5a' },
  { id: 'move', name: 'Mobilité', icon: '💨', color: '#4aa8d8' },
];
export const SKILLS = [
  // Constructeur : surtout la résistance des constructions, puis les tours
  { id: 'c_hp1', tree: 'build', row: 0, col: 1, name: 'Charpentier', desc: 'Constructions +25% de vie', cost: 2, req: [] },
  { id: 'c_speed', tree: 'build', row: 1, col: 0, name: 'Bâtisseur rapide', desc: 'Construction 40% plus rapide', cost: 3, req: ['c_hp1'] },
  { id: 'c_hp2', tree: 'build', row: 1, col: 1, name: 'Bois renforcé', desc: 'Constructions +50% de vie', cost: 5, req: ['c_hp1'] },
  { id: 'c_cost', tree: 'build', row: 1, col: 2, name: 'Économe', desc: 'Constructions 25% moins chères', cost: 5, req: ['c_hp1'] },
  { id: 'c_tower', tree: 'build', row: 2, col: 0, name: 'Tour d’archer', desc: 'Débloque la tour d’archer (1 dégât par flèche, tir rapide)', cost: 6, req: ['c_speed'] },
  { id: 'c_stone', tree: 'build', row: 2, col: 1, name: 'Maçonnerie', desc: 'Débloque le mur de pierre (très solide)', cost: 8, req: ['c_hp2'] },
  { id: 'c_repair', tree: 'build', row: 2, col: 2, name: 'Entretien', desc: 'Les constructions se réparent toutes seules le jour', cost: 8, req: ['c_cost'] },
  { id: 'c_frost', tree: 'build', row: 3, col: 0, name: 'Tour de givre', desc: 'Débloque la tour de givre : ralentit déplacement et attaques des monstres', cost: 12, req: ['c_tower'] },
  { id: 'c_hp3', tree: 'build', row: 3, col: 1, name: 'Fortifications', desc: 'Constructions +100% de vie', cost: 14, req: ['c_stone'] },
  { id: 'c_spikes', tree: 'build', row: 3, col: 2, name: 'Pièges à pieux', desc: 'Débloque les pieux : blessent et ralentissent les monstres', cost: 12, req: ['c_repair'] },
  { id: 'c_arrows', tree: 'build', row: 4, col: 0, name: 'Flèches lourdes', desc: 'Les tours d’archer font 3 dégâts', cost: 18, req: ['c_frost'] },
  { id: 'c_hp4', tree: 'build', row: 4, col: 1, name: 'Bastion', desc: 'Constructions encore +100% de vie', cost: 22, req: ['c_hp3'] },
  // Récolteur
  { id: 'g_speed', tree: 'gather', row: 0, col: 1, name: 'Bras solides', desc: 'Récolte 25% plus rapide', cost: 2, req: [] },
  { id: 'g_wood', tree: 'gather', row: 1, col: 0, name: 'Bûcheron', desc: '+1 bois par arbre, +1 brindille par buisson', cost: 3, req: ['g_speed'] },
  { id: 'g_stone', tree: 'gather', row: 1, col: 2, name: 'Carrier', desc: '+1 pierre par rocher', cost: 3, req: ['g_speed'] },
  { id: 'g_bush', tree: 'gather', row: 2, col: 0, name: 'Cueilleur', desc: 'Buissons : soin 2× et +1 brindille', cost: 4, req: ['g_wood'] },
  { id: 'g_power', tree: 'gather', row: 2, col: 1, name: 'Coup net', desc: 'Moins de coups pour abattre arbres et rochers', cost: 6, req: ['g_speed'] },
  { id: 'g_carry', tree: 'gather', row: 2, col: 2, name: 'Porteur', desc: 'Porter le Joyau ne ralentit plus', cost: 5, req: ['g_stone'] },
  { id: 'g_bag', tree: 'gather', row: 3, col: 1, name: 'Grand sac', desc: '+1 de chaque ressource récoltée', cost: 12, req: ['g_power'] },
  { id: 'g_lucky', tree: 'gather', row: 4, col: 0, name: 'Main chanceuse', desc: '25% de chance de doubler la récolte', cost: 16, req: ['g_bag'] },
  { id: 'g_speed2', tree: 'gather', row: 4, col: 1, name: 'Infatigable', desc: 'Récolte encore 35% plus rapide', cost: 18, req: ['g_bag'] },
  { id: 'g_max', tree: 'gather', row: 4, col: 2, name: 'Récolte parfaite', desc: 'Toujours au moins 3 de base par ressource', cost: 22, req: ['g_bag'] },
  // Combattant
  { id: 'f_dmg1', tree: 'fight', row: 0, col: 1, name: 'Lame aiguisée', desc: '+25% de dégâts', cost: 2, req: [] },
  { id: 'f_hp', tree: 'fight', row: 1, col: 0, name: 'Robuste', desc: '+30 points de vie', cost: 3, req: ['f_dmg1'] },
  { id: 'f_move', tree: 'fight', row: 1, col: 2, name: 'Agile', desc: '+12% de vitesse de déplacement', cost: 3, req: ['f_dmg1'] },
  { id: 'f_regen', tree: 'fight', row: 2, col: 0, name: 'Régénération', desc: 'Récupère ta vie 2× plus vite', cost: 5, req: ['f_hp'] },
  { id: 'f_aspd', tree: 'fight', row: 2, col: 1, name: 'Frappe rapide', desc: 'Attaques 30% plus rapides', cost: 8, req: ['f_dmg1'] },
  { id: 'f_armor', tree: 'fight', row: 2, col: 2, name: 'Peau de pierre', desc: '−25% de dégâts reçus', cost: 8, req: ['f_move'] },
  { id: 'f_dmg2', tree: 'fight', row: 3, col: 1, name: 'Lame lourde', desc: '+50% de dégâts en plus', cost: 14, req: ['f_aspd'] },
  { id: 'f_cleave', tree: 'fight', row: 4, col: 1, name: 'Coup circulaire', desc: 'Chaque coup touche tous les monstres autour', cost: 20, req: ['f_dmg2'] },
  // Mobilité : endurance, dash (Maj), double saut…
  { id: 'm_stam1', tree: 'move', row: 0, col: 1, name: 'Endurance', desc: '+30 d’endurance', cost: 2, req: [] },
  { id: 'm_dash', tree: 'move', row: 1, col: 0, name: 'Dash', desc: 'Appuie sur Maj : bond rapide dans la direction du mouvement (30 d’endurance)', cost: 4, req: ['m_stam1'] },
  { id: 'm_djump', tree: 'move', row: 1, col: 1, name: 'Double saut', desc: 'Saute une 2ᵉ fois en l’air (15 d’endurance)', cost: 5, req: ['m_stam1'] },
  { id: 'm_regen', tree: 'move', row: 1, col: 2, name: 'Second souffle', desc: 'L’endurance revient 50% plus vite', cost: 3, req: ['m_stam1'] },
  { id: 'm_dodge', tree: 'move', row: 2, col: 0, name: 'Esquive', desc: 'Invulnérable pendant le dash', cost: 8, req: ['m_dash'] },
  { id: 'm_jump', tree: 'move', row: 2, col: 1, name: 'Bond', desc: 'Sauts 25% plus hauts', cost: 6, req: ['m_djump'] },
  { id: 'm_sprint', tree: 'move', row: 2, col: 2, name: 'Coureur', desc: 'Courir use 40% d’endurance en moins', cost: 6, req: ['m_regen'] },
  { id: 'm_dash2', tree: 'move', row: 3, col: 0, name: 'Dash éclair', desc: 'Dash 40% moins cher et 30% plus long', cost: 12, req: ['m_dodge'] },
  { id: 'm_glide', tree: 'move', row: 3, col: 1, name: 'Planeur', desc: 'Garde Espace enfoncé en l’air pour planer', cost: 12, req: ['m_jump'] },
  { id: 'm_stam2', tree: 'move', row: 3, col: 2, name: 'Grand souffle', desc: '+50 d’endurance', cost: 12, req: ['m_sprint'] },
  { id: 'm_charge', tree: 'move', row: 4, col: 0, name: 'Charge', desc: 'Le dash blesse les monstres traversés', cost: 18, req: ['m_dash2'] },
  { id: 'm_speed', tree: 'move', row: 4, col: 2, name: 'Vent du nord', desc: '+10% de vitesse de déplacement', cost: 18, req: ['m_stam2'] },
];
// Compétences retirées dans une mise à jour (remboursées automatiquement)
export const OLD_SKILLS = { c_stairs: 3, c_door: 5, g_carry_old: 0 };
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

// Endurance : courir, dash, double saut
export const STAMINA = { max: 100, regen: 22, delay: 0.7, sprint: 14, dash: 30, djump: 15 };
export const DASH = { speed: 22, time: 0.18, dodge: 0.3 };

// ---------- Expérience du héros ----------
// XP totale pour atteindre le niveau n (niveau 1 = 0 XP) : 60, 180, 360, 600…
export const xpForLevel = (n) => 30 * (n - 1) * n;
export function levelOf(xp) { let n = 1; while (xpForLevel(n + 1) <= xp && n < 99) n++; return n; }
export const XP_KILL = { brute: 3, runner: 4, spitter: 6, tank: 25 };
export const xpForNight = (n) => 15 + 10 * n;
// bonus de niveau : +2 PV et +1 % de dégâts par niveau
export const heroBonus = (lvl) => ({ hp: 2 * (lvl - 1), dmg: 1 + 0.01 * (lvl - 1) });

// Effets des compétences possédées
export function skillMods(list = [], level = 1) {
  const has = new Set(list);
  const hb = heroBonus(level);
  return {
    has,
    buildHp: 1 + (has.has('c_hp1') ? 0.25 : 0) + (has.has('c_hp2') ? 0.5 : 0) + (has.has('c_hp3') ? 1 : 0) + (has.has('c_hp4') ? 1 : 0),
    buildTime: has.has('c_speed') ? 0.6 : 1,
    costMul: has.has('c_cost') ? 0.75 : 1,
    repair: has.has('c_repair'),
    towerDmg: has.has('c_arrows') ? TOWER.heavyDmg : TOWER.dmg,
    harvestSpeed: (has.has('g_speed') ? 1.25 : 1) * (has.has('g_speed2') ? 1.35 : 1),
    woodBonus: has.has('g_wood') ? 1 : 0,
    stoneBonus: has.has('g_stone') ? 1 : 0,
    allBonus: has.has('g_bag') ? 1 : 0,
    minYield: has.has('g_max') ? 3 : 1,
    lucky: has.has('g_lucky'),
    hitPow: has.has('g_power') ? 1.5 : 1,
    bush: has.has('g_bush'),
    carry: has.has('g_carry'),
    dmg: (has.has('f_dmg1') ? 1.25 : 1) * (has.has('f_dmg2') ? 1.5 : 1) * hb.dmg,
    maxHp: PLAYER_HP + (has.has('f_hp') ? 30 : 0) + hb.hp,
    speed: (has.has('f_move') ? 1.12 : 1) * (has.has('m_speed') ? 1.1 : 1),
    atkSpeed: has.has('f_aspd') ? 1.3 : 1,
    regen: has.has('f_regen') ? 2 : 1,
    armor: has.has('f_armor') ? 0.75 : 1,
    cleave: has.has('f_cleave'),
    // mobilité
    stamina: STAMINA.max + (has.has('m_stam1') ? 30 : 0) + (has.has('m_stam2') ? 50 : 0),
    stamRegen: STAMINA.regen * (has.has('m_regen') ? 1.5 : 1),
    sprintCost: STAMINA.sprint * (has.has('m_sprint') ? 0.6 : 1),
    dash: has.has('m_dash'),
    dashCost: STAMINA.dash * (has.has('m_dash2') ? 0.6 : 1),
    dashDist: has.has('m_dash2') ? 1.3 : 1,
    dodge: has.has('m_dodge'),
    charge: has.has('m_charge'),
    djump: has.has('m_djump'),
    jump: has.has('m_jump') ? 1.12 : 1,   // ≈ +25 % de hauteur
    glide: has.has('m_glide'),
  };
}
export function pieceCost(type, mods) {
  const c = PIECES[type].cost, k = mods ? mods.costMul : 1;
  const out = {};
  for (const r of RES_KEYS) out[r] = Math.ceil((c[r] || 0) * k);
  return out;
}
export const canAfford = (inv, cost) => RES_KEYS.every((r) => (inv[r] || 0) >= cost[r]);
export const pieceUnlocked = (type, mods) => !PIECES[type].skill || (mods && mods.has.has(PIECES[type].skill));

// ---------- Outils ----------
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w) * 2 - 1;
}
export function seededRandom(seed) {
  let s = Math.floor(seed) % 2147483647; if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ---------- Rivière ----------
export function riverZ(x) {
  return 36 + Math.sin(x * 0.023 + 0.4) * 14 + Math.sin(x * 0.061 + 1.3) * 5;
}
export function riverDist(x, z) {
  return Math.abs(z - riverZ(x));
}

// ---------- Plateau à l'est : la rivière tombe en cascade ----------
export const CLIFF = { x0: 102.5, x1: 105.5, h: 9 };
export const plateau = (x) => smoothstep(CLIFF.x0, CLIFF.x1, x) * CLIFF.h;
export const WATERFALL = { x: 104, z: riverZ(104) };
export const waterLevelAt = (x) => WATER_LEVEL + plateau(x);

// Relief de base (sans les grottes)
function baseHeight(x, z) {
  let h = Math.sin(x * 0.045) * Math.cos(z * 0.038) * 1.6
    + Math.sin(x * 0.013 + 1.3) * Math.sin(z * 0.017 + 0.7) * 3.2
    + Math.sin(x * 0.11 + z * 0.07) * 0.25
    + Math.cos(z * 0.13 - x * 0.05) * 0.2;
  h *= smoothstep(4, 22, Math.hypot(x, z));
  const bank = 1 - smoothstep(3.2, 9.0, riverDist(x, z));
  h += (-1.7 - h) * bank;
  // bassin au pied de la cascade
  const pool = 1 - smoothstep(4, 8, Math.hypot(x - (CLIFF.x0 - 2), z - WATERFALL.z));
  h -= pool * 0.9;
  return h + plateau(x);
}

// ---------- Grottes (le sol y est aplani, un dôme de roche les recouvre) ----------
// x, z : centre · r : rayon intérieur · ex, ez : bout du tunnel d'entrée · h : hauteur du dôme
function makeCave(id, x, z, r, ex, ez, h) {
  return { id, x, z, r, ex, ez, h, floor: baseHeight(ex, ez) + 0.05 };
}
const GZ = riverZ(110) - 10;
export const CAVES = [
  // Grotte cachée derrière la cascade (on y entre depuis le bassin, à travers le rideau d'eau)
  makeCave('grotto', 110.5, GZ, 5, 100.2, GZ, 0),
  // Caverne au sud-ouest, creusée dans une colline rocheuse
  makeCave('cavern', -104, -102, 7.5, -97, -95, 0),
];
CAVES[0].h = CLIFF.h - CAVES[0].floor + 1.2;
CAVES[1].h = 7.5;
export const RELIC_POS = { x: CAVES[0].x + 1.5, z: CAVES[0].z };

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function caveK(c, x, z) {
  const dC = Math.hypot(x - c.x, z - c.z);
  const dT = segDist(x, z, c.x, c.z, c.ex, c.ez);
  return Math.max(1 - smoothstep(c.r, c.r + 2.5, dC), 1 - smoothstep(2.3, 4.2, dT));
}
export function caveAt(x, z) {
  for (const c of CAVES) if (Math.hypot(x - c.x, z - c.z) < c.r + 1) return c;
  return null;
}

// ---------- Relief ----------
export function heightAt(x, z) {
  let h = baseHeight(x, z);
  for (const c of CAVES) {
    if (Math.abs(x - c.x) > 25 || Math.abs(z - c.z) > 25) continue;
    const k = caveK(c, x, z);
    if (k > 0) h += (c.floor - h) * k;
  }
  return h;
}

export function dirtAt(x, z) {
  const d = Math.sin(x * 0.071 + 1.7 * Math.sin(z * 0.043)) * Math.sin(z * 0.067 + 1.3 * Math.sin(x * 0.037));
  return smoothstep(0.62, 0.85, d);
}

export const isWater = (x, z) => (riverDist(x, z) < 7.5 || Math.hypot(x - (CLIFF.x0 - 2), z - WATERFALL.z) < 7) && heightAt(x, z) < waterLevelAt(x) - 0.15;

// ---------- Placement des arbres et rochers ----------
export function isFreeSpot(x, z, others, minDist, extra = []) {
  if (Math.abs(x) > WORLD_LIMIT - 3 || Math.abs(z) > WORLD_LIMIT - 3) return false;
  if (Math.hypot(x - GEM_HOME.x, z - GEM_HOME.z) < 11) return false;
  if (riverDist(x, z) < 9.5) return false;
  if (x > CLIFF.x0 - 3 && x < CLIFF.x1 + 2) return false;            // falaise
  for (const c of CAVES) if (caveK(c, x, z) > 0.01 || Math.hypot(x - c.x, z - c.z) < c.r + 5) return false;
  for (const o of others) if (Math.hypot(o.x - x, o.z - z) < minDist + (o.k === 'r' ? o.s : 0.8)) return false;
  for (const e of extra) if (Math.hypot(e.x - x, e.z - z) < e.r) return false;
  return true;
}

export function makeResource(rand, id, kind, x, z, rich) {
  if (rich) return { id, k: 'r', x: +x.toFixed(2), z: +z.toFixed(2), v: Math.floor(rand() * ROCK_VARIANTS), s: +(0.9 + rand() * 0.4).toFixed(2), rot: +(rand() * 6.28).toFixed(2), rich: 1 };
  if (kind === 'b') return { id, k: 'b', x: +x.toFixed(2), z: +z.toFixed(2), v: Math.floor(rand() * 3), s: +(0.7 + rand() * 0.6).toFixed(2), rot: +(rand() * 6.28).toFixed(2) };
  return kind === 't'
    ? { id, k: 't', x: +x.toFixed(2), z: +z.toFixed(2), v: rand() < 0.35 ? 4 + Math.floor(rand() * 2) : Math.floor(rand() * 4), s: +(0.85 + rand() * 0.35).toFixed(2), rot: 0 }
    : { id, k: 'r', x: +x.toFixed(2), z: +z.toFixed(2), v: Math.floor(rand() * ROCK_VARIANTS), s: +(0.55 + rand() * 0.95).toFixed(2), rot: +(rand() * 6.28).toFixed(2) };
}

export function generateResources(seed) {
  const rand = seededRandom(seed);
  const list = [];
  let n = 0;
  const L = WORLD_LIMIT - 3;
  for (let i = 0; i < 4000 && list.filter((r) => r.k === 't').length < 320; i++) {
    const x = (rand() * 2 - 1) * L, z = (rand() * 2 - 1) * L;
    if (!isFreeSpot(x, z, list, 2.2)) continue;
    list.push(makeResource(rand, 'n' + n++, 't', x, z));
  }
  for (let i = 0; i < 900 && list.filter((r) => r.k === 'r').length < 150; i++) {
    const x = (rand() * 2 - 1) * L, z = (rand() * 2 - 1) * L;
    if (!isFreeSpot(x, z, list, 2.0)) continue;
    list.push(makeResource(rand, 'n' + n++, 'r', x, z));
  }
  for (let i = 0; i < 900 && list.filter((r) => r.k === 'b').length < 230; i++) {
    const x = (rand() * 2 - 1) * L, z = (rand() * 2 - 1) * L;
    if (!isFreeSpot(x, z, list, 1.4)) continue;
    list.push(makeResource(rand, 'n' + n++, 'b', x, z));
  }
  // Rochers riches (veinés de cristal) au fond de la caverne
  const cv = CAVES[1];
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + 2.6, d = 3.8 + (i % 2) * 1.2;
    list.push(makeResource(rand, 'n' + n++, 'r', cv.x + Math.cos(a) * d, cv.z + Math.sin(a) * d, true));
  }
  // Quelques ressources près du départ pour bien commencer
  const near = [[9, 7, 't'], [-11, 4, 't'], [6, -12, 't'], [-7, -10, 'r'], [13, -3, 'r'], [-12, -3, 'b'], [4, 12, 'b']];
  for (const [x, z, k] of near) list.push(makeResource(rand, 'n' + n++, k, x, z));
  return list;
}

export const resourceRadius = (r) => (r.k === 't' ? 0.45 * r.s : r.k === 'b' ? 0.55 * r.s : r.s * 0.9);

// ---------- Bâtiments (géométrie partagée pour les collisions) ----------
export function stairsHeight(b, x, z) {
  // hauteur de la rampe d'un escalier (b.rot : 0 monte vers +z, 1 vers +x, 2 vers -z, 3 vers -x)
  const dx = x - b.x, dz = z - b.z;
  if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return null;
  const t = [dz, dx, -dz, -dx][b.rot & 3];
  // la rampe atteint le haut un peu avant le bord : on passe sans sauter sur le mur ou le plancher d'en haut
  return b.y + Math.min(1, Math.max(0, (t + 1) / 1.7)) * WALL_H;
}
export function wallBox(b) {
  // Rectangle au sol d'un mur : centre, demi-longueurs en x et z
  return b.rot ? { x: b.x, z: b.z, hx: 0.16, hz: GRID / 2 + 0.05 } : { x: b.x, z: b.z, hx: GRID / 2 + 0.05, hz: 0.16 };
}
export function pieceTop(b) {
  if (b.type === 'floor') return b.y;
  if (b.type === 'path') return -999;   // dalle collée au terrain : on marche sur le sol
  if (b.type === 'base') return b.y + WALL_H;
  if (b.type === 'roof') return b.y + 0.35;
  if (b.type === 'spikes') return b.y;
  if (b.type === 'tower' || b.type === 'frost') return b.y + 3.2;
  return b.y + WALL_H;
}
// Distance d'un point au rectangle (0 si dedans)
export function distToBox(px, pz, box) {
  const dx = Math.max(Math.abs(px - box.x) - box.hx, 0);
  const dz = Math.max(Math.abs(pz - box.z) - box.hz, 0);
  return Math.hypot(dx, dz);
}
// Deux pièces du même « emplacement » ne peuvent pas se superposer
// (un plancher et un objet posé dessus — escalier, charpente, tour… — peuvent cohabiter ;
//  la hauteur fait partie de l'emplacement pour pouvoir construire des étages)
const SLOT_GROUP = { floor: 'f', path: 'f', base: 'o', stairs: 'o', spikes: 'o', tower: 'o', frost: 'o', wall: 'w', door: 'w', stonewall: 'w', window: 'w', roof: 'r' };
export function slotKey(type, x, z, rot, y = 0) {
  const g = SLOT_GROUP[type] || type;
  return `${g}:${Math.round(x * 2)}:${Math.round(z * 2)}:${g === 'w' ? rot : 0}:${Math.round(y)}`;
}

// Soutien des étages : une pièce en hauteur (lv > 0) doit reposer sur une autre pièce soutenue.
// Renvoie l'ensemble des id soutenus (les autres s'écroulent).
export function supportedSet(list) {
  const top = (b) => (b.type === 'floor' ? b.y : b.type === 'roof' || b.type === 'path' ? null : b.y + WALL_H);
  const ok = new Set(), queue = [];
  for (const b of list) if (!b.lv) { ok.add(b.id); queue.push(b); }
  while (queue.length) {
    const a = queue.shift();
    const ta = top(a);
    for (const b of list) {
      if (ok.has(b.id)) continue;
      const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
      let sup = ta !== null && Math.abs(b.y - ta) < 0.35 && dx <= 1.15 && dz <= 1.15;
      // un plancher peut dépasser d'une case à côté d'un plancher soutenu (balcon)
      if (!sup && a.type === 'floor' && b.type === 'floor' && Math.abs(a.y - b.y) < 0.2 && dx + dz <= 2.1) sup = true;
      if (sup) { ok.add(b.id); queue.push(b); }
    }
  }
  return ok;
}


// ============================================================================
// Équipement : objets lâchés par les monstres (1 %), rareté selon la nuit
// ============================================================================
export const RARITIES = [
  { id: 0, name: 'Commun', color: '#b8b8b8', night: 1, suffix: '' },
  { id: 1, name: 'Peu commun', color: '#5fd35f', night: 2, suffix: ' du veilleur', k: 0.10, cap: 0.75 },
  { id: 2, name: 'Rare', color: '#4a9dff', night: 5, suffix: ' de la garde', k: 0.04, cap: 0.55 },
  { id: 3, name: 'Épique', color: '#b56cff', night: 10, suffix: ' runique', k: 0.025, cap: 0.5 },
  { id: 4, name: 'Légendaire', color: '#ffd23f', night: 15, suffix: ' légendaire', k: 0.025, cap: 0.5 },
  { id: 5, name: 'Mythique', color: '#ff8a2a', night: 20, suffix: ' mythique', k: 0.02, cap: 0.5 },
];
export const DROP_CHANCE = 0.01;
// Chances de chaque rareté à la nuit n : chaque rareté débloquée commence à 10 % et monte avec les nuits,
// en « prenant » sa part sur les raretés du dessous (les plus basses ne disparaissent jamais).
export function rarityOdds(night) {
  const n = Math.max(1, night);
  const share = RARITIES.map((r) => (r.id === 0 || n < r.night ? 0 : Math.min(r.cap, 0.10 + r.k * (n - r.night))));
  const out = new Array(RARITIES.length).fill(0);
  let rest = 1;
  for (let i = RARITIES.length - 1; i >= 1; i--) { out[i] = share[i] * rest; rest -= out[i]; }
  out[0] = rest;
  return out;
}
export function rollRarity(night, rnd = Math.random) {
  const o = rarityOdds(night);
  let x = rnd();
  for (let i = o.length - 1; i >= 0; i--) { if (x < o[i]) return i; x -= o[i]; }
  return 0;
}
// Emplacements : l'arme et la tenue dépendent de la classe
export const SLOTS = [
  { id: 'hat', name: 'Chapeau', stat: 'hp' },
  { id: 'chest', name: 'Tenue', stat: 'hp', byClass: true },
  { id: 'weapon', name: 'Arme', stat: 'dmg', byClass: true },
  { id: 'ring', name: 'Anneau', stat: 'dmg' },
  { id: 'boots', name: 'Bottes', stat: 'spd' },
];
export const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]));
export const ITEM_BASE = {
  hat: 'Chapeau', ring: 'Anneau', boots: 'Bottes',
  chest: { Knight: 'Plastron', Barbarian: 'Peau de bête', Mage: 'Robe', Rogue: 'Gilet' },
  weapon: { Knight: 'Épée', Barbarian: 'Hache', Mage: 'Bâton', Rogue: 'Arc' },
};
export const CLASS_NAMES = { Knight: 'Guerrier', Barbarian: 'Barbare', Mage: 'Mage', Rogue: 'Voleuse' };
const STAT_BASE = { weapon: 4, ring: 2.5, chest: 8, hat: 5, boots: 2 };   // % de dégâts, PV, % de vitesse
const RARITY_MUL = [1, 1.6, 2.4, 3.5, 5, 7];
export const INV_MAX = 60;
export const CLASS_CHANGE_COST = 3;
// ---------- Arbre de classe : compétence active (touche E) + caractéristiques ----------
// Chaque niveau donne 1 point : niveaux impairs → compétence (le 1er choisit la voie, les suivants l'améliorent),
// niveaux pairs → une caractéristique au choix. Amélioration : +0,5 s de durée (boost 'dur') ou -0,5 s de recharge
// (boost 'cd') ; jamais de recharge réduite sur une compétence « une fois par nuit ».
export const CLASS_SKILLS = {
  Knight: [
    { id: 'taunt', name: 'Taunt ultime', icon: '📯', once: true, dur: 10, boost: 'dur', desc: 'Une fois par nuit : attire tous les monstres de la carte vers toi pendant 10 s, et tu reçois 50 % de dégâts en moins. Plusieurs guerriers : chaque monstre va vers le plus proche.' },
    { id: 'bulwark', name: 'Dernier rempart', icon: '🛡', once: true, dur: 5, boost: 'dur', desc: 'Une fois par nuit : invulnérable pendant 5 s.' },
  ],
  Barbarian: [
    { id: 'rage', name: 'Rage', icon: '🔥', cd: 20, dur: 5, boost: 'dur', desc: 'Pendant 5 s : +60 % de vitesse de déplacement et vitesse d’attaque doublée. Recharge 20 s.' },
    { id: 'blood', name: 'Soif de sang', icon: '🩸', cd: 20, dur: 5, boost: 'dur', desc: 'Pendant 5 s : 50 % des dégâts infligés te soignent. Recharge 20 s.' },
  ],
  Mage: [
    { id: 'element', name: 'Élémentaire', icon: '❄', cd: 1, dur: 2, boost: 'dur', desc: 'Alterne feu / glace. La glace frappe un peu plus fort une seule cible et ralentit tous les monstres autour pendant 2 s.' },
    { id: 'blink', name: 'Blink', icon: '✨', cd: 10, boost: 'cd', desc: 'Téléporte d’environ 10 m vers l’avant. Recharge 10 s.' },
  ],
  Rogue: [
    { id: 'sentinel', name: 'Sentinelle', icon: '🔮', once: true, dur: 5, boost: 'dur', desc: 'Une orbe tourne autour de toi et tire sur les monstres à moins de 10 m. Une fois par nuit : sa cadence double pendant 5 s.' },
    { id: 'deadeye', name: 'Dead Eye', icon: '🎯', once: true, dur: 5, boost: 'dur', desc: 'Une fois par nuit : vue à la première personne, vise jusqu’à 10 cibles pendant 5 s (ou rappuie sur E), puis des flèches enflammées les frappent à 3× les dégâts.' },
  ],
};
export const CLASS_STATS = [
  { id: 'hp', name: '+10 points de vie', icon: '❤' },
  { id: 'dmg', name: '+1 % de dégâts', icon: '⚔' },
  { id: 'aspd', name: '+2 % de vitesse d’attaque', icon: '⏱' },
];
export const BOOST_STEP = 0.5;
export const SENTINEL = { range: 10, dmg: 0.4 };   // portée, part des dégâts de l'arc
export const DEADEYE = { max: 10, mul: 3, range: 60 };
export const ICE = { mul: 1.25 };   // glace : un peu plus de dégâts, une seule cible
export const classPoints = (level) => ({ skill: Math.ceil(level / 2), stat: Math.floor(level / 2) });
// Compétence active d'un joueur, avec ses améliorations : { def, dur, cd } ou null si aucune voie choisie
export function classSkill(ctree, cls, level) {
  const t = ctree?.[cls], def = t && CLASS_SKILLS[cls]?.find((s) => s.id === t.path);
  if (!def) return null;
  const n = Math.max(0, classPoints(level).skill - 1);
  const dur = (def.dur || 0) + (def.boost === 'dur' ? n * BOOST_STEP : 0);
  const cd = def.once ? 0 : Math.max(1, (def.cd || 0) - (def.boost === 'cd' ? n * BOOST_STEP : 0));
  return { def, dur, cd, boosts: n };
}
// Caractéristiques de l'arbre de classe (seuls les points disponibles au niveau actuel comptent)
export function applyClassTree(mods, ctree, cls, level) {
  const picks = (ctree?.[cls]?.picks || []).slice(0, classPoints(level).stat);
  for (const k of picks) {
    if (k === 'hp') mods.maxHp += 10;
    else if (k === 'dmg') mods.dmg *= 1.01;
    else if (k === 'aspd') mods.atkSpeed *= 1.02;
  }
  return mods;
}

// Forge : fusion de 5 objets identiques (même emplacement, classe et rareté) → rareté supérieure (70 %),
// fonte d'objets en férite (ressource future pour fabriquer de l'équipement)
export const FUSE_COUNT = 5;
export const FUSE_CHANCE = 0.7;
export const FERITE = [1, 2, 4, 8, 16, 32];   // férite par objet fondu, selon la rareté
export const fuseKey = (it) => `${it.slot}|${it.cls || ''}|${it.r}`;
export const SKILL_RESET_COST = 3;
export function makeItem(slot, cls, r, night, rnd = Math.random) {
  const S = SLOT_BY_ID[slot];
  const v = STAT_BASE[slot] * RARITY_MUL[r] * (1 + 0.04 * Math.max(0, night - 1)) * (0.85 + rnd() * 0.3);
  const base = S.byClass ? ITEM_BASE[slot][cls] : ITEM_BASE[slot];
  return {
    id: Math.floor(rnd() * 2 ** 40).toString(36) + Date.now().toString(36).slice(-4),
    slot, cls: S.byClass ? cls : null, r, lvl: night, name: base + RARITIES[r].suffix,
    stat: S.stat, val: S.stat === 'hp' ? Math.round(v) : Math.round(v * 10) / 10,
  };
}
export function randomItem(night, preferCls, rnd = Math.random) {
  const slot = SLOTS[Math.floor(rnd() * SLOTS.length)].id;
  const classes = Object.keys(CLASS_NAMES);
  const cls = preferCls && rnd() < 0.6 ? preferCls : classes[Math.floor(rnd() * classes.length)];
  return makeItem(slot, cls, rollRarity(night, rnd), night, rnd);
}
export const statLabel = (it) => it.stat === 'hp' ? `+${it.val} PV` : it.stat === 'dmg' ? `+${it.val} % de dégâts` : `+${it.val} % de vitesse`;
// L'équipement porté modifie les caractéristiques (après les compétences et le niveau)
export function applyGear(mods, items = [], equip = {}, cls = null) {
  let dmg = 0, hp = 0, spd = 0;
  for (const slot in equip) {
    const it = items.find((i) => i.id === equip[slot]);
    if (!it || it.slot !== slot || (it.cls && cls && it.cls !== cls)) continue;
    if (it.stat === 'dmg') dmg += it.val; else if (it.stat === 'hp') hp += it.val; else spd += it.val;
  }
  mods.dmg *= 1 + dmg / 100;
  mods.maxHp += hp;
  mods.speed *= 1 + Math.min(40, spd) / 100;
  mods.gear = { dmg, hp, spd };
  return mods;
}
