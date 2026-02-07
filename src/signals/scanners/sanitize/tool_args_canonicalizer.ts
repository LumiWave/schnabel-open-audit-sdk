import type { Scanner } from "../scanner.js";
import type { Finding } from "../../types.js";
import type { NormalizedInput } from "../../../normalizer/types.js";
import { canonicalizeJson } from "../../../normalizer/canonicalize.js";
import { makeFindingId } from "../../util.js";

const INVISIBLE_REGEX = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g;
const BIDI_REGEX = /[\u202A-\u202E\u2066-\u2069]/g;

const DEFAULT_MAX_NODES = 20_000;

type CleanStats = {
  text: string;
  changed: boolean;
  removedInvisible: number;
  removedBidi: number;
  nfkc: boolean;
};

function cleanText(s: string): CleanStats {
  const before = s;
  const nfkcText = s.normalize("NFKC");
  const nfkc = nfkcText !== s;

  const beforeInv = nfkcText;
  const noInv = nfkcText.replace(INVISIBLE_REGEX, "");
  const removedInvisible = beforeInv.length - noInv.length;

  const beforeBidi = noInv;
  const noBidi = noInv.replace(BIDI_REGEX, "");
  const removedBidi = beforeBidi.length - noBidi.length;

  // IMPORTANT: do NOT trim tool args. Whitespace may be meaningful for some tools.
  const text = noBidi;

  const changed = text !== before || nfkc || removedInvisible > 0 || removedBidi > 0;
  return { text, changed, removedInvisible, removedBidi, nfkc };
}

type Agg = {
  nodes: number;
  maxNodes: number;
  maxNodesExceeded: boolean;

  changedAny: boolean;
  changedStrings: number;
  removedInvisible: number;
  removedBidi: number;
  nfkcApplied: boolean;
};

function newAgg(maxNodes: number): Agg {
  return {
    nodes: 0,
    maxNodes,
    maxNodesExceeded: false,

    changedAny: false,
    changedStrings: 0,
    removedInvisible: 0,
    removedBidi: 0,
    nfkcApplied: false,
  };
}

function sanitizeDeep(x: unknown, agg: Agg): unknown {
  agg.nodes += 1;
  if (agg.nodes > agg.maxNodes) {
    agg.maxNodesExceeded = true;
    return x;
  }

  if (typeof x === "string") {
    const r = cleanText(x);
    if (r.changed) {
      agg.changedAny = true;
      agg.changedStrings += 1;
      agg.removedInvisible += r.removedInvisible;
      agg.removedBidi += r.removedBidi;
      agg.nfkcApplied = agg.nfkcApplied || r.nfkc;
      return r.text;
    }
    return x;
  }

  if (Array.isArray(x)) {
    let changed = false;
    const out = x.map((v) => {
      const nv = sanitizeDeep(v, agg);
      if (nv !== v) changed = true;
      return nv;
    });
    return changed ? out : x;
  }

  if (x && typeof x === "object") {
    const obj = x as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const nv = sanitizeDeep(v, agg);
      if (nv !== v) changed = true;
      out[k] = nv;
    }
    return changed ? out : x;
  }

  return x;
}

function parseToolCallsJson(jsonStr: string): any[] {
  try {
    const x = JSON.parse(jsonStr);
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

export const ToolArgsCanonicalizerScanner: Scanner = {
  name: "tool_args_canonicalizer",
  kind: "sanitize",

  async run(input: NormalizedInput) {
    const findings: Finding[] = [];
    if (!input.features.hasToolCalls) return { input, findings };

    const toolCalls = parseToolCallsJson(input.canonical.toolCallsJson);
    if (!toolCalls.length) return { input, findings };

    const agg = newAgg(DEFAULT_MAX_NODES);

    let anyChanged = false;
    const outCalls = toolCalls.map((tc: any) => {
      const beforeArgs = tc?.args;
      const afterArgs = sanitizeDeep(beforeArgs, agg);
      if (afterArgs !== beforeArgs) {
        anyChanged = true;
        return { ...tc, args: afterArgs };
      }
      return tc;
    });

    if (!anyChanged) return { input, findings };

    const updated: NormalizedInput = {
      ...input,
      canonical: {
        ...input.canonical,
        toolCallsJson: canonicalizeJson(outCalls),
      },
    };

    // Emit a finding only if we actually removed suspicious characters or applied NFKC.
    const risk: Finding["risk"] = (agg.removedInvisible > 0 || agg.removedBidi > 0) ? "medium" : "low";
    const score = (agg.removedInvisible > 0 || agg.removedBidi > 0) ? 0.45 : 0.2;

    findings.push({
      id: makeFindingId("tool_args_canonicalizer", input.requestId, "tool_args_canonicalized"),
      kind: "sanitize",
      scanner: "tool_args_canonicalizer",
      score,
      risk,
      tags: ["tool", "canonicalization", "obfuscation"],
      summary: "Tool args were canonicalized (NFKC / zero-width / bidi removed) for downstream tool-boundary scanners.",
      target: { field: "promptChunk", view: "raw", source: "tool", chunkIndex: 0 } as any,
      evidence: {
        toolCalls: toolCalls.length,
        changedStrings: agg.changedStrings,
        removedInvisible: agg.removedInvisible,
        removedBidi: agg.removedBidi,
        nfkcApplied: agg.nfkcApplied,
        maxNodes: agg.maxNodes,
        maxNodesExceeded: agg.maxNodesExceeded,
        outputField: "canonical.toolCallsJson",
      },
    });

    return { input: updated, findings };
  },
};
