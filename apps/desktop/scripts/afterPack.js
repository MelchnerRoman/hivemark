// electron-builder afterPack hook: rebuild better-sqlite3 inside each packaged
// app for *that* app's architecture. The bundled server runtime is copied in
// as-is (extraResources), so without this an x64 DMG built on Apple Silicon
// ships an arm64 binding and the backend crashes on Intel Macs. Runs before
// signing. Cross-arch works via better-sqlite3's prebuilt Electron binaries
// (prebuild-install), falling back to a node-gyp build for that arch.
const path = require("path");
const { rebuild } = require("@electron/rebuild");
const { Arch } = require("electron-builder");
const { build } = require("../package.json");

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const arch = Arch[context.arch];
  console.log(`  • rebuilding better-sqlite3 for electron ${build.electronVersion} ${arch}`);
  await rebuild({
    buildPath: path.join(resources, "server"),
    electronVersion: build.electronVersion,
    arch,
    onlyModules: ["better-sqlite3"],
    force: true,
  });
};
