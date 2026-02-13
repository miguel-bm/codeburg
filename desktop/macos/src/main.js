const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, safeStorage, shell } = require('electron');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const FRONTEND_DEV_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:3000';
const CONFIG_FILENAME = 'desktop-config.json';
const AUTH_TOKEN_FILENAME = 'auth-token.json';
const DEFAULT_SERVER_ORIGIN = 'http://127.0.0.1:8080';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const isDevMode = process.env.CODEBURG_ELECTRON_DEV === '1';

let mainWindow = null;
let distServer = null;

app.setName('Codeburg');

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

function getFrontendDistDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend-dist');
  }
  return path.join(ROOT_DIR, 'frontend', 'dist');
}

function readConnectionConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function getAuthTokenPath() {
  return path.join(app.getPath('userData'), AUTH_TOKEN_FILENAME);
}

function readStoredAuthToken() {
  try {
    const raw = fs.readFileSync(getAuthTokenPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const encrypted = parsed.encrypted === true;
    if (typeof parsed.payload !== 'string' || !parsed.payload) {
      return null;
    }

    const payload = Buffer.from(parsed.payload, 'base64');
    if (encrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        return null;
      }
      return safeStorage.decryptString(payload);
    }
    return payload.toString('utf8');
  } catch {
    return null;
  }
}

function writeStoredAuthToken(token) {
  const tokenPath = getAuthTokenPath();
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });

  const shouldEncrypt = safeStorage.isEncryptionAvailable();
  const payload = shouldEncrypt
    ? safeStorage.encryptString(token).toString('base64')
    : Buffer.from(token, 'utf8').toString('base64');

  const content = {
    version: 1,
    encrypted: shouldEncrypt,
    payload,
  };

  fs.writeFileSync(tokenPath, JSON.stringify(content), 'utf8');
}

function clearStoredAuthToken() {
  try {
    fs.rmSync(getAuthTokenPath(), { force: true });
  } catch {
    // Ignore delete failures.
  }
}

function writeConnectionConfig(config) {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function hasScheme(value) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
}

