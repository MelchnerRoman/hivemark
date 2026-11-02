const { app } = require("electron");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");

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

// A packaged app launched from Finder/Dock (or a desktop launcher) gets the
// bare system PATH (/usr/bin:/bin:/usr/sbin:/sbin), so the backend's spawns
// of `claude`, `goose` and `npx` (Homebrew, nvm, ~/.local/bin...) fail with
// ENOENT. Ask the user's login shell for its PATH instead.
function userShellPath() {
  if (!app.isPackaged || process.platform === "win32") return process.env.PATH;
  try {
    const out = execFileSync(process.env.SHELL || "/bin/sh", ["-ilc", 'echo "__HIVEMARK_PATH__=$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.match(/__HIVEMARK_PATH__=(.*)/)?.[1] || process.env.PATH;
  } catch {
    return process.env.PATH;
  }
}

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
      env: {
        ...process.env,
        PATH: userShellPath(),
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(BACKEND_PORT),
        // Keep the DB/files out of the app bundle (replaced on every update).
        HIVEMARK_DATA_DIR: path.join(app.getPath("userData"), "data"),
      },
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

// Resolves once the backend has exited (or after a grace period), so callers
// that relaunch the app don't race the old process for the port.
function stopBackend() {
  if (!child) return Promise.resolve();
  const exiting = child;
  child = null;
  return new Promise((resolve) => {
    exiting.once("exit", resolve);
    setTimeout(resolve, 5000);
    exiting.kill();
  });
}

module.exports = { startBackend, stopBackend };
