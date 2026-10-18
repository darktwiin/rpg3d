# Nuit Blanche (rpg3d)

Survie/construction multijoueur 3D (1 à 4 joueurs) dans le navigateur. Règles du jeu, contrôles et liste des fichiers : voir `README.md`.

## Technique
- Node.js ≥ 18, modules ES. Serveur `server.js` : Express + WebSocket (`ws`). Client : Three.js 0.170 (importmap dans `public/index.html`).
- Entrée du client : `public/js/main.js`. `public/game.js` semble être une ancienne version non chargée : ne pas la modifier sans vérifier.
- `public/js/world.js` est partagé serveur + navigateur : un changement de règle s'y fait une seule fois.
- Le serveur fait autorité (monstres, ressources, constructions, dégâts). Le client envoie des messages `{ type: ... }`, le serveur les valide (`clamp`, `num`) : garder cette validation.
- Données joueurs dans `data/` (comptes, profils, classement) : ignoré par git, ne jamais le supprimer ni l'écraser.
- `launcher/` : lanceur Electron Windows, construit par GitHub Actions (`.github/workflows/launcher.yml`).

## Commandes
- Lancer : `npm install` puis `npm start` → http://localhost:3001
- Pas de tests automatiques : vérifier en lançant le serveur (`node --check server.js` au minimum) et en jouant.

## Déploiement
VPS 51.210.104.194 : `git pull && npm install && pm2 restart rpg3d`. Ce qui est sur `main` part en production : passer par une branche + PR.

## Conventions
- Code, commentaires et textes du jeu en français.
- Après une modification visible par les joueurs, mettre à jour `README.md` et la version dans `package.json`.
