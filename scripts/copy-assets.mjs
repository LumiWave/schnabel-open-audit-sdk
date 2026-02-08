import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const srcAssets = path.join(root, "src", "assets");
const distAssets = path.join(root, "dist", "assets");

function copyDir(src, dst) {
  if (!fs.existsSync(src)) {
    console.error(`[copy-assets] source not found: ${src}`);
    process.exit(1);
  }
  fs.mkdirSync(dst, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

copyDir(srcAssets, distAssets);
console.log(`[copy-assets] copied: ${srcAssets} -> ${distAssets}`);
