'use strict';
const { app, BrowserWindow, ipcMain, shell, nativeImage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const port = Number(process.env.STUDYDASH_PORT || 47322);
const origin = `http://127.0.0.1:${port}`;
const localPages = new Set(['/', '/index.html', '/import']);
const connect = /^\/api\/(classroom|gmail|hcstmail|outlook)\/connect$/;
const colors = /^#[0-9a-f]{6}$/i;
const browserPartition = 'persist:study-browser';
const overlay = { color: '#000000', symbolColor: '#ffffff', height: 34 };
let window;
const browserSessions = new WeakSet();

const profileRoot = process.env.STUDYDASH_PROFILE_ROOT || process.env.STUDYDASH_DATA || path.join(app.getPath('appData'), 'StudyDash Production Desktop');
app.setPath('userData', path.join(profileRoot, 'window', String(port)));
const iconDirectory = process.env.STUDYDASH_DATA || path.join(app.getPath('appData'), 'StudyDash Production');
const savedIcon = path.join(iconDirectory, 'themed-icon.png');
const packagedExecutable=process.env.STUDYDASH_DESKTOP_EXE;
app.setAppUserModelId('StudyDash.Production');
let backendReady;
function readyBackend(){
  if(!packagedExecutable)return Promise.resolve();
  return backendReady ||= require('./backend.cjs').ensureBackend({root:path.join(__dirname,'..'),executable:packagedExecutable,dataDirectory:iconDirectory,port,environment:{...process.env,STUDYDASH_PROFILE_ROOT:profileRoot}});
}
function startupError(error){dialog.showErrorBox('StudyDash could not start',error.message);app.quit()}

function updateIcon(value) {
  if (typeof value !== 'string' || value.length > 200000 || !value.startsWith('data:image/png;base64,')) return;
  const image = nativeImage.createFromDataURL(value);
  if (image.isEmpty()) return;
  const size = image.getSize();
  if (size.width !== 256 || size.height !== 256) return;
  window.setIcon(image);
  const png = image.toPNG(), header = Buffer.alloc(22);
  header.writeUInt16LE(1,2); header.writeUInt16LE(1,4);
  header.writeUInt16LE(1,10); header.writeUInt16LE(32,12);
  header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18);
  try {
    fs.mkdirSync(iconDirectory, { recursive: true });
    fs.writeFileSync(savedIcon,png);
    fs.writeFileSync(path.join(iconDirectory,'icon.png'),png);
    fs.writeFileSync(path.join(iconDirectory,'themed-icon.ico'),Buffer.concat([header,png]));
  } catch (error) { console.error('Could not save the themed icon', error); }
}

function route(value) {
  let url;
  try { url = new URL(value); } catch { return; }
  if (url.origin === origin && localPages.has(url.pathname)) return 'local';
  if (url.origin === origin && connect.test(url.pathname)) return 'external';
  if (url.protocol === 'https:' || url.protocol === 'http:') return 'external';
}

function openExternal(url) {
  if (route(url) === 'external') shell.openExternal(url).catch(console.error);
}

function canBrowse(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !/^(localhost\.?|127\.|0\.|\[)/i.test(url.hostname)
      && !url.username && !url.password;
  } catch { return false; }
}

function showWindow() {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 1320, height: 880, minWidth: 480, minHeight: 520,
    title: 'StudyDash', icon: fs.existsSync(savedIcon) ? savedIcon : path.join(__dirname, '..', 'icon.ico'),
    backgroundColor: '#000000', autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: overlay,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true },
  });
  window.removeMenu();
  const contents = window.webContents;
  contents.on('will-attach-webview', (event, preferences, params) => {
    if (route(contents.getURL()) !== 'local' || params.partition !== browserPartition || !canBrowse(params.src)) {
      event.preventDefault();
      return;
    }
    delete preferences.preload;
    delete preferences.preloadURL;
    Object.assign(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false });
  });
  contents.on('did-attach-webview', (_event, guest) => {
    if (!browserSessions.has(guest.session)) {
      browserSessions.add(guest.session);
      const cookies = guest.session.cookies;
      cookies.on('changed', () => { cookies.flushStore().catch(() => {}); });
    }
    guest.session.setPermissionRequestHandler((_sender, _permission, respond) => respond(false));
    guest.session.setPermissionCheckHandler(() => false);
    guest.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, respond) =>
      respond({ cancel: !canBrowse(request.url) }));
    // Keep fullscreen owned by StudyDash even when a video has keyboard focus.
    guest.session.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (request, respond) => {
      const headers = request.responseHeaders;
      if (request.resourceType !== 'mainFrame' || !headers) return respond({});
      const name = Object.keys(headers).find(key => key.toLowerCase() === 'permissions-policy') || 'Permissions-Policy';
      const policies = (headers[name] || []).flatMap(value => value.split(',')).filter(value => !/^\s*fullscreen\s*=/i.test(value));
      respond({ responseHeaders: { ...headers, [name]: [...policies, 'fullscreen=()'] } });
    });
    guest.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape' || !window?.isFullScreen()) return;
      event.preventDefault();
      contents.executeJavaScript('document.fullscreenElement ? document.exitFullscreen().then(() => true) : false')
        .catch(() => false).then(exited => {
          if (!exited && window && !window.isDestroyed()) window.setFullScreen(false);
        });
    });
    const guardGuest = event => { if (!canBrowse(event.url)) event.preventDefault(); };
    guest.on('will-navigate', guardGuest);
    guest.on('will-redirect', guardGuest);
    guest.setWindowOpenHandler(({ url }) => {
      if (canBrowse(url)) guest.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
  });
  const canFullscreen = (sender, permission, url, mainFrame) =>
    sender === contents && permission === 'fullscreen' && mainFrame && route(url) === 'local';
  contents.session.setPermissionRequestHandler((sender, permission, respond, details) =>
    respond(canFullscreen(sender, permission, details.requestingUrl, details.isMainFrame)));
  contents.session.setPermissionCheckHandler((sender, permission, requestingOrigin, details) =>
    canFullscreen(sender, permission, requestingOrigin, details.isMainFrame));
  const guardNavigation = event => {
    if (route(event.url) === 'local') return;
    event.preventDefault();
    if (event.isMainFrame) openExternal(event.url);
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);
  contents.setWindowOpenHandler(({ url }) => {
    if (route(url) === 'local') window.loadURL(url).catch(console.error);
    else openExternal(url);
    return { action: 'deny' };
  });
  window.on('closed', () => { window = null; });
  window.loadURL(origin).catch(console.error);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.argv.includes('--quit')) {
  app.quit();
} else {
  app.on('second-instance', (_event,args) => {
    if(args.includes('--quit'))return app.quit();
    if(!args.includes('--background'))app.whenReady().then(readyBackend).then(showWindow).catch(startupError);
  });
  app.on('window-all-closed', () => app.quit());
  ipcMain.on('studydash:caption', (event, color, symbolColor) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) return;
    if (route(event.senderFrame.url) !== 'local' || typeof color !== 'string' || !colors.test(color)) return;
    if (symbolColor !== '#000000' && symbolColor !== '#ffffff') return;
    window.setTitleBarOverlay({ ...overlay, color, symbolColor });
  });
  ipcMain.on('studydash:icon', (event, value) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) return;
    if (route(event.senderFrame.url) !== 'local') return;
    updateIcon(value);
  });
  app.whenReady().then(readyBackend).then(()=>{
    if(process.argv.includes('--background'))app.quit();
    else showWindow();
  }).catch(startupError);
}
