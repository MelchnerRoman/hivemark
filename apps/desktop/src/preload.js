const { contextBridge, ipcRenderer } = require("electron");

// Passed via webPreferences.additionalArguments at BrowserWindow creation —
// the sanctioned way to hand a sandboxed preload script small static data;
// sandboxed preload can't require("fs")/read config.js itself.
const arg = process.argv.find((a) => a.startsWith("--hivemark-backend-url="));
const backendUrl = arg ? arg.slice("--hivemark-backend-url=".length) : null;

contextBridge.exposeInMainWorld("hivemark", {
  backendUrl,
  setServerUrl: (url) => ipcRenderer.invoke("set-server-url", url),
  useLocalServer: () => ipcRenderer.invoke("use-local-server"),
});
