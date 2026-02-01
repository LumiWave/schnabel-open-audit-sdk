import type { NormalizedInput } from "../normalizer/types.js";
import type { Finding } from "./types.js";
import type { Scanner, ScannerContext } from "./scanners/scanner.js";
import { ensureViews } from "./views.js";

export interface ScanOptions {
  mode?: "runtime" | "audit";
  failFast?: boolean;

  /**
   * If failFast is enabled, stop scanning when a finding meets/overrides this threshold.
   * Default: "high"
   */
  failFastRisk?: "high" | "critical";
}

function isFailFastHit(risk: Finding["risk"], threshold: NonNullable<ScanOptions["failFastRisk"]>): boolean {
  if (threshold === "critical") return risk === "critical";
  return risk === "high" || risk === "critical";
}

/**
 * scanSignals()
 * - Runs scanners sequentially (chain).
 * - Allows scanners to mutate the working input (sanitizers).
 * - Aggregates findings.
 * - Optionally stops early (failFast).
 * - Ensures multi-view (raw/sanitized/revealed) is initialized at chain start.
 */
export async function scanSignals(
  input: NormalizedInput,
  scanners: Scanner[],
  options: ScanOptions = {}
): Promise<{ input: NormalizedInput; findings: Finding[] }> {
  const ctx: ScannerContext = {
    mode: options.mode ?? "runtime",
    nowMs: Date.now(),
  };

  const findings: Finding[] = [];
  const failFast = options.failFast ?? false;
  const failFastRisk = options.failFastRisk ?? "high";

  // Working input that can be updated by sanitizers
  let current = ensureViews(input);

  for (const scanner of scanners) {
    const out = await scanner.run(current, ctx);

    // Preserve views across scanners (in case a scanner forgets to carry it)
    const next = out.input.views ? out.input : { ...out.input, views: current.views };

    current = ensureViews(next);

    if (out.findings.length) findings.push(...out.findings);

    if (failFast && out.findings.some(f => isFailFastHit(f.risk, failFastRisk))) {
      break;
    }
  }

  return { input: current, findings };
}
