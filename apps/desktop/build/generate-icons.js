/* One-off script to rasterize build/icon.svg into the PNG sizes needed for
 * macOS .icns (via iconutil), Windows .ico, and Linux .png. Not wired into
 * any npm script — run manually with `node build/generate-icons.js` from
 * apps/desktop whenever build/icon.svg changes. Requires `sharp` (available
 * hoisted at the repo root as a transitive dep of next/apps/web).
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const buildDir = __dirname;
const svgPath = path.join(buildDir, "icon.svg");
const iconsetDir = path.join(buildDir, "icon.iconset");
const pngOutDir = path.join(buildDir, "png");

const ICONSET_SIZES = [
  { file: "icon_16x16.png", size: 16 },
  { file: "icon_16x16@2x.png", size: 32 },
  { file: "icon_32x32.png", size: 32 },
  { file: "icon_32x32@2x.png", size: 64 },
  { file: "icon_128x128.png", size: 128 },
  { file: "icon_128x128@2x.png", size: 256 },
  { file: "icon_256x256.png", size: 256 },
  { file: "icon_256x256@2x.png", size: 512 },
  { file: "icon_512x512.png", size: 512 },
  { file: "icon_512x512@2x.png", size: 1024 },
];

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

async function main() {
  fs.mkdirSync(iconsetDir, { recursive: true });
  fs.mkdirSync(pngOutDir, { recursive: true });

  const svgBuffer = fs.readFileSync(svgPath);

  await Promise.all(
    ICONSET_SIZES.map(({ file, size }) =>
      sharp(svgBuffer, { density: 384 })
        .resize(size, size)
        .png()
        .toFile(path.join(iconsetDir, file))
    )
  );

  await Promise.all(
    PNG_SIZES.map((size) =>
      sharp(svgBuffer, { density: 384 })
        .resize(size, size)
        .png()
        .toFile(path.join(pngOutDir, `icon-${size}.png`))
    )
  );

  // Top-level 512x512 png — electron-builder's linux icon target.
  await sharp(svgBuffer, { density: 384 })
    .resize(512, 512)
    .png()
    .toFile(path.join(buildDir, "icon.png"));

  console.log("Rasterized icon.svg into", iconsetDir, "and", pngOutDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
