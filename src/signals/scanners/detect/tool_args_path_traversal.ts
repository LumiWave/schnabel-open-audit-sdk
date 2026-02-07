import type { Scanner } from "../scanner.js";
import type { Finding } from "../../types.js";
import type { NormalizedInput } from "../../../normalizer/types.js";
import { makeFindingId } from "../../util.js";

const INVISIBLE_REGEX = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g;
const BIDI_REGEX = /[\u202A-\u202E\u2066-\u2069]/g;

type WalkState = { nodes: number; maxNodes: number };

function walkStrings(
  x: unknown,
  cb: (value: string, path: string) => void,
  state: WalkState,
  path = "$"
): void {
  state.nodes += 1;
  if (state.nodes > state.maxNodes) return;

  if (typeof x === "string") return cb(x, path);
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

function safeDecodeURIComponent(s: string, rounds = 2): string {
  let t = s;
  for (let i = 0; i < rounds; i++) {
    try {
      const d = decodeURIComponent(t);
      if (d === t) return t;
      t = d;
    } catch {
      return t;
    }
  }
  return t;
}

function normalizePathCandidate(s: string): string {
  let t = (s ?? "").toString().normalize("NFKC");
  t = t.replace(INVISIBLE_REGEX, "");
  t = t.replace(BIDI_REGEX, "");
  return t.trim();
}

function looksLikePath(s: string): boolean {
  const t = s.trim();
  return t.includes("/") || t.includes("\\") || t.startsWith("~") || t.startsWith(".");
}

function hasTraversal(s: string): boolean {
  const t = s.toLowerCase();
  return (
    /(^|[\\/])\.\.([\\/]|$)/.test(t) ||
    /%2e%2e/i.test(t) ||
    /%2f|%5c/i.test(t)
  );
}

function isSensitiveFile(s: string): boolean {
  const t = s.toLowerCase();
  const patterns = [
    "/etc/passwd", "/etc/shadow", "/proc/", "/sys/", "/root/",
    ".ssh", "id_rsa", ".env",
    "c:\\windows\\system32", "c:\\users\\", "c:\\windows\\",
  ];
  return patterns.some(p => t.includes(p));
}

/**
 * Detect traversal/sensitive paths in toolCalls args.
 */
export const ToolArgsPathTraversalScanner: Scanner = {
  name: "tool_args_path_traversal",
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
        const normalized = normalizePathCandidate(val);
        if (!looksLikePath(normalized)) return;

        const decoded = safeDecodeURIComponent(normalized, 2);

        const traversal = hasTraversal(normalized) || hasTraversal(decoded);
        const sensitive = isSensitiveFile(normalized) || isSensitiveFile(decoded);

        if (!traversal && !sensitive) return;

        const risk = sensitive ? "high" : "medium";
        const score = sensitive ? 0.8 : 0.6;

        findings.push({
          id: makeFindingId("tool_args_path_traversal", input.requestId, `${toolName}:${i}:${p}`),
          kind: "detect",
          scanner: "tool_args_path_traversal",
          score,
          risk,
          tags: ["tool", "path", traversal ? "traversal" : "sensitive_path"],
          summary: sensitive
            ? "Sensitive file path reference detected in tool args."
            : "Path traversal pattern detected in tool args.",
          target: { field: "promptChunk", view: "raw", source: "tool", chunkIndex: i } as any,
          evidence: {
            toolName,
            argPath: p,
            value: val,
            normalized,
            decoded,
            traversal,
            sensitive,
            maxNodes: state.maxNodes,
            nodesVisited: state.nodes,
          },
        });
      }, state);
    }

    return { input, findings };
  },
};