function normalizeServerOrigin(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = hasScheme(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeApiHttpBase(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function normalizeApiWsBase(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function toWsOrigin(httpOrigin) {
  const parsed = new URL(httpOrigin);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return parsed.origin;
}

function hasConfiguredConnectionTarget() {
  const config = readConnectionConfig();
  const serverOrigin = normalizeServerOrigin(config.serverOrigin);
  const apiHttpBase = normalizeApiHttpBase(config.apiHttpBase);
  const apiWsBase = normalizeApiWsBase(config.apiWsBase);

  const hasStoredConfig = Boolean(serverOrigin || (apiHttpBase && apiWsBase));
  const hasEnvConfig = Boolean(
    normalizeServerOrigin(process.env.CODEBURG_SERVER_ORIGIN) ||
      (normalizeApiHttpBase(process.env.CODEBURG_API_HTTP_BASE) &&
        normalizeApiWsBase(process.env.CODEBURG_API_WS_BASE))
  );

  return hasStoredConfig || hasEnvConfig;
}

function resolveRuntimeConfig() {
  const config = readConnectionConfig();
  const serverOrigin =
    normalizeServerOrigin(process.env.CODEBURG_SERVER_ORIGIN) ||
    normalizeServerOrigin(config.serverOrigin) ||
    DEFAULT_SERVER_ORIGIN;

  const apiHttpBase =
    normalizeApiHttpBase(process.env.CODEBURG_API_HTTP_BASE) ||
    normalizeApiHttpBase(config.apiHttpBase) ||
    `${serverOrigin}/api`;

  const apiWsBase =
    normalizeApiWsBase(process.env.CODEBURG_API_WS_BASE) ||
    normalizeApiWsBase(config.apiWsBase) ||
    toWsOrigin(serverOrigin);

  if (isDevMode && !hasConfiguredConnectionTarget()) {
    // Let Vite dev server proxy /api and /ws in local development.
    return {};
  }

  return {
    apiHttpBase,
    apiWsBase,
    platform: 'desktop-macos-electron',
    titleBarInsetTop: 32,
  };
}

function getSetupPagePath() {
  return path.join(__dirname, 'setup.html');
}

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function resolveRequestedPath(distDir, requestUrl) {
  const pathname = new URL(requestUrl, 'http://127.0.0.1').pathname;
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === '/' ? '/index.html' : decoded;
  const normalized = path.normalize(path.join(distDir, requested));
  const relative = path.relative(distDir, normalized);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return normalized;
}

function createDistServer() {
  return new Promise((resolve, reject) => {
    const distDir = getFrontendDistDir();
    const distIndex = path.join(distDir, 'index.html');

    if (!fs.existsSync(distIndex)) {
      reject(new Error(`Frontend build not found at ${distIndex}`));
      return;
    }

    const server = http.createServer((req, res) => {
      const target = resolveRequestedPath(distDir, req.url ?? '/');
      let filePath = target;
      if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = distIndex;
      }

      fs.readFile(filePath, (error, content) => {
        if (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Failed to load frontend assets.');
          return;
        }

        res.writeHead(200, {
          'Content-Type': getMimeType(filePath),
          'Cache-Control': 'no-cache',
        });
        res.end(content);
      });
    });

    server.on('error', reject);
    server.listen(0, 'localhost', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine local frontend server address'));
        return;
      }

      resolve({
        server,
        url: `http://localhost:${address.port}`,
      });
    });
  });
}

async function ensureDistServer() {
  if (distServer) {
    return distServer;
  }
  distServer = await createDistServer();
  return distServer;
}

async function loadRenderer(windowRef) {
  if (isDevMode) {
    await windowRef.loadURL(FRONTEND_DEV_URL);
    return;
  }

  const localServer = await ensureDistServer();
  await windowRef.loadURL(localServer.url);
}

function isAllowedNavigation(targetUrl) {
  if (targetUrl === 'about:blank') {
    return true;
  }

  if (targetUrl.startsWith('file://')) {
    return true;
  }

  try {
    const parsed = new URL(targetUrl);
    if (isDevMode) {
      const devOrigin = new URL(FRONTEND_DEV_URL).origin;
      return parsed.origin === devOrigin;
    }
    if (distServer) {
      const distOrigin = new URL(distServer.url).origin;
      return parsed.origin === distOrigin;
    }
  } catch {
    return false;
  }

  return false;
}

function bindSecurityGuards(windowRef) {
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  windowRef.webContents.on('will-navigate', (event, targetUrl) => {
    if (isAllowedNavigation(targetUrl)) {
      return;
    }
    event.preventDefault();
    shell.openExternal(targetUrl);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    title: 'Codeburg',
    backgroundColor: '#f4f7fb',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  bindSecurityGuards(mainWindow);

  if (isDevMode || hasConfiguredConnectionTarget()) {
    await loadRenderer(mainWindow);
  } else {
    await mainWindow.loadFile(getSetupPagePath());
  }

  if (isDevMode) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

async function navigateToSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();

  const currentUrl = mainWindow.webContents.getURL();
  if (!currentUrl || currentUrl.startsWith('file://')) {
    if (hasConfiguredConnectionTarget()) {
      await loadRenderer(mainWindow);
    } else {
      return;
    }
  }

  try {
    await mainWindow.webContents.executeJavaScript(
      'window.location.assign("/settings");',
      true,
    );
  } catch {
    // Ignore navigation errors if renderer is still initializing.
  }
}

function buildApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const appName = app.getName();
  const template = [
    ...(isMac
      ? [{
          label: appName,
          submenu: [
            { role: 'about', label: `About ${appName}` },
            { type: 'separator' },
            {
              label: 'Preferences...',
              accelerator: 'Cmd+,',
              click: () => {
                void navigateToSettings();
              },
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDevMode ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Codeburg Documentation',
          click: () => {
            void shell.openExternal('https://github.com/miguel-bm/codeburg');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

ipcMain.on('desktop:get-runtime-config-sync', (event) => {
  event.returnValue = resolveRuntimeConfig();
});

ipcMain.on('desktop:auth-token-get-sync', (event) => {
  event.returnValue = readStoredAuthToken();
});

ipcMain.on('desktop:auth-token-set-sync', (event, token) => {
  if (typeof token !== 'string' || token.length === 0) {
    event.returnValue = false;
    return;
  }
  writeStoredAuthToken(token);
  event.returnValue = true;
});

ipcMain.on('desktop:auth-token-clear-sync', (event) => {
  clearStoredAuthToken();
  event.returnValue = true;
});

ipcMain.handle('desktop:get-runtime-config', () => resolveRuntimeConfig());

ipcMain.handle('desktop:get-connection-config', () => {
  const config = readConnectionConfig();
  return {
    serverOrigin: normalizeServerOrigin(config.serverOrigin),
  };
});

ipcMain.handle('desktop:set-server-origin', (_event, serverOriginInput) => {
  const serverOrigin = normalizeServerOrigin(serverOriginInput);
  if (!serverOrigin) {
    throw new Error('Server origin must be a valid http:// or https:// URL');
  }

  writeConnectionConfig({ serverOrigin });
  return {
    ok: true,
    runtimeConfig: resolveRuntimeConfig(),
  };
});

ipcMain.handle('desktop:launch-app', async () => {
  if (!mainWindow) {
    return false;
  }
  await loadRenderer(mainWindow);
  return true;
});

app.whenReady().then(async () => {
  buildApplicationMenu();
  await createWindow();
}).catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to initialize macOS shell', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (distServer) {
    distServer.server.close();
    distServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});
