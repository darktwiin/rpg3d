# RPG 3D — Survie multijoueur

Jeu de survie et de construction en 3D à la 3ème personne, jouable dans le navigateur, de 1 à 4 joueurs.
Version actuelle : **ver.0.0.4**

## Le village (lobby)
On entre son pseudo et on arrive au village, où l'on voit les autres joueurs.
- **Forge** : acheter des compétences avec les éclats (Constructeur, Récolteur, Combattant)
- **Piédestal** : classement des meilleures parties (solo, duo, trio, équipe de 4)
- **Portail** : lancer la partie (seul, ou avec son groupe)
- Inviter un joueur : s'approcher de lui et appuyer sur **E**, ou **Tab** pour la liste

Les éclats se gagnent à chaque nuit survécue (1, 2, 3, 6, 10, 19…). Profils et classement sont
enregistrés sur le serveur dans le dossier `data/` (ignoré par git).

## Le principe
- **Le jour** (6 min) : récolte du bois (arbres) et de la pierre (rochers), construis des défenses.
- **La nuit** (3 min) : des monstres arrivent en continu pour détruire **le Joyau** (Rôdeurs, Griffus dès la nuit 2, Cracheurs dès la nuit 5). Ils attaquent les joueurs sur leur route et cassent les murs qui les bloquent.
- Si le Joyau est détruit, la partie recommence. Au lever du soleil, les monstres brûlent.
- Le Joyau peut être porté (touche **E**) et posé où vous voulez, par exemple dans votre base.

## Contrôles (modifiables dans Options)
| Touche | Action |
|---|---|
| ZQSD / flèches | Se déplacer |
| Maj | Courir |
| Espace | Sauter |
| Clic gauche | Épée / hache (arbre) / pioche (rocher) |
| F | Menu de construction (1 Sol · 2 Mur · 3 Toit, clic droit pour démolir) |
| E | Prendre / poser le Joyau |
| M | Carte |
| Entrée | Chat |
| Échap | Menu pause / options |

## Constructions
| Pièce | Coût |
|---|---|
| Sol | 2 bois + 2 pierre |
| Mur | 3 bois |
| Toit | 2 bois + 1 pierre |
| Escalier* | 3 bois + 1 pierre |
| Porte* | 4 bois |
| Mur de pierre* | 1 bois + 5 pierre |
| Pieux* | 3 bois + 1 pierre |

\* à débloquer à la forge

## Admin
Tape `/god` dans le chat (hôte du groupe ou partie solo) : faire apparaître des monstres,
passer au jour / crépuscule / nuit, invulnérabilité, construction gratuite, téléportation sur la carte.

## Lancer en local
```bash
npm install
npm start
```
Puis ouvrir http://localhost:3001

## Mettre à jour sur le VPS
```bash
cd ~/rpg3d
git pull
npm install
pm2 restart rpg3d
```

## Fichiers
- `server.js` — serveur : lobby/groupes, cycle jour/nuit, IA des monstres, ressources, constructions, chat, admin
- `public/index.html`, `public/style.css` — page et interface
- `public/js/world.js` — règles et géographie partagées entre le serveur et le navigateur
- `public/js/main.js` — boucle du jeu, contrôles, caméra, réseau, interface
- `public/js/character.js` — personnage, outils et animations
- `public/js/monster.js` — le monstre et ses animations
- `public/js/gem.js` — le Joyau
- `public/js/buildings.js` — constructions
- `public/js/audio.js` — musiques et bruitages (générés par le code)
- `public/js/nature.js` — arbres, rochers, particules
- `public/js/terrain.js`, `sky.js`, `grass.js` — sol, rivière, ciel, herbe
- `public/js/map.js` — carte et mini-carte
- `public/js/settings.js` — options et touches
- `public/js/village.js` — le village (lobby jouable)
