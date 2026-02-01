import type { AuditRequest, NormalizedInput } from "../normalizer/types.js";
import type { Finding } from "../signals/types.js";
import type { Scanner } from "../signals/scanners/scanner.js";
import type { ScanOptions } from "../signals/scan.js";
import type { PolicyConfig, PolicyDecision } from "../policy/evaluate.js";

import { normalize } from "../normalizer/normalize.js";
import { scanSignals } from "../signals/scan.js";
import { evaluatePolicy } from "../policy/evaluate.js";
import { canonicalizeJson } from "../normalizer/canonicalize.js";
import { sha256Hex } from "../signals/util.js";

export interface AuditRunOptions {
  scanners: Scanner[];
  scanOptions?: ScanOptions;
  policyConfig?: Partial<PolicyConfig>;
}

/**
 * AuditResult
 * - normalized: L1 output before L2 sanitizers mutate anything
 * - scanned: L2 output after all sanitizers (final working input)
 * - findings: aggregated signals
 * - decision: L3 policy output
 * - integrity: simple deterministic hash for now (placeholder for L5 evidence packages)
 */
export interface AuditResult {
  requestId: string;
  createdAt: number;

  normalized: NormalizedInput;
  scanned: NormalizedInput;

  findings: Finding[];
  decision: PolicyDecision;

  integrity: {
    algo: "sha256";
    rootHash: string;
  };
}

function computeIntegrityHash(scanned: NormalizedInput, findings: Finding[], decision: PolicyDecision): string {
  // Keep this deterministic: canonicalize and hash.
  const payload = {
    canonical: scanned.canonical,
    views: scanned.views,
    features: scanned.features,
    findings,
    decision,
  };
  const stable = canonicalizeJson(payload);
  return sha256Hex(stable);
}

/**
 * runAudit()
 * - End-to-end runner for L1 -> L2 -> L3
 * - Later we will extend this to produce full L4 verdict and L5 evidence packages.
 */
export async function runAudit(req: AuditRequest, opts: AuditRunOptions): Promise<AuditResult> {
  const createdAt = Date.now();

  // L1 Normalize
  const normalized = normalize(req);

  // L2 Scanner chain
  const { input: scanned, findings } = await scanSignals(
    normalized,
    opts.scanners,
    opts.scanOptions ?? { mode: "audit", failFast: false }
  );

  // L3 Policy
  const decision = evaluatePolicy(findings, opts.policyConfig);

  // Minimal integrity hash (will evolve into a richer evidence hash chain)
  const rootHash = computeIntegrityHash(scanned, findings, decision);

  return {
    requestId: req.requestId,
    createdAt,
    normalized,
    scanned,
    findings,
    decision,
    integrity: { algo: "sha256", rootHash },
  };
}
