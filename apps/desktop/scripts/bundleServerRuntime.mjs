// apps/server's runtime dependencies (express, better-sqlite3, @anthropic-ai/sdk,
// etc.) live in the *root* node_modules — npm workspaces hoists them there, and
// apps/server/node_modules only holds the couple of packages that couldn't be
// hoisted. electron-builder's extraResources can only copy a single real
// directory, so pointing it at apps/server/node_modules (as it used to) shipped
// a packaged app missing almost its entire backend dependency tree.
//
// Fix: do a standalone `npm install --omit=dev` into this scratch directory,
// seeded with only apps/server's package.json. Since it's not listed in the
// root package.json's `workspaces` glob, npm treats it as its own project and
// gives it a real self-contained node_modules — production deps only, nothing
// from the ~3GB of root dev tooling (electron-builder, next, typescript, ...).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const desktopDir = path.join(import.meta.dirname, "..");
const serverPkgPath = path.join(desktopDir, "..", "server", "package.json");
const stagingDir = path.join(desktopDir, "build", "server-runtime");

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, "utf-8"));
fs.writeFileSync(
  path.join(stagingDir, "package.json"),
  JSON.stringify({ name: "hivemark-server-runtime", private: true, dependencies: serverPkg.dependencies }, null, 2)
);

execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: stagingDir,
  stdio: "inherit",
});

console.log(`Bundled server runtime deps into ${stagingDir}`);
