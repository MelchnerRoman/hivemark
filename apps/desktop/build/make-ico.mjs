import pngToIco from "png-to-ico";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const files = sizes.map((s) => path.join(__dirname, "png", `icon-${s}.png`));

const buf = await pngToIco(files);
fs.writeFileSync(path.join(__dirname, "icon.ico"), buf);
console.log("wrote build/icon.ico", buf.length, "bytes");
