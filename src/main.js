'use strict';

// Brain Blight main process.
//
// One WebContentsView per platform, each with its own persistent session
// partition so logins survive restarts. All views are stacked in the same
// spot below a thin top bar; only the active one is on top. Hidden views are
// muted at the browser level and their preload script keeps their videos
// paused. Every "next" advances the platform you are leaving (in the
// background, so its next video is loaded and waiting) and then rotates to the
// next platform.

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, session, shell } = require('electron');
const { parseCookieFile, forDomains } = require('./cookies');

const BAR_HEIGHT = 44;

// ---------------------------------------------------------------------------
// Config

function loadConfig() {
  // BB_CONFIG lets you point at your own copy of the config without editing
  // the repo (also used by the smoke test).
  const file = process.env.BB_CONFIG
    ? path.resolve(process.env.BB_CONFIG)
    : path.join(__dirname, '..', 'config', 'platforms.js');
  const cfg = require(file);
  const platforms = (cfg.platforms || []).filter((p) => p.enabled !== false);
  if (platforms.length === 0) throw new Error(`No enabled platforms in ${file}`);
  return { platforms, input: cfg.input || {} };
}

const config = loadConfig();

// ---------------------------------------------------------------------------
// Settings (first-run flag)

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
}

// ---------------------------------------------------------------------------
// State

let win = null;
const views = []; // { platform, view, syntheticUntil }
const state = {
  mode: 'feed', // 'feed' | 'setup'
  active: 0,
  muted: false,
  lastNav: 0,
  notice: null,
};

// Sites block "Electron" browsers more often than plain Chrome, so drop the
// Electron and app tokens from the user agent.
function cleanUserAgent(ua) {
  return ua
    .replace(/\s?Electron\/\S+/g, '')
    .replace(/\s?brain-blight\/\S+/gi, '')
    .trim();
}
app.userAgentFallback = cleanUserAgent(app.userAgentFallback);

// ---------------------------------------------------------------------------
// Views

