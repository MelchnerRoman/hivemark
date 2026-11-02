import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { getRoomProjectDir } from "./agentSandbox.js";

export type PreviewMode = "static" | "node" | "none";
export type PreviewStatus = "stopped" | "starting" | "running" | "error";

export type PreviewState = {
  mode: PreviewMode;
  status: PreviewStatus;
  /** Static mode: a path on this same server (`/preview-static/<roomId>/`).
   * Node mode: a `proxy://<port>/` marker — the frontend's resolvePreviewUrl
   * rewrites it to `http://<backend-host>:<port>/`, reusing whatever host it
   * already uses to reach BACKEND_URL (localhost for local dev, the LAN/host
   * address for self-hosted). This works because the port belongs to a raw
   * TCP passthrough we own (see forwardPreviewPort below), not the
   * framework's own dev-server port directly — the dev server may only bind
   * localhost, and even if it binds wider, a path-prefixed HTTP proxy would
   * break most frameworks' root-relative asset URLs (Vite's /@vite/client,
   * etc). A byte-level TCP forward sidesteps both problems: it needs no
   * framework config and works for plain HTTP, WebSocket (HMR), and SSE
   * alike. */
  url: string | null;
  logTail: string[];
  pid: number | null;
};

type RunningPreview = PreviewState & {
  child: ChildProcess | null;
  devPort: number | null;
  forwardServer: net.Server | null;
};

const previews = new Map<string, RunningPreview>();
const MAX_LOG_LINES = 200;
const START_TIMEOUT_MS = 60_000;
const URL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)[^\s"']*/;
// Same default as index.ts's own HOST — self-hosted deployers who set
// HOST=0.0.0.0 to make the main server reachable off-machine get the same
// reachability for preview forwards, with no separate config needed.
const BIND_HOST = process.env.HOST ?? "127.0.0.1";

/** "node" needs a package.json with a dev/start script (real code execution
 * — npm install runs postinstall scripts); "static" just needs a root
 * index.html to serve as-is; otherwise there's nothing to run yet. */
export function detectRunMode(dir: string): PreviewMode {
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.dev || pkg.scripts?.start) return "node";
    } catch {
      // malformed package.json — fall through to the static/none check
    }
  }
  if (fs.existsSync(path.join(dir, "index.html"))) return "static";
  return "none";
}

function pushLog(state: RunningPreview, text: string) {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    state.logTail.push(line.trim());
    if (state.logTail.length > MAX_LOG_LINES) state.logTail.shift();
  }
}

/** Opens a raw byte-level TCP passthrough to the dev server's own port, bound
 * to BIND_HOST on an OS-assigned port. Plain HTTP proxying would need every
 * framework's dev server configured with a matching base path (most emit
 * root-relative asset URLs assuming they own "/"); a TCP forward needs no
 * such config and transparently carries WebSocket (HMR) and SSE too. */
function openForwardServer(state: RunningPreview) {
  const server = net.createServer((clientSocket) => {
    const upstream = net.connect(state.devPort!, "127.0.0.1");
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
    const cleanup = () => {
      clientSocket.destroy();
      upstream.destroy();
    };
    clientSocket.on("error", cleanup);
    upstream.on("error", cleanup);
  });
  server.on("error", (err) => {
    state.status = "error";
    pushLog(state, `Preview proxy failed to start: ${String(err)}`);
  });
  server.listen(0, BIND_HOST, () => {
    const address = server.address();
    if (!address || typeof address !== "object") return;
    state.forwardServer = server;
    state.url = `proxy://${address.port}/`;
    state.status = "running";
  });
}

/** Current state for a Room's preview. Static rooms are always "running" —
 * express.static needs no process, so there's nothing to start/stop. Node
 * rooms reflect whatever startPreview/stopPreview last did (default: stopped,
 * nothing spawned yet). */
export function getPreviewState(roomId: string): PreviewState {
  const dir = getRoomProjectDir(roomId);
  const mode = detectRunMode(dir);
  if (mode === "static") {
    return { mode, status: "running", url: `/preview-static/${roomId}/`, logTail: [], pid: null };
  }
  const running = previews.get(roomId);
  if (running) {
    return { mode: running.mode, status: running.status, url: running.url, logTail: running.logTail, pid: running.pid };
  }
  return { mode, status: "stopped", url: null, logTail: [], pid: null };
}

