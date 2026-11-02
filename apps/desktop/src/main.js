const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");
const https = require("https");
const fs = require("fs");
const { installApplicationMenu } = require("./menu");
const { startBackend, stopBackend } = require("./backend");
const config = require("./config");

const DEV_URL = `http://localhost:${process.env.HIVEMARK_WEB_PORT || 3000}`;

let mainWindow = null;
let settingsWindow = null;

function checkReachable(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = (url.startsWith("https:") ? https : http).get(`${url}/api/health`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Packaged builds copy the Next.js static export into extraResources (see
// package.json "build".extraResources), so it lives next to the app at
// process.resourcesPath/web-out. When running unpackaged (dev, or
// HIVEMARK_FORCE_PROD=1 for local testing of the static-export path), fall
// back to the sibling apps/web/out directory relative to this file.
const WEB_OUT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "web-out")
  : path.join(__dirname, "..", "..", "web", "out");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Fixed port so the renderer's origin (and with it localStorage: session
// token, theme) is stable across launches; falls back to an OS-assigned port
// if something else already holds it.
const STATIC_PORT = 4011;
let staticExportUrl = null;

function serveStaticExport() {
  // One server per app run — macOS "activate" re-creates the window, and a
  // fresh server (new port, new origin) would drop localStorage each time.
  staticExportUrl ??= new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath;
      try {
        urlPath = decodeURIComponent(req.url.split("?")[0]);
      } catch {
        res.writeHead(400);
        res.end("Bad request");
        return;
      }
      if (urlPath === "/") urlPath = "/index.html";

      let filePath = path.join(WEB_OUT_DIR, urlPath);
      // Encoded slashes (/..%2f..%2fetc/passwd) survive the client's own
      // dot-segment normalization and would let path.join escape WEB_OUT_DIR.
      if (!filePath.startsWith(WEB_OUT_DIR + path.sep)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = `${filePath}.html`;
      }
      if (!fs.existsSync(filePath)) {
        filePath = path.join(WEB_OUT_DIR, "404.html");
      }

      const ext = path.extname(filePath);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end("Internal server error");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        res.end(data);
      });
    });

    server.on("listening", () => resolve(`http://127.0.0.1:${server.address().port}`));
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") server.listen(0, "127.0.0.1");
      else reject(err);
    });
    server.listen(STATIC_PORT, "127.0.0.1");
  });
  return staticExportUrl;
}

async function createWindow(backendUrl) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0e0f14",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sandboxed preload can't read config.js/fs itself — this is the
      // sanctioned channel for handing it small static data at creation time.
      additionalArguments: [`--hivemark-backend-url=${backendUrl}`],
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only hand web URLs to the OS — file:, smb:, custom app protocols etc.
    // can launch local programs.
    let protocol = null;
    try {
      protocol = new URL(url).protocol;
    } catch {}
    if (protocol === "http:" || protocol === "https:") shell.openExternal(url);
    return { action: "deny" };
  });

  const isDev =
    process.env.HIVEMARK_FORCE_PROD === "1" ? false : !app.isPackaged || process.env.HIVEMARK_DEV === "1";

  if (isDev) {
    await win.loadURL(DEV_URL);
  } else {
    const url = await serveStaticExport();
    await win.loadURL(url);
  }
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 320,
    resizable: false,
    title: "Connect to Server",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--hivemark-backend-url=${config.getServerUrl() ?? ""}`],
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow.loadFile(path.join(__dirname, "serverSettings.html"));
}

// Applies a new config by relaunching the whole app so startup logic (spawn
// local backend vs. connect remote) re-runs from scratch, rather than trying
// to hot-swap an already-running backend/renderer mid-session.
// ponytail: app.relaunch() has a known quirk on Linux AppImage builds (the
// mounted binary path can be gone by relaunch time) — untested here, no
// Linux box available. If that's ever reported, fall back to a
// dialog.showMessageBox telling the user to quit and reopen manually.
// app.exit() skips before-quit, so stop the local backend explicitly — and
// wait for it, or the relaunched instance races it for the port.
async function applyConfigAndRestart() {
  await stopBackend();
  app.relaunch();
  app.exit();
}

// preload exposes these to every window, including the main one, which can
// end up on remote pages (OAuth providers, a configured server) — only the
// local settings window may change where the app connects.
function fromSettingsWindow(event) {
  return settingsWindow !== null && event.sender === settingsWindow.webContents;
}

ipcMain.handle("set-server-url", (event, url) => {
  if (!fromSettingsWindow(event)) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  config.setServerUrl(url);
  return applyConfigAndRestart();
});
ipcMain.handle("use-local-server", (event) => {
  if (!fromSettingsWindow(event)) return;
  config.clearServerUrl();
  return applyConfigAndRestart();
});

let resolvedBackendUrl = `http://localhost:${process.env.HIVEMARK_BACKEND_PORT || 4001}`;

// A second instance would spawn its own backend, lose the port race to ours,
// silently share it, and then kill it out from under us when it quits.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  installApplicationMenu(createSettingsWindow);

  const configuredUrl = config.getServerUrl();
  if (configuredUrl) {
    resolvedBackendUrl = configuredUrl;
    const reachable = await checkReachable(configuredUrl, 5000);
    if (!reachable) {
      console.error(`Configured server ${configuredUrl} is unreachable — the app will still open, but won't load.`);
    }
  } else {
    try {
      await startBackend();
    } catch (err) {
      console.error("Failed to start Hivemark backend:", err);
    }
  }

  createWindow(resolvedBackendUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(resolvedBackendUrl);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopBackend();
});
