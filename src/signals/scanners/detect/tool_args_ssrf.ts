import type { Scanner } from "../scanner.js";
import type { Finding } from "../../types.js";
import type { NormalizedInput } from "../../../normalizer/types.js";
import { makeFindingId } from "../../util.js";

import net from "node:net";

const INVISIBLE_REGEX = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g;
const BIDI_REGEX = /[\u202A-\u202E\u2066-\u2069]/g;

// Separator obfuscation like "h.t.t.p" or "h-t-t-p" or "h|t|t|p"
const SEP_CLASS = `[|._\\-\\+]`;
const BETWEEN_SCHEME = new RegExp(`(?<=[A-Za-z])${SEP_CLASS}+(?=[A-Za-z])`, "g");

type WalkState = { nodes: number; maxNodes: number };

function walkStrings(
  x: unknown,
  cb: (value: string, path: string) => void,
  state: WalkState,
  path = "$"
): void {
  state.nodes += 1;
  if (state.nodes > state.maxNodes) return;

  if (typeof x === "string") {
    cb(x, path);
    return;
  }
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) walkStrings(x[i], cb, state, `${path}[${i}]`);
    return;
  }
  if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      walkStrings(v, cb, state, `${path}.${k}`);
    }
  }
}

function getToolCalls(input: NormalizedInput): any[] {
  try {
    const x = JSON.parse(input.canonical.toolCallsJson);
    return Array.isArray(x) ? x : (input.raw.toolCalls ?? []);
  } catch {
    return input.raw.toolCalls ?? [];
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(x => Number(x));
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return false;

  const a = parts[0];
  const b = parts[1];
  if (a == null || b == null) return false;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fe80:")) return true; // link-local
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // ULA fc00::/7
  return false;
}

function isSuspiciousHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (h === "metadata.google.internal") return true;
  if (h === "169.254.169.254") return true;
  return false;
}

function normalizeUrlCandidate(s: string): string {
  // 1) NFKC + remove invisible/bidi
  let t = (s ?? "").toString().normalize("NFKC");
  t = t.replace(INVISIBLE_REGEX, "");
  t = t.replace(BIDI_REGEX, "");

  // 2) collapse separator-based obfuscation ONLY in scheme (e.g., h.t.t.p -> http)
  const colon = t.indexOf(":");
  if (colon > 0) {
    const scheme = t.slice(0, colon).replace(BETWEEN_SCHEME, "");
    t = scheme + t.slice(colon);
  }

  // 3) remove whitespace for URL parsing (spaces inside URLs are suspicious obfuscation)
  t = t.replace(/\s+/g, "");

  return t.trim();
}

function looksLikeHttpUrl(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t.startsWith("http://") || t.startsWith("https://");
}

export const ToolArgsSSRFScanner: Scanner = {
  name: "tool_args_ssrf",
  kind: "detect",

  async run(input: NormalizedInput) {
    const findings: Finding[] = [];

    const toolCalls = getToolCalls(input);
    if (!toolCalls.length) return { input, findings };

    for (let i = 0; i < toolCalls.length; i++) {
      const tc: any = toolCalls[i];
      const toolName = String(tc?.toolName ?? "unknown_tool");
      const args = tc?.args;

      const state: WalkState = { nodes: 0, maxNodes: 20_000 };

      walkStrings(args, (val, p) => {
        const candidate = normalizeUrlCandidate(val);
        if (!looksLikeHttpUrl(candidate)) return;

        let u: URL;
        try {
          u = new URL(candidate);
        } catch {
          return;
        }

        const host = u.hostname;
        const ipKind = net.isIP(host);

        let hit = false;
        let reason = "";

        if (ipKind === 4 && isPrivateIPv4(host)) {
          hit = true;
          reason = "private/loopback/link-local IPv4";
        } else if (ipKind === 6 && isPrivateIPv6(host)) {
          hit = true;
          reason = "private/loopback/link-local IPv6";
        } else if (isSuspiciousHostname(host)) {
          hit = true;
          reason = "suspicious internal hostname/metadata";
        }

        if (hit) {
          findings.push({
            id: makeFindingId("tool_args_ssrf", input.requestId, `${toolName}:${i}:${p}`),
            kind: "detect",
            scanner: "tool_args_ssrf",
            score: 0.85,
            risk: "high",
            tags: ["tool", "ssrf", "network"],
            summary: "Potential SSRF / internal network access via tool args URL.",
            target: { field: "promptChunk", view: "raw", source: "tool", chunkIndex: i } as any,
            evidence: {
              toolName,
              argPath: p,
              url: val,
              normalizedUrl: candidate,
              host,
              reason,
              maxNodes: state.maxNodes,
              nodesVisited: state.nodes,
            },
          });
        }
      }, state);
    }

    return { input, findings };
  },
};
