# RPG 3D — base multijoueur

RPG multijoueur en 3D à la 3ème personne, jouable dans le navigateur.
Version actuelle : **ver.0.0.2**

## Contrôles
- **ZQSD / WASD / flèches** : se déplacer · **Maj** : courir · **Espace** : sauter
- **Souris** : caméra (souris capturée) · **Molette** : zoom
- **Clic gauche** : coup d'épée (maintenir pour enchaîner)
  - en visant un **arbre** : coupe de bois → l'arbre tombe au 5ème coup
  - en visant un **rocher** : casse-pierre → le rocher éclate au 4ème coup
- **F** : plein écran · **Échap** : libérer la souris
- **T** (maintenu) : accélérer le temps, pour voir le coucher de soleil et la nuit (test)

## Lancer en local
```bash
npm install
npm start
```
Puis ouvrir http://localhost:3001 (deux onglets = deux joueurs).

## Lancer / mettre à jour sur le VPS
```bash
cd ~/rpg3d
git pull
npm install
pm2 restart rpg3d
```

## Fichiers
- `server.js` — serveur : envoie le jeu, relaie les joueurs, garde l'état des arbres/rochers (repousse après 90 s)
- `public/index.html` — page du jeu (menu, viseur, interface)
- `public/js/main.js` — boucle du jeu, contrôles, caméra, réseau, cycle jour/nuit
- `public/js/character.js` — personnage articulé, animations, épée, cape
- `public/js/nature.js` — arbres, rochers, buissons, particules, lucioles
- `public/js/terrain.js` — relief et sol
- `public/js/sky.js` — ciel, soleil, lune, étoiles, nuages
- `public/js/grass.js` — herbe animée
