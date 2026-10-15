# Nuit Blanche — survie multijoueur

Jeu de survie et de construction en 3D à la 3ème personne, jouable dans le navigateur, de 1 à 4 joueurs.
Version actuelle : **ver.0.1.3**

## Comptes
Sur l'écran titre : **Créer un compte** (pseudo + mot de passe) ou **Se connecter**. La progression
(éclats, compétences, niveau du héros) est sauvegardée sur le serveur dans `data/accounts.json` et
`data/profiles.json` (mots de passe hachés avec scrypt). Le navigateur garde la session : la fois suivante,
un clic sur « Entrer au village » suffit. On peut aussi jouer en invité (progression liée au navigateur) ;
en créant un compte depuis ce navigateur, la progression d'invité est reprise.

## Héros, équipement et inventaire (touche I)
- La classe est choisie à la création du héros ; ensuite on la change au village depuis l'inventaire pour **3 éclats**.
- Les monstres lâchent un **coffre** dans 1 % des cas (on le ramasse en marchant dessus). L'objet va dans l'inventaire du compte.
- Emplacements : chapeau (vie), tenue (vie : plastron, peau de bête, robe ou gilet selon la classe), arme (dégâts, selon la classe),
  anneau (dégâts), bottes (vitesse de déplacement).
- Raretés : gris, vert (dès la nuit 2), bleu (nuit 5), violet (nuit 10), jaune (nuit 15), orange (nuit 20). Une rareté débloquée
  commence à 10 % et augmente avec les nuits ; les raretés basses ne disparaissent jamais. Exemple nuit 19 : 6 % gris, 18 % vert,
  30 % bleu, 26 % violet, 20 % jaune.

## Niveau du héros
Les monstres tués et les nuits survécues donnent de l'**expérience**. Chaque niveau donne +2 PV et +1 % de dégâts
(d'autres améliorations du héros viendront s'y ajouter).

## Le village (lobby)
On arrive au village, où l'on voit les autres joueurs.
- **Forge** : acheter des compétences avec les éclats (Constructeur, Récolteur, Combattant, Mobilité) ; « Réinitialiser l'arbre » rend tous les éclats dépensés, moins 3
- **Piédestal** : classement des meilleures parties (solo, duo, trio, équipe de 4)
- **Portail** : lancer la partie (seul, ou avec son groupe)
- Inviter un joueur : s'approcher de lui et appuyer sur **E**, ou **Tab** pour la liste

Les éclats se gagnent à chaque nuit survécue (1, 2, 3, 6, 10, 19…). Profils et classement sont
enregistrés sur le serveur dans le dossier `data/` (ignoré par git).

## Les classes
Chaque apparence a son style de combat :
| Classe | Arme | Style |
|---|---|---|
| Guerrier | Épée + bouclier | Coups rapides ; **clic droit maintenu** = parade (80 % des dégâts bloqués, on avance plus lentement) |
| Barbare | Hache à une main | Coups rapides qui touchent tous les monstres devant lui |
| Mage | Bâton de feu | Lance une **boule de feu** à distance : dégâts en zone à l'impact, puis brûlure (1 par seconde pendant 3 s) |
| Voleuse | Arc | Tir lent mais puissant, à distance (vise avec la caméra) |

## Le principe
- **Le jour** (4 min) : récolte du bois (arbres) et de la pierre (rochers), construis des défenses.
- **La nuit** (2 min) : des monstres arrivent en continu pour détruire **le Joyau** (squelettes de base, squelettes encapuchonnés rapides dès la nuit 2, mages squelettes dès la nuit 5, Colosses en armure dès la nuit 8). Ils attaquent les joueurs sur leur route et cassent les murs qui les bloquent.
- Les monstres apparaissent loin du Joyau (70 à 90 m) : on a le temps d'aller à leur rencontre.
- Le nombre de monstres augmente à chaque nuit et avec le nombre de joueurs. Un monstre qui poursuit un joueur pendant 8 s sans réussir à le toucher abandonne et fonce vers le Joyau jusqu'à sa mort.
- Si le Joyau est détruit, la partie recommence. Au lever du soleil, les monstres brûlent.
- Le Joyau peut être porté (touche **E**) **10 secondes** au maximum, puis il tombe et doit se reposer 10 secondes.
- Après une défaite, on revient tout de suite au village avec un panneau qui explique comment devenir plus fort.

## Lieux spéciaux
- **Cascade** à l'est : la rivière tombe d'un plateau.
- **Grotte cachée** derrière la cascade : on y trouve la **Larme de la cascade** (une fois par partie) — celui qui la prend tue les monstres en un coup pendant la nuit suivante.
- **Caverne** au sud-ouest : rochers riches en cristaux (+3 pierre).

