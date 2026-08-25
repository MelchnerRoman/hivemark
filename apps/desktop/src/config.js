const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const CONFIG_PATH = path.join(app.getPath("userData"), "hivemark-config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
}

function getServerUrl() {
  return readConfig().serverUrl ?? null;
}

function setServerUrl(url) {
  writeConfig({ ...readConfig(), serverUrl: url });
}

function clearServerUrl() {
  writeConfig({ ...readConfig(), serverUrl: null });
}

module.exports = { getServerUrl, setServerUrl, clearServerUrl };
