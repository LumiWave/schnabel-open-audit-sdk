import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const src = path.resolve("src/assets");
  const dst = path.resolve("dist/assets");

  try {
    await fs.mkdir(dst, { recursive: true });
    // Node 18+ supports fs.cp
    await fs.cp(src, dst, { recursive: true });
    console.log(`[copy_assets] copied ${src} -> ${dst}`);
  } catch (e) {
    console.error("[copy_assets] failed:", e);
    process.exit(1);
  }
}

main();
