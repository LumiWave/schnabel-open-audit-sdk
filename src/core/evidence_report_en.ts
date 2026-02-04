import type { EvidencePackageV0 } from "./evidence_package.js";

type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

export interface ReportOptions {
  maxPreviewChars?: number; // default 140
  showDetails?: boolean;    // default false (human-friendly)
}

const RISK_ORDER: RiskLevel[] = ["none", "low", "medium", "high", "critical"];

function clip(s: string, n: number): string {
  const t = (s ?? "").toString().replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n) + "…";
}

function topDetectFinding(e: EvidencePackageV0) {
  const detect = (e.findings ?? []).filter((f: any) => f.kind === "detect");
  if (!detect.length) return null;

  detect.sort((a: any, b: any) => {
    const ra = RISK_ORDER.indexOf(a.risk);
    const rb = RISK_ORDER.indexOf(b.risk);
    if (rb !== ra) return rb - ra;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  return detect[0];
}

function summarizeInput(e: EvidencePackageV0, maxN: number) {
  const prompt = e.rawDigest?.prompt?.preview ?? "";
  const chunks = e.normalized?.canonical?.promptChunksCanonical ?? [];

  const retrieval = chunks
    .map((ch: any, i: number) => ({ ...ch, i }))
    .filter((x: any) => x.source === "retrieval");

  const lines: string[] = [];
  lines.push(`- User prompt: "${clip(prompt, maxN)}"`);

  if (!retrieval.length) {
    lines.push(`- Retrieval: 0 chunk(s)`);
    return lines.join("\n");
  }

  lines.push(`- Retrieval: ${retrieval.length} chunk(s)`);
  for (const r of retrieval.slice(0, 2)) {
    lines.push(`  - retrieval#${r.i}: "${clip(r.text ?? "", maxN)}"`);
  }
  if (retrieval.length > 2) lines.push(`  - ...`);
  return lines.join("\n");
}

function obfuscationHints(e: EvidencePackageV0): string[] {
  const hints = new Set<string>();

  // sanitizer evidence
  for (const f of e.findings ?? []) {
    if (f.kind === "sanitize" && f.scanner === "unicode_sanitizer") {
      const ev: any = f.evidence ?? {};
      if ((ev.removedInvisibleCount ?? 0) > 0) hints.add("Invisible/zero-width characters were used.");
      if ((ev.removedBidiCount ?? 0) > 0) hints.add("Bidi control characters were used (visual spoofing).");
    }
    if (f.kind === "sanitize" && f.scanner === "hidden_ascii_tags") {
      hints.add("Hidden Unicode TAG payload was detected (hidden text channel).");
    }
  }

  // view hints
  for (const f of e.findings ?? []) {
    const mv = (f.evidence as any)?.matchedViews;
    if (Array.isArray(mv)) {
      if (mv.includes("revealed")) hints.add("Risk pattern appeared only after hidden content was revealed.");
      if (mv.includes("skeleton")) hints.add("Homoglyph/confusable characters were normalized via skeleton view.");
    }
    if (f.target?.view === "revealed") hints.add("Risk pattern matched in revealed view.");
    if (f.target?.view === "skeleton") hints.add("Risk pattern matched in skeleton view.");
  }

  return Array.from(hints);
}

function whereText(f: any): string {
  if (f.target?.field === "prompt") return "User prompt";
  const src = f.target?.source ?? "unknown";
  const idx = f.target?.chunkIndex ?? -1;
  return `Chunk (${src}#${idx})`;
}

function shortIssue(e: EvidencePackageV0, maxN: number) {
  const primary = topDetectFinding(e);
  if (!primary) return `No detect findings were produced.`;

  const ev: any = primary.evidence ?? {};
  const category = ev.category ? String(ev.category) : "unknown";
  const ruleId = ev.ruleId ? String(ev.ruleId) : "unknown";
  const snip = ev.snippet ? clip(String(ev.snippet), maxN) : "";

  return [
    `- Primary issue: ${primary.summary}`,
    `- Location: ${whereText(primary)} (${primary.target?.view ?? "n/a"} view)`,
    snip ? `- Example: "${snip}"` : undefined,
    `- Category: ${category}`,
    `- Rule: ${ruleId}`,
  ].filter(Boolean).join("\n");
}

function buildDetails(e: EvidencePackageV0) {
  const findings = e.findings ?? [];
  const scanners = (e.scanners ?? []).map((s: any) => `- ${s.name} (${s.kind})`).join("\n") || "- (none)";

  const list = findings.map((f: any) => {
    const ev: any = f.evidence ?? {};
    const ruleId = ev.ruleId ? ` ruleId=${ev.ruleId}` : "";
    const cat = ev.category ? ` category=${ev.category}` : "";
    const mv = Array.isArray(ev.matchedViews) ? ` matchedViews=[${ev.matchedViews.join(", ")}]` : "";
    return `- ${f.kind}/${f.scanner} (${f.risk}, score=${f.score}) @ ${f.target?.field}:${f.target?.view}${ruleId}${cat}${mv} — ${f.summary}`;
  }).join("\n") || "- (none)";

  return `
<details>
<summary><strong>Technical details (optional)</strong></summary>

### Scanner chain
${scanners}

### Findings
${list}

### Root hash
- ${e.integrity?.rootHash}

</details>
`.trim();
}

export function renderEvidenceReportEN(e: EvidencePackageV0, opts: ReportOptions = {}): string {
  const maxN = opts.maxPreviewChars ?? 140;
  const showDetails = opts.showDetails ?? false;

  const decision = e.decision;
  const hints = obfuscationHints(e);
  const hintsText = hints.length ? hints.map(x => `- ${x}`).join("\n") : "- None observed.";

  const report = `# Schnabel Audit Report (Human-friendly)

## Executive Summary
- Action: \`${decision?.action}\`
- Risk: \`${decision?.risk}\` (confidence=${decision?.confidence})
- Request ID: \`${e.requestId}\`
- Root hash: \`${e.integrity?.rootHash}\`

## Input Summary
${summarizeInput(e, maxN)}

## What went wrong
${shortIssue(e, maxN)}

## Obfuscation / Evasion notes
${hintsText}

## Recommended next steps
- Treat **retrieval chunks as untrusted**: drop/ignore suspicious chunks and re-run retrieval if needed.
- If this is production: log this as a security incident and consider escalating to \`block\` for retrieval-based injection.
- If the user is legitimate: show a short warning and request confirmation (challenge) before continuing.

`;

  if (!showDetails) return report;
  return `${report}\n${buildDetails(e)}\n`;
}
