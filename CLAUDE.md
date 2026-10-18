# Nuit Blanche (rpg3d)

Survie/construction multijoueur 3D (1 à 4 joueurs) dans le navigateur. Règles du jeu, contrôles et liste des fichiers : voir `README.md`.

## Technique
- Node.js ≥ 18, modules ES. Serveur `server.js` : Express + WebSocket (`ws`). Client : Three.js 0.170 (importmap dans `public/index.html`).
- Entrée du client : `public/js/main.js`. `public/game.js` semble être une ancienne version non chargée : ne pas la modifier sans vérifier.
- `public/js/world.js` est partagé serveur + navigateur : un changement de règle s'y fait une seule fois.
- Le serveur fait autorité (monstres, ressources, constructions, dégâts). Le client envoie des messages `{ type: ... }`, le serveur les valide (`clamp`, `num`) : garder cette validation.
- Données joueurs dans `data/` (comptes, profils, classement) : ignoré par git, ne jamais le supprimer ni l'écraser.
- `launcher/` : lanceur Electron Windows, construit par GitHub Actions (`.github/workflows/launcher.yml`).

- Caractéristiques d'un joueur : `computeMods()` (compétences + niveau + équipement), identique client et serveur.
- Pas de bundler ni de framework. Audio 100 % synthétisé (`audio.js`), aucun fichier son.
- Mode admin caché `/god` : ne jamais le mentionner aux joueurs (ni `/aide`, ni chat, ni README).
- Le jeu s'appelle Nuit Blanche, mais dossier, processus pm2 et clés localStorage restent `rpg3d` : ne pas renommer.

## Commandes
- Lancer : `npm install` puis `npm start` → http://localhost:3001
- Pas de tests automatiques : `node --check` sur `server.js` et chaque fichier de `public/js/`, puis jouer.
- Crochets de test dans le navigateur : `window.__game` (`pause()`, `advance(s)`, `send()`, `setView()`…). En navigateur automatisé, avancer le temps avec `advance()` plutôt qu'attendre.

## Déploiement
VPS 51.210.104.194 : `cd ~/rpg3d && git pull && npm install && pm2 restart rpg3d`. Ce qui est sur `main` part en production : passer par une branche + PR. Un restart coupe les parties en cours.
Le VPS héberge aussi **The Curse** : ne jamais toucher à ses processus, son dossier ni son port.

## Conventions
- Code, commentaires et textes du jeu en français.
- Chaque livraison augmente la version : `VERSION` dans `world.js`, `package.json`, `index.html` et `README.md`.

## À faire
- Modèles 3D d'équipement affichés sur le personnage (aujourd'hui seulement des icônes SVG dans `hero.js`). L'utilisateur a modélisé chapeaux et plastrons par classe dans Blender (`G:\Telechargements\PACK 3d\*.blend`, à exporter en .glb).

## Bugs connus et limites
- Anti-triche : le client décide de sa position (bornée à ±150 m) ; vitesse non validée côté serveur.
- Pas de HTTPS ; le jeton de profil sert de session et n'expire jamais.
- `data/` réécrit en entier à chaque sauvegarde, sans sauvegarde automatique.
- Arc de la voleuse retourné en 0.1.2 : à revérifier sous tous les angles.
- Grille de construction : alignement raté sur pentes très raides.
- Maison `v_house_a` noire : retirée du placement, encore dans `village.glb`.
- Performances du village (~12 Mo de modèles) jamais mesurées sur un petit PC.
- Grotte derrière la cascade : pas encore le nouveau décor de rochers.