## Contrôles (modifiables dans Options)
| Touche | Action |
|---|---|
| ZQSD / flèches | Se déplacer |
| Maj (maintenu) | Courir (use l'endurance, barre verte) |
| Maj (appui) | Dash — compétence Mobilité |
| Espace | Sauter (2ᵉ appui en l'air : double saut ; maintenu : planer — compétences Mobilité) |
| Clic gauche | Attaque de la classe / hache (arbre) / pioche (rocher) |
| Clic droit (maintenu) | Parade au bouclier (Guerrier) |
| B | Fenêtre de construction (choisir une pièce) |
| F | Déconstruire (dans le menu de construction) |
| E | Prendre / poser le Joyau |
| M | Carte |
| Entrée | Chat |
| I | Héros et inventaire |
| R | Réparer la construction visée (mode construction) |
| G | Coup de poing à un allié tout proche (il est assommé 2 s et roule par terre) |
| Échap | Ferme le menu ouvert / quitte la construction / pause |

## Constructions
L'inventaire (bois, pierre, brindilles) est commun à tout le groupe. Les buissons donnent des brindilles.

| Pièce | Coût |
|---|---|
| Plancher | 2 bois + 1 pierre |
| Charpente (pilotis, on marche dessus) | 4 bois |
| Mur | 2 bois |
| Fenêtre | 2 bois |
| Porte | 3 bois |
| Escalier (monte d'un étage) | 3 bois |
| Toit | 1 bois + 3 brindilles |
| Dalle de chemin (+15 % de vitesse dessus) | 1 pierre |
| Mur de pierre* | 4 pierre |
| Pieux* | 2 bois + 1 pierre |
| Tour d'archer* | 5 bois + 3 pierre |
| Tour de givre* | 3 bois + 5 pierre |

\* à débloquer à la forge (arbre Constructeur)

**Déconstruire** rend la moitié des matériaux. **Réparer** (R) une pièce abîmée coûte la moitié de son prix × la part de vie
perdue ; la compétence Entretien les répare gratuitement pendant le jour.

**Grille** : en mode construction, une grille de cases de 2 m s'affiche au sol. Au rez-de-chaussée, une pièce se cale
à la hauteur de ses voisines (planchers, charpentes, murs) pour que tout s'emboîte même sur un terrain en pente.

**Étages** : pendant la construction, la **molette** monte / descend d'un étage (Maj + molette change de pièce).
Un étage repose sur une charpente, sur des murs, ou en balcon à côté d'un plancher déjà en hauteur.
Si ce qui le porte est détruit, il s'écroule. Les monstres au corps à corps ne peuvent pas atteindre
un joueur perché (les mages squelettes, si). Les tours peuvent être posées en hauteur.

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

## Lanceur Windows (.exe)
Le dossier `launcher/` contient un petit programme (Electron) qui ouvre le jeu dans sa propre fenêtre.
Le jeu est chargé depuis le serveur : il est donc toujours à jour. Le lanceur lui-même se met à jour
tout seul à partir des « Releases » GitHub. Il est indépendant de The Curse (autre identifiant, autre dossier).
1. L'adresse du jeu est dans `launcher/config.json` (`http://51.210.104.194:3001/`).
2. Vérifier `owner` / `repo` dans `launcher/package.json` (section `publish`).
3. GitHub > Actions > « Lanceur Windows » > Run workflow : l'installateur `NuitBlanche-Setup-x.y.z.exe` apparaît dans les Releases.
4. Pour publier une mise à jour du lanceur : augmenter `version` dans `launcher/package.json`, relancer l'action.

## Fichiers
- `server.js` — serveur : lobby/groupes, cycle jour/nuit, IA des monstres, ressources, constructions, chat, admin
- `public/index.html`, `public/style.css`, `public/ui.css` — page et interface (thème Kenney UI Pack Adventure, images dans `public/ui/`)
- `public/js/world.js` — règles et géographie partagées entre le serveur et le navigateur
- `public/js/main.js` — boucle du jeu, contrôles, caméra, réseau, interface
- `public/js/models.js` — chargement des modèles 3D du dossier `public/models`
- `public/js/character.js` — personnages jouables (pack KayKit Adventurers), outils et animations
- `public/js/monster.js` — les squelettes (KayKit Skeletons), leurs animations et la tête qui tombe
- `public/js/gem.js` — le Joyau
- `public/js/buildings.js` — constructions
- `public/js/audio.js` — musiques et bruitages (générés par le code)
- `public/js/nature.js` — arbres, rochers, buissons, cailloux (KayKit Forest Nature), particules
- `public/js/grass.js` — touffes d'herbe animées
- `public/js/terrain.js`, `sky.js`, `grass.js` — sol, rivière, ciel, herbe
- `public/js/map.js` — carte et mini-carte
- `public/js/settings.js` — options et touches
- `public/js/village.js` — le village (lobby jouable)
- `public/js/villageDecor.js` — décor du village (remparts, bannières, étals…) et le forgeron
- `public/js/features.js` — cascade, grotte, caverne et relique
- `public/models/` — modèles 3D (.glb)

## Crédits
Modèles 3D, tous sous licence CC0 (libres, même pour un usage commercial) :
- **KayKit** de Kay Lousberg ([kaylousberg.com](https://kaylousberg.com)) : Adventurers (personnages et forgeron), Skeletons (monstres), Forest Nature Pack (arbres, rochers, buissons, herbe), Dungeon Pack et RPG Tools (décor du village, outils).
- **Medieval Village Pack** (maisons, moulin, clocher, puits, étals, charrettes) pour le village.
- **Pirate Kit** de [Quaternius](https://quaternius.com) : bûches, cailloux et gemmes.
- **KayKit Character Animations** (Kay Lousberg, CC0) : animations de combat, d'outils, des squelettes et du forgeron.
- **Kenney UI Pack Adventure** (Kenney, CC0) : toute l'interface.
- **Wood Frame Base Build Set** : constructions en bois (planchers, charpentes, murs, fenêtres, porte, escalier, toit).
