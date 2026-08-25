const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { installApplicationMenu } = require("./menu");
const { startBackend, stopBackend } = require("./backend");
const config = require("./config");

const DEV_URL = `http://localhost:${process.env.HIVEMARK_WEB_PORT || 3000}`;

let mainWindow = null;
let settingsWindow = null;

function checkReachable(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, { timeout: timeoutMs }, (res) => {
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

function serveStaticExport() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath === "/") urlPath = "/index.html";

      let filePath = path.join(WEB_OUT_DIR, urlPath);
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

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
    server.on("error", reject);
  });
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
    shell.openExternal(url);
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
function applyConfigAndRestart() {
  app.relaunch();
  app.exit();
}

ipcMain.handle("set-server-url", (_event, url) => {
  config.setServerUrl(url);
  applyConfigAndRestart();
});
ipcMain.handle("use-local-server", () => {
  config.clearServerUrl();
  applyConfigAndRestart();
});

let resolvedBackendUrl = `http://localhost:${process.env.HIVEMARK_BACKEND_PORT || 4001}`;

app.whenReady().then(async () => {
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
