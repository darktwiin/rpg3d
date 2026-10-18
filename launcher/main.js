// Lanceur du jeu : une vraie fenêtre (pas un onglet de navigateur) qui charge le jeu en ligne.
// - le jeu lui-même est toujours à jour (il est chargé depuis le serveur à chaque lancement)
// - le lanceur se met à jour tout seul via les « Releases » GitHub (electron-updater)
// Ce lanceur est indépendant de celui de The Curse : autre appId, autre dossier de données, autre dépôt.
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const GAME_URL = process.env.NUIT_BLANCHE_URL || config.gameUrl;

// une seule instance du jeu à la fois
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 800, minWidth: 960, minHeight: 600,
    title: config.title || 'Nuit Blanche',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#1a120a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.setFullScreen(true); win.show(); });   // plein écran dès le lancement (F11 pour en sortir)
  // F11 : plein écran · F5 : recharger · Ctrl+Maj+I : outils (dépannage)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F5') { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    if (input.key === 'I' && input.control && input.shift) win.webContents.toggleDevTools();
  });
  // les liens externes s'ouvrent dans le navigateur
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // serveur injoignable : petite page « hors ligne » avec un bouton pour réessayer
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || url.startsWith('file:')) return;
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: GAME_URL } });
  });
  win.loadURL(GAME_URL, { extraHeaders: 'pragma: no-cache\n' });
}

app.whenReady().then(() => {
  createWindow();
  // mise à jour du lanceur (téléchargée en arrière-plan, installée à la fermeture)
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', async (info) => {
    const r = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Redémarrer maintenant', 'Plus tard'], defaultId: 0,
      title: 'Mise à jour', message: `Une nouvelle version du lanceur (${info.version}) est prête.`,
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', () => { /* pas de connexion ou pas de release : on joue quand même */ });
  if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
