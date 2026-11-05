// electron-builder afterPack hook: better-sqlite3 (13+, N-API) ships prebuilt
// binaries for every platform/arch and picks one at runtime. The bundled server
// runtime is shared by all targets, so drop the prebuilds that aren't this
// app's platform-arch — otherwise e.g. the arm64 Mac app carries an x86_64
// Mach-O that macOS flags as an Intel component.
const fs = require("fs");
const path = require("path");
const { Arch } = require("electron-builder");

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const prebuilds = path.join(resources, "server", "node_modules", "better-sqlite3", "prebuilds");
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  // Linux keeps both glibc and musl builds; binding.js chooses at runtime.
  const keep = new Set([`${platform}-${arch}.node`, ...(platform === "linux" ? [`linuxmusl-${arch}.node`] : [])]);
  const files = fs.readdirSync(prebuilds);
  if (!files.some((f) => keep.has(f))) throw new Error(`better-sqlite3 has no prebuild for ${platform}-${arch}`);
  for (const f of files) if (!keep.has(f)) fs.rmSync(path.join(prebuilds, f));
  console.log(`  • better-sqlite3 prebuilds kept for ${platform}-${arch}: ${files.filter((f) => keep.has(f)).join(", ")}`);
};