/** Starts (or returns the already-running/starting) dev server for a Room.
 * Static rooms are a no-op — see getPreviewState. Doesn't force a specific
 * port (fragile across frameworks — Vite needs --port, others read PORT
 * differently); instead lets the framework pick and scans stdout+stderr for
 * the URL it printed, since that's what actually varies by framework. */
export function startPreview(roomId: string): PreviewState {
  const dir = getRoomProjectDir(roomId);
  const mode = detectRunMode(dir);
  if (mode !== "node") return getPreviewState(roomId);

  const existing = previews.get(roomId);
  if (existing && (existing.status === "starting" || existing.status === "running")) return getPreviewState(roomId);
  // An "error" run (start timeout, proxy failure) can still have a live
  // process group — kill it before its state is replaced and lost for good.
  if (existing) stopPreview(roomId);

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
  const script = pkg.scripts?.dev ? "dev" : "start";
  const needsInstall = !fs.existsSync(path.join(dir, "node_modules"));
  const command = needsInstall ? `npm install && npm run ${script}` : `npm run ${script}`;

  const state: RunningPreview = {
    mode,
    status: "starting",
    url: null,
    logTail: [],
    pid: null,
    child: null,
    devPort: null,
    forwardServer: null,
  };
  previews.set(roomId, state);

  // `detached: true` makes this child the leader of its own process group —
  // `npm run dev` (and whatever it spawns in turn, e.g. Vite) are its real
  // descendants, not siblings, so killing just this one PID (verified live)
  // leaves the actual dev server running and still bound to its port. Kill
  // the whole group instead (see killPreviewProcess below).
  const child = spawn("sh", ["-c", command], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], detached: true });
  state.child = child;
  state.pid = child.pid ?? null;

  const onOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    pushLog(state, text);
    if (state.status === "starting" && !state.devPort) {
      const match = text.match(URL_REGEX);
      if (match) {
        state.devPort = Number(match[1]);
        openForwardServer(state);
      }
    }
  };
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);

  child.on("error", (err: NodeJS.ErrnoException) => {
    state.status = "error";
    pushLog(state, err.code === "ENOENT" ? "npm not found on this machine." : String(err));
  });

  child.on("exit", (code) => {
    // A deliberate stopPreview() already set status "stopped" and cleared
    // `child` before killing — only an unexpected exit lands here as "error".
    if (state.child === child) {
      state.status = code === 0 || code === null ? "stopped" : "error";
      if (code !== 0 && code !== null) pushLog(state, `Process exited with code ${code}`);
      state.child = null;
      state.pid = null;
      state.url = null;
      closeForwardServer(state);
    }
  });

  setTimeout(() => {
    if (state.status === "starting") {
      state.status = "error";
      pushLog(state, "Timed out waiting for the dev server to print a URL.");
    }
  }, START_TIMEOUT_MS);

  return getPreviewState(roomId);
}

/** Kills a whole preview process GROUP (negative pid), not just the `sh -c`
 * leader — verified live that killing only the leader's PID leaves the real
 * dev server (npm's own child, e.g. Vite) running and still bound to its
 * port. Requires the child to have been spawned with `detached: true`. */
function killPreviewProcess(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // group already gone (process exited on its own between check and kill)
  }
}

function closeForwardServer(state: RunningPreview) {
  state.forwardServer?.close();
  state.forwardServer = null;
  state.devPort = null;
}

export function stopPreview(roomId: string): PreviewState {
  const state = previews.get(roomId);
  if (state?.child) {
    const child = state.child;
    state.status = "stopped";
    state.url = null;
    state.child = null;
    state.pid = null;
    killPreviewProcess(child);
    closeForwardServer(state);
  }
  return getPreviewState(roomId);
}

/** Kills every still-running dev server (whole process group each) — called
 * on graceful shutdown alongside closeAllAgentSessions() so a server restart
 * doesn't leave orphaned `npm run dev` processes behind. */
export function stopAllPreviews(): void {
  for (const state of previews.values()) {
    if (state.child) killPreviewProcess(state.child);
    closeForwardServer(state);
  }
}
