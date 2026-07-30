const { app } = require("electron");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const BACKEND_PORT = process.env.HIVEMARK_BACKEND_PORT || 4001;
const HEALTH_URL = `http://localhost:${BACKEND_PORT}/api/health`;

// Dev: run the server straight from apps/server via the workspace-hoisted tsx
// binary, same as a developer would with `npm run dev` in that package.
// Packaged: apps/server's dist/ + node_modules + package.json are copied into
// resourcesPath/server (see package.json "build".extraResources), and we run
// dist/index.js under Electron's own bundled Node (ELECTRON_RUN_AS_NODE=1),
// so a packaged install doesn't depend on the user having Node installed.
const SERVER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "server")
  : path.join(__dirname, "..", "..", "server");

let child = null;

function waitForHealth(timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(HEALTH_URL, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Hivemark backend didn't come up within ${timeoutMs}ms`));
        return;
      }
      setTimeout(tryOnce, 300);
    };
    tryOnce();
  });
}

async function startBackend() {
  if (app.isPackaged) {
    child = spawn(process.execPath, [path.join(SERVER_DIR, "dist", "index.js")], {
      cwd: SERVER_DIR,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(BACKEND_PORT) },
      stdio: "inherit",
    });
  } else {
    const tsxBin = path.join(__dirname, "..", "..", "..", "node_modules", ".bin", "tsx");
    child = spawn(tsxBin, ["src/index.ts"], {
      cwd: SERVER_DIR,
      env: { ...process.env, PORT: String(BACKEND_PORT) },
      stdio: "inherit",
    });
  }

  child.on("exit", (code) => {
    if (code !== null && code !== 0) console.error(`Hivemark backend exited with code ${code}`);
    child = null;
  });

  await waitForHealth(15000);
}

function stopBackend() {
  if (child) {
    child.kill();
    child = null;
  }
}

module.exports = { startBackend, stopBackend };