function createPlatformView(platform) {
  const partition = `persist:${platform.id}`;
  const ses = session.fromPartition(partition);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));

  const view = new WebContentsView({
    webPreferences: {
      partition,
      preload: path.join(__dirname, 'feed-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep hidden feeds alive so the next video is buffered when we return.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  view.setBackgroundColor('#000000');

  const entry = { platform, view, syntheticUntil: 0 };
  const wc = view.webContents;

  wc.setAudioMuted(true);
  wc.on('before-input-event', (event, input) => handleKey(event, input, entry));

  // Login flows (Google, TikTok) sometimes use popups. Keep them in the same
  // partition so the session they create is the one the feed uses.
  wc.setWindowOpenHandler(({ url }) => {
    if (!/^https?:/i.test(url)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520,
        height: 760,
        autoHideMenuBar: true,
        webPreferences: { partition, sandbox: true, contextIsolation: true },
      },
    };
  });

  // If a tab crashes, bring it back instead of leaving a black square.
  wc.on('render-process-gone', () => {
    setTimeout(() => {
      if (!wc.isDestroyed()) wc.loadURL(platform.feedUrl).catch(() => {});
    }, 1000);
  });

  return entry;
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const bounds = { x: 0, y: BAR_HEIGHT, width, height: Math.max(0, height - BAR_HEIGHT) };
  for (const { view } of views) view.setBounds(bounds);
}

function sendState(entry, isActive) {
  const wc = entry.view.webContents;
  if (wc.isDestroyed()) return;
  wc.send('bb:state', { active: isActive, mode: state.mode });
}

function setActive(index, { focus = true } = {}) {
  state.active = ((index % views.length) + views.length) % views.length;
  views.forEach((entry, i) => {
    const isActive = i === state.active;
    entry.view.webContents.setAudioMuted(isActive ? state.muted : true);
    sendState(entry, isActive);
  });
  const current = views[state.active];
  // Re-adding a child view moves it to the top of the stack.
  win.contentView.addChildView(current.view);
  if (focus) current.view.webContents.focus();
  pushUi();
}

function navigate(direction) {
  if (state.mode !== 'feed' || views.length === 0) return;
  const now = Date.now();
  if (now - state.lastNav < (config.input.cooldownMs ?? 450)) return;
  state.lastNav = now;
  state.notice = null;

  if (direction === 'prev') {
    // Go back to the previous platform's current video (no advancing).
    setActive(state.active - 1);
    return;
  }

  const leaving = views[state.active];
  if (views.length === 1) {
    leaving.view.webContents.send('bb:advance');
    return;
  }
  // Switch first so the platform we leave is already muted/paused while it
  // moves on to its next video in the background.
  setActive(state.active + 1);
  leaving.view.webContents.send('bb:advance');
}

function handleKey(event, input, entry) {
  if (input.type !== 'keyDown') return;
  if (entry && Date.now() < entry.syntheticUntil) return; // our own key press
  if (state.mode !== 'feed') return;
  if (input.alt || input.control || input.meta) return;
  if (input.key === 'ArrowDown' || input.key === 'PageDown') {
    event.preventDefault();
    navigate('next');
  } else if (input.key === 'ArrowUp' || input.key === 'PageUp') {
    event.preventDefault();
    navigate('prev');
  }
}

function entryFor(sender) {
  return views.find((e) => e.view.webContents === sender);
}

// ---------------------------------------------------------------------------
// First-run login / setup

function startSetup(index = 0) {
  state.mode = 'setup';
  state.notice = null;
  setupGo(index);
}

function setupGo(index) {
  const i = Math.max(0, Math.min(views.length - 1, index));
  state.setupIndex = i;
  setActive(i);
  const { view, platform } = views[i];
  view.webContents.loadURL(platform.loginUrl || platform.feedUrl).catch(() => {});
  pushUi();
}

function finishSetup() {
  state.mode = 'feed';
  writeSettings({ setupDone: true });
  for (const { view, platform } of views) view.webContents.loadURL(platform.feedUrl).catch(() => {});
  setActive(0);
}

// ---------------------------------------------------------------------------
// Import a login from a normal browser (cookie export)

async function importCookies(index, file) {
  const entry = views[index];
  if (!entry) return { imported: 0, failed: 0 };
  const { platform, view } = entry;

  if (!file) {
    const pick = await dialog.showOpenDialog(win, {
      title: `Import ${platform.name} login from your browser`,
      buttonLabel: 'Import',
      filters: [{ name: 'Cookie export (cookies.txt or JSON)', extensions: ['txt', 'json'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    file = pick.filePaths[0];
  }

  let cookies;
  try {
    cookies = forDomains(parseCookieFile(fs.readFileSync(file, 'utf8')), platform.cookieDomains);
  } catch (err) {
    if (!process.env.BB_HEADLESS) dialog.showErrorBox('Import failed', `That file couldn't be read as a cookie export.\n\n${err.message}`);
    return { imported: 0, failed: 0, error: err.message };
  }

  const ses = view.webContents.session;
  let imported = 0;
  let failed = 0;
  for (const c of cookies) {
    try {
      await ses.cookies.set(c);
      imported++;
    } catch {
      failed++;
    }
  }
  await ses.cookies.flushStore();

  // Show the feed with the imported login.
  if (imported > 0) view.webContents.loadURL(platform.feedUrl).catch(() => {});

  if (!process.env.BB_HEADLESS) {
    const domains = (platform.cookieDomains || []).join(', ');
    await dialog.showMessageBox(win, {
      type: imported ? 'info' : 'warning',
      message: imported ? `Imported your ${platform.name} login.` : `No ${platform.name} login found in that file.`,
      detail: imported
        ? `${imported} cookies imported${failed ? `, ${failed} skipped` : ''}. The feed is reloading; you should now be signed in.`
        : `Make sure you exported cookies while on ${domains} and signed in.`,
    });
  }
  return { imported, failed };
}

// ---------------------------------------------------------------------------
// UI bar

function pushUi() {
  if (!win || win.webContents.isDestroyed()) return;
  win.webContents.send('ui:state', {
    mode: state.mode,
    active: state.active,
    setupIndex: state.setupIndex ?? 0,
    muted: state.muted,
    notice: state.notice,
    platforms: views.map(({ platform }) => ({ id: platform.id, name: platform.name })),
  });
}

function setMuted(muted) {
  state.muted = muted;
  views[state.active]?.view.webContents.setAudioMuted(muted);
  pushUi();
}

function reloadCurrentFeed() {
  const entry = views[state.active];
  if (entry) entry.view.webContents.loadURL(entry.platform.feedUrl).catch(() => {});
}

ipcMain.on('ui:ready', () => pushUi());
ipcMain.on('ui:nav', (_e, dir) => navigate(dir === 'prev' ? 'prev' : 'next'));
ipcMain.on('ui:select', (_e, i) => {
  if (state.mode === 'setup') setupGo(Number(i));
  else setActive(Number(i));
});
ipcMain.on('ui:mute', () => setMuted(!state.muted));
ipcMain.on('ui:login', () => startSetup(state.active));
ipcMain.on('ui:setup-next', () => {
  if (state.setupIndex >= views.length - 1) finishSetup();
  else setupGo(state.setupIndex + 1);
});
ipcMain.on('ui:setup-back', () => setupGo(state.setupIndex - 1));
ipcMain.on('ui:setup-finish', () => finishSetup());
ipcMain.on('ui:reload', () => reloadCurrentFeed());
ipcMain.on('ui:import-cookies', () => importCookies(state.mode === 'setup' ? state.setupIndex : state.active));

// ---------------------------------------------------------------------------
// Feed preload IPC

ipcMain.on('bb:hello', (event) => {
  const entry = entryFor(event.sender);
  if (!entry) {
    event.returnValue = null;
    return;
  }
  event.returnValue = {
    platform: entry.platform,
    input: config.input,
    state: { active: views[state.active] === entry, mode: state.mode },
  };
});

ipcMain.on('bb:nav', (event, dir) => {
  const entry = entryFor(event.sender);
  // Only the visible feed may drive navigation.
  if (entry && entry === views[state.active]) navigate(dir === 'prev' ? 'prev' : 'next');
});

ipcMain.on('bb:press-key', (event, key) => {
  const entry = entryFor(event.sender);
  if (!entry || typeof key !== 'string') return;
  const keyCode = { ArrowDown: 'Down', ArrowUp: 'Up', ArrowRight: 'Right', ArrowLeft: 'Left' }[key] || key;
  entry.syntheticUntil = Date.now() + 250;
  const wc = entry.view.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
});

ipcMain.on('bb:advanced', (event, result) => {
  const entry = entryFor(event.sender);
  if (!entry) return;
  if (!result || !result.ok) {
    state.notice = `Couldn't move ${entry.platform.name} to its next video. Its selectors in config/platforms.js may need updating.`;
    console.warn(`[brain-blight] ${entry.platform.id}: advance failed`);
  } else if (process.env.BB_DEBUG) {
    console.log(`[brain-blight] ${entry.platform.id}: advanced via ${result.step}`);
  }
  pushUi();
});

// ---------------------------------------------------------------------------
// Menu

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Feed',
      submenu: [
        { label: 'Next', accelerator: 'Down', registerAccelerator: false, click: () => navigate('next') },
        { label: 'Previous platform', accelerator: 'Up', registerAccelerator: false, click: () => navigate('prev') },
        { type: 'separator' },
        { label: 'Log in to platforms…', accelerator: 'CmdOrCtrl+L', click: () => startSetup(state.active) },
        {
          label: 'Import login from browser…',
          accelerator: 'CmdOrCtrl+I',
          click: () => importCookies(state.mode === 'setup' ? state.setupIndex : state.active),
        },
        { label: 'Reload this feed', accelerator: 'CmdOrCtrl+R', click: () => reloadCurrentFeed() },
        { label: 'Mute / unmute', accelerator: 'CmdOrCtrl+Shift+M', click: () => setMuted(!state.muted) },
        { type: 'separator' },
        {
          label: 'Developer tools for this feed',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => views[state.active]?.view.webContents.toggleDevTools(),
        },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    // Needed on macOS so copy/paste works in login forms.
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Boot

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 900,
    minWidth: 360,
    minHeight: 500,
    title: 'Brain Blight',
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: path.join(__dirname, 'ui-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.on('before-input-event', (event, input) => handleKey(event, input, null));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  for (const platform of config.platforms) {
    const entry = createPlatformView(platform);
    views.push(entry);
    win.contentView.addChildView(entry.view);
  }
  layout();
  win.on('resize', layout);
  win.on('closed', () => {
    win = null;
    views.length = 0;
  });

  if (readSettings().setupDone && !process.env.BB_SETUP) {
    // Load every feed up front so each platform's first video is ready.
    for (const { view, platform } of views) view.webContents.loadURL(platform.feedUrl).catch(() => {});
    setActive(0);
  } else {
    startSetup(0);
  }
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Exposed for the smoke test only.
module.exports = { state, views, navigate, finishSetup, importCookies };
