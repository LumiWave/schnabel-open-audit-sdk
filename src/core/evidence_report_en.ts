import type { EvidencePackageV0 } from "./evidence_package.js";

export interface ReportOptions {
  maxPreviewChars?: number;          // default 180
  includeIntegrityItems?: boolean;   // default true
  includeFindingsList?: boolean;     // default true
}

type RiskLevel = "none" | "low" | "medium" | "high" | "critical";
type TextView = "raw" | "sanitized" | "revealed" | "skeleton";

const RISK_ORDER: RiskLevel[] = ["none", "low", "medium", "high", "critical"];

function clip(s: string, n: number): string {
  const t = (s ?? "").toString();
  if (t.length <= n) return t;
  return t.slice(0, n) + "…";
}

function countByRisk(findings: any[]): Record<RiskLevel, number> {
  const out: Record<RiskLevel, number> = { none: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) out[f.risk] = (out[f.risk] ?? 0) + 1;
  return out;
}

function countByView(findings: any[]): Record<TextView, number> {
  const out: Record<TextView, number> = { raw: 0, sanitized: 0, revealed: 0, skeleton: 0 };
  for (const f of findings) {
    const set = new Set<TextView>();
    if (f.target?.view) set.add(f.target.view);
    const mv = f.evidence?.matchedViews;
    if (Array.isArray(mv)) for (const v of mv) if (v in out) set.add(v);
    for (const v of set) out[v] += 1;
  }
  return out;
}

function countBySource(findings: any[]): Record<string, number> {
  const out: Record<string, number> = { prompt: 0 };
  for (const f of findings) {
    if (f.target?.field === "prompt") out.prompt += 1;
    else {
      const s = f.target?.source ?? "unknown";
      out[s] = (out[s] ?? 0) + 1;
    }
  }
  return out;
}

function topN(map: Map<string, number>, n = 5) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function whereOf(f: any): string {
  if (f.target?.field === "prompt") return `prompt@${f.target.view}`;
  return `chunk(${f.target.source ?? "unknown"}#${f.target.chunkIndex ?? -1})@${f.target.view}`;
}

export function renderEvidenceReportEN(e: EvidencePackageV0, opts: ReportOptions = {}): string {
  const maxN = opts.maxPreviewChars ?? 180;
  const includeIntegrity = opts.includeIntegrityItems ?? true;
  const includeFindings = opts.includeFindingsList ?? true;

  const findings = e.findings ?? [];
  const decision = e.decision;

  const byRisk = countByRisk(findings);
  const byView = countByView(findings);
  const bySource = countBySource(findings);

  // rule/category stats
  const ruleCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  for (const f of findings) {
    const ruleId = f.evidence?.ruleId;
    const cat = f.evidence?.category;
    if (typeof ruleId === "string") ruleCounts.set(ruleId, (ruleCounts.get(ruleId) ?? 0) + 1);
    if (typeof cat === "string") catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }

  const topRules = topN(ruleCounts, 5).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (none)";
  const topCats = topN(catCounts, 5).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (none)";

  const reasons = (decision?.reasons ?? []).map((r: string, i: number) => `${i + 1}) ${r}`).join("\n") || "_(none)_";

  const chunkCanonical = e.normalized?.canonical?.promptChunksCanonical ?? [];
  const chunkList = chunkCanonical.length
    ? chunkCanonical.map((ch: any, i: number) => `- Chunk #${i} (source=${ch.source}): \`${clip(ch.text ?? "", maxN)}\``).join("\n")
    : "- (none)";

  // include only chunks where view differs materially
  const vchunks = e.scanned?.views?.chunks ?? [];
  const viewBlocks: string[] = [];
  for (let i = 0; i < vchunks.length; i++) {
    const vc = vchunks[i];
    const v = vc.views;
    const diff = v.raw !== v.sanitized || v.sanitized !== v.revealed || v.revealed !== v.skeleton;
    if (!diff) continue;

    viewBlocks.push(`### Chunk #${i} (source=${vc.source})`);
    viewBlocks.push(`- raw: \`${clip(v.raw, maxN)}\``);
    viewBlocks.push(`- sanitized: \`${clip(v.sanitized, maxN)}\``);
    viewBlocks.push(`- revealed: \`${clip(v.revealed, maxN)}\``);
    viewBlocks.push(`- skeleton: \`${clip(v.skeleton, maxN)}\``);
    viewBlocks.push("");
  }
  const viewsSection = viewBlocks.length ? viewBlocks.join("\n") : "_(no meaningful view diffs)_";

  const findingsList = includeFindings
    ? findings.map((f: any) => {
        const mv = Array.isArray(f.evidence?.matchedViews) ? ` matchedViews=[${f.evidence.matchedViews.join(", ")}]` : "";
        const rule = f.evidence?.ruleId ? ` ruleId=${f.evidence.ruleId}` : "";
        const cat = f.evidence?.category ? ` category=${f.evidence.category}` : "";
        const snip = f.evidence?.snippet ? ` snippet="${clip(f.evidence.snippet, maxN)}"` : "";
        return `- **${f.kind}/${f.scanner}** (${f.risk}, score=${f.score}) @ ${whereOf(f)}${rule}${cat}${mv}${snip}`;
      }).join("\n") || "_(none)_"
    : "_(omitted)_";

  const integrityItems = includeIntegrity
    ? (e.integrity?.items ?? []).map((it: any) => `- ${it.name}: \`${it.hash}\``).join("\n")
    : "_(hidden)_";

  return `# Schnabel Audit Summary (Evidence v0)

## A) Run Info
- Request ID: \`${e.requestId}\`
- Schema: \`${e.schema}\`
- Generated At (ms): \`${e.generatedAtMs}\`
- Root Hash (sha256): \`${e.integrity?.rootHash}\`
- RulePack Version(s): \`${(e.meta?.rulePackVersions ?? ["N/A"]).join(", ")}\`

## B) Decision
- action: \`${decision?.action}\`
- risk: \`${decision?.risk}\`
- confidence: \`${decision?.confidence}\`

### Reasons
${reasons}

## C) Executive Summary
- totalFindings: **${findings.length}**
- findingsByRisk: none=${byRisk.none}, low=${byRisk.low}, medium=${byRisk.medium}, high=${byRisk.high}, critical=${byRisk.critical}
- findingsByView(aggregated): raw=${byView.raw}, sanitized=${byView.sanitized}, revealed=${byView.revealed}, skeleton=${byView.skeleton}
- findingsBySource: ${Object.entries(bySource).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join(", ") || "N/A"}

### Top Rule IDs
${topRules}

### Top Categories
${topCats}

## D) Input (Provenance)
### Prompt
- preview: \`${clip(e.rawDigest?.prompt?.preview ?? "", maxN)}\`
- length: \`${e.rawDigest?.prompt?.length}\`
- hash: \`${e.rawDigest?.prompt?.hash}\`

### Chunks (canonical)
${chunkList}

## E) Multi-View Diffs (Key Observations)
${viewsSection}

## F) Scanner Chain
${(e.scanners ?? []).map((s: any)=>`- ${s.name} (${s.kind})`).join("\n") || "_(none)_"}

## G) Findings
${findingsList}

## H) Integrity Items
${integrityItems}
`;
}
