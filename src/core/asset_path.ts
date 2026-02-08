import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve a static asset path for Node.js runtime.
 *
 * Why:
 * - In dev/tests, assets live in "src/assets".
 * - In packaged builds, assets should be copied to "dist/assets".
 *
 * This resolver looks for package.json upwards and then prefers:
 *   1) <pkgRoot>/dist/assets/<rel>
 *   2) <pkgRoot>/src/assets/<rel>
 *   3) <pkgRoot>/assets/<rel> (fallback)
 */
export function resolveAssetPath(rel: string, fromUrl: string = import.meta.url): string {
  const safeRel = rel.replace(/^\/*/, ""); // remove leading slashes
  const startDir = path.dirname(fileURLToPath(fromUrl));

  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const pkgJson = path.join(dir, "package.json");
    if (fs.existsSync(pkgJson)) {
      const distCandidate = path.join(dir, "dist", "assets", safeRel);
      if (fs.existsSync(distCandidate)) return distCandidate;

      const srcCandidate = path.join(dir, "src", "assets", safeRel);
      if (fs.existsSync(srcCandidate)) return srcCandidate;

      const legacyCandidate = path.join(dir, "assets", safeRel);
      if (fs.existsSync(legacyCandidate)) return legacyCandidate;

      // Default preference for packaged build
      return distCandidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // As a last resort, resolve relative to current file directory.
  return path.join(startDir, safeRel);
}
