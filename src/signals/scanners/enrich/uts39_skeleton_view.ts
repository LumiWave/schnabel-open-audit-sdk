import fs from "node:fs";
import { fileURLToPath } from "node:url";

import type { Scanner } from "../scanner.js";
import type { NormalizedInput } from "../../../normalizer/types.js";
import { ensureViews } from "../../views.js";
import { resolveAssetUrl } from "../../../assets/asset_url.js";

/**
 * UTS#39 confusables.txt location in this repo:
 *   src/assets/uts39/confusables.txt
 */
const CONFUSABLES_URL = resolveAssetUrl(import.meta.url, [
  // Source-tree path (when running from TS)
  "../../../assets/uts39/confusables.txt",
  // Dist path (when bundled into dist/index.js)
  "./assets/uts39/confusables.txt",
  "../assets/uts39/confusables.txt",
]);

type ConfusablesData = {
  version: string;
  map: Map<string, number[]>;
  maxSrcLen: number;
};

let CACHE: ConfusablesData | null = null;

function parseHeaderVersion(lines: string[]): string {
  for (const line of lines.slice(0, 50)) {
    const m = line.match(/^#\s*Version:\s*([0-9.]+)/i);
    if (m && m[1]) return m[1];
  }
  return "unknown";
}

function parseHexSeq(s: string): number[] {
  return s.trim().split(/\s+/g).filter(Boolean).map(h => parseInt(h, 16));
}

function keyOf(seq: number[]): string {
  return seq.join("-");
}

function loadConfusables(): ConfusablesData {
  if (CACHE) return CACHE;

  const path = fileURLToPath(CONFUSABLES_URL);
  if (!fs.existsSync(path)) {
    throw new Error(
      `UTS#39 confusables.txt not found at: ${path}\n` +
      `Please place it at: src/assets/uts39/confusables.txt (or copy assets into dist/assets for packaged builds)`
    );
  }

  const raw = fs.readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/);

  const version = parseHeaderVersion(lines);
  const map = new Map<string, number[]>();
  let maxSrcLen = 1;

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;

    // Format: <src> ; <dst> ; <type> # comment
    const beforeHash = (t.split("#")[0] ?? "").trim();
    if (!beforeHash) continue;

    const parts = beforeHash.split(";").map(x => x.trim());
    const srcRaw = parts[0];
    const dstRaw = parts[1];
    if (!srcRaw || !dstRaw) continue;

    const srcSeq = parseHexSeq(srcRaw);
    const dstSeq = parseHexSeq(dstRaw);
    if (!srcSeq.length || !dstSeq.length) continue;

    map.set(keyOf(srcSeq), dstSeq);
    if (srcSeq.length > maxSrcLen) maxSrcLen = srcSeq.length;
  }

  CACHE = { version, map, maxSrcLen };
  return CACHE;
}

function toCodePoints(s: string): number[] {
  const cps: number[] = [];
  for (const ch of s) cps.push(ch.codePointAt(0)!);
  return cps;
}

function fromCodePoints(cps: number[]): string {
  const CHUNK = 4096;
  let out = "";
  for (let i = 0; i < cps.length; i += CHUNK) {
    out += String.fromCodePoint(...cps.slice(i, i + CHUNK));
  }
  return out;
}

/**
 * Compute UTS#39 skeleton:
 * - NFKC normalize first (UTS#39 compatible processing)
 * - Apply longest-match substitutions using confusables mapping
 */
function skeletonize(text: string, data: ConfusablesData): string {
  const nfkc = text.normalize("NFKC");
  const cps = toCodePoints(nfkc);

  const out: number[] = [];

  for (let i = 0; i < cps.length; ) {
    let matched = false;

    const max = Math.min(data.maxSrcLen, cps.length - i);
    for (let len = max; len >= 1; len--) {
      const key = keyOf(cps.slice(i, i + len));
      const dst = data.map.get(key);
      if (dst) {
        out.push(...dst);
        i += len;
        matched = true;
        break;
      }
    }

    if (!matched) {
      const cp = cps[i];
      if (cp == null) break;
      out.push(cp);
      i += 1;
    }
  }

  return fromCodePoints(out);
}

/**
 * Uts39SkeletonViewScanner (enrich)
 * - Does NOT create findings; it enriches views.skeleton for prompt/chunks.
 * - We compute skeleton from the *revealed* view so hidden ASCII content is included.
 */
export const Uts39SkeletonViewScanner: Scanner = {
  name: "uts39_skeleton_view",
  kind: "enrich",

  async run(input: NormalizedInput) {
    const base = ensureViews(input);
    const views = base.views!;
    const data = loadConfusables();

    // Prompt skeleton from revealed
    views.prompt.skeleton = skeletonize(views.prompt.revealed, data);

    // Chunk skeletons
    const chunks = views.chunks ?? [];
    for (const ch of chunks) {
      if (!ch) continue;
      ch.views.skeleton = skeletonize(ch.views.revealed, data);
    }

    return { input: { ...base, views }, findings: [] };
  },
};
