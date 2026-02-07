import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * resolveAssetUrl(importMetaUrl, relCandidates)
 *
 * Goal:
 * - Work in BOTH:
 *   - ESM: import.meta.url exists
 *   - CJS (tsup bundle): import.meta.url may become undefined
 *
 * Strategy:
 * - Build a list of base directories:
 *   1) dirname(importMetaUrl) if available (ESM)
 *   2) __dirname if available (CJS)
 *   3) process.cwd() as last resort
 * - For each baseDir and relCandidate, resolve and return the first existing file URL.
 */
export function resolveAssetUrl(importMetaUrl: string | undefined, relCandidates: string[]): URL {
  const baseDirs: string[] = [];

  // 1) ESM base (import.meta.url)
  if (typeof importMetaUrl === "string" && importMetaUrl) {
    try {
      const u = new URL(importMetaUrl);
      baseDirs.push(path.dirname(fileURLToPath(u)));
    } catch {
      // ignore
    }
  }

  // 2) CJS base (__dirname). Safe even in ESM due to typeof on undeclared identifier.
  // @ts-ignore
  if (typeof __dirname === "string") {
    // @ts-ignore
    baseDirs.push(__dirname);
  }

  // 3) Fallback: cwd
  baseDirs.push(process.cwd());

  for (const baseDir of baseDirs) {
    for (const rel of relCandidates) {
      const abs = path.resolve(baseDir, rel);
      if (fs.existsSync(abs)) return pathToFileURL(abs);
    }
  }

  // Final fallback: return the first candidate as a file URL (may not exist)
  const fallbackBase = baseDirs[0] ?? process.cwd();
  const fallbackRel = relCandidates[0] ?? ".";
  return pathToFileURL(path.resolve(fallbackBase, fallbackRel));
}
