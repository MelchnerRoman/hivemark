import pngToIco from "png-to-ico";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..", "..");
const svgPath = path.join(__dirname, "icon.svg");
const svgBuffer = fs.readFileSync(svgPath);

const webAppDir = path.join(repoRoot, "apps", "web", "src", "app");
const webPublicDir = path.join(repoRoot, "apps", "web", "public");

const tmpDir = path.join(__dirname, "web-tmp");
fs.mkdirSync(tmpDir, { recursive: true });

const sizes = [16, 32, 48];
const tmpFiles = [];
for (const size of sizes) {
  const file = path.join(tmpDir, `fav-${size}.png`);
  await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(file);
  tmpFiles.push(file);
}

const icoBuf = await pngToIco(tmpFiles);
fs.writeFileSync(path.join(webAppDir, "favicon.ico"), icoBuf);
console.log("wrote apps/web/src/app/favicon.ico", icoBuf.length, "bytes");

// Modern Next.js app-icon convention: a 512x512 icon.png dropped in src/app
// is automatically picked up and linked as an icon/apple-touch-icon.
await sharp(svgBuffer, { density: 384 })
  .resize(512, 512)
  .png()
  .toFile(path.join(webAppDir, "icon.png"));
console.log("wrote apps/web/src/app/icon.png");

await sharp(svgBuffer, { density: 384 })
  .resize(180, 180)
  .png()
  .toFile(path.join(webAppDir, "apple-icon.png"));
console.log("wrote apps/web/src/app/apple-icon.png");

fs.rmSync(tmpDir, { recursive: true, force: true });
