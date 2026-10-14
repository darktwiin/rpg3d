# RPG 3D — base multijoueur

Base d'un RPG multijoueur en 3D à la 3ème personne, jouable dans le navigateur.
Version actuelle : **ver.0.0.1** — déplacement du personnage uniquement.

## Contrôles
- **ZQSD / WASD / flèches** : se déplacer
- **Souris** : tourner la caméra (la souris est capturée, elle ne sort pas de la fenêtre)
- **Molette** : zoom
- **Espace** : sauter · **Maj** : courir
- **F** : plein écran on/off · **Échap** : libérer la souris

## Lancer en local
```bash
npm install
npm start
```
Puis ouvrir http://localhost:3001 (deux onglets = deux joueurs).

## Lancer sur le VPS
```bash
git clone https://github.com/darktwiin/rpg3d.git
cd rpg3d
npm install
pm2 start server.js --name rpg3d
```
Mise à jour : `cd rpg3d && git pull && npm install && pm2 restart rpg3d`

Le port par défaut est **3001** (modifiable avec la variable `PORT`).

## Fichiers
- `server.js` — serveur Node : envoie la page et relaie les positions des joueurs
- `public/index.html` — page du jeu (menu, interface)
- `public/game.js` — le jeu 3D (Three.js) : monde, personnage, caméra, réseau
