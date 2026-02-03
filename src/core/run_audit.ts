import type { AuditRequest, NormalizedInput } from "../normalizer/types.js";
import type { Finding } from "../signals/types.js";
import type { Scanner } from "../signals/scanners/scanner.js";
import type { ScanOptions } from "../signals/scan.js";
import type { PolicyConfig, PolicyDecision } from "../policy/evaluate.js";

import { normalize } from "../normalizer/normalize.js";
import { scanSignals } from "../signals/scan.js";
import { evaluatePolicy } from "../policy/evaluate.js";

import { buildEvidencePackageV0, type EvidencePackageV0 } from "./evidence_package.js";
import { saveEvidencePackage, type SaveEvidenceOptions } from "./evidence_dump.js";

// NOTE: Make sure evidence_report_dump.ts exports EN versions.
// - export { saveEvidenceReportEN, type SaveEvidenceReportOptions }
import { saveEvidenceReportEN, type SaveEvidenceReportOptions } from "./evidence_report_dump.js";

import { decideDumpPolicy, type DumpPolicyConfig, type DumpDecision } from "./dump_policy.js";
import { dumpEvidenceToSessionLayout, type SessionDumpOptions } from "./session_store.js";

export interface AuditRunOptions {
  scanners: Scanner[];
  scanOptions?: ScanOptions;
  policyConfig?: Partial<PolicyConfig>;

  /**
   * Direct dumping (always dumps when enabled).
   * - true: dump to defaults
   * - object: custom dump options
   */
  dumpEvidence?: boolean | SaveEvidenceOptions;
  dumpEvidenceReport?: boolean | SaveEvidenceReportOptions;

  /**
   * Policy-based dumping (recommended for production).
   * - true: enable with default policy
   * - object: customize policy
   *
   * When dumpPolicy is provided, dumping occurs only if policy decides to dump.
   * dumpEvidence/dumpEvidenceReport options are used as output settings (outDir/fileName).
   */
  dumpPolicy?: boolean | Partial<DumpPolicyConfig>;

  /**
   * If set, dumping uses session folder layout:
   * artifacts/audit/<sessionId>/turns/<requestId>.<generatedAtMs>/{evidence.json,report.en.md}
   * and updates session_summary.en.md
   *
   * NOTE: session layout dump currently writes BOTH evidence + report for an incident.
   */
  dumpSession?: SessionDumpOptions;

  /**
   * Convenience: close scanners that expose close() after runAudit finishes.
   * Default: false (safe for scanner reuse)
   */
  autoCloseScanners?: boolean;
}

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

  evidence: EvidencePackageV0;

  evidenceFilePath?: string;
  evidenceReportFilePath?: string;

  // If session dump is enabled, these may be helpful for debugging/links:
  sessionRootDir?: string;
  turnDir?: string;
  sessionSummaryPath?: string;

  dumpDecision?: DumpDecision;
}

function tryCloseScanners(scanners: Scanner[]) {
  for (const s of scanners as any[]) {
    if (s && typeof s.close === "function") {
      try { s.close(); } catch {}
    }
  }
}

export async function runAudit(req: AuditRequest, opts: AuditRunOptions): Promise<AuditResult> {
  const createdAt = Date.now();

  // L1
  const normalized = normalize(req);

  // L2
  const { input: scanned, findings } = await scanSignals(
    normalized,
    opts.scanners,
    opts.scanOptions ?? { mode: "audit", failFast: false }
  );

  // L3
  const decision = evaluatePolicy(findings, opts.policyConfig);

  // Evidence package (L5 v0)
  const evidence = buildEvidencePackageV0({
    req,
    normalized,
    scanned,
    scanners: opts.scanners,
    findings,
    decision,
  });

  let evidenceFilePath: string | undefined;
  let evidenceReportFilePath: string | undefined;
  let sessionRootDir: string | undefined;
  let turnDir: string | undefined;
  let sessionSummaryPath: string | undefined;

  let dumpDecision: DumpDecision | undefined;

  // Helper: session layout dumping (writes evidence + report, updates session summary)
  const dumpToSessionLayout = async () => {
    if (!opts.dumpSession) return;
    const out = await dumpEvidenceToSessionLayout(evidence, opts.dumpSession);
    sessionRootDir = out.sessionRoot;
    turnDir = out.turnDir;
    evidenceFilePath = out.evidencePath;
    evidenceReportFilePath = out.reportPath;
    sessionSummaryPath = out.summaryPath;
  };

  // Helper: flat dumping (separate evidence/report outputs)
  const dumpFlat = async (doEvidence: boolean, doReport: boolean) => {
    if (doEvidence) {
      const dumpOpts: SaveEvidenceOptions =
        typeof opts.dumpEvidence === "object" ? opts.dumpEvidence : {};
      evidenceFilePath = await saveEvidencePackage(evidence, dumpOpts);
    }

    if (doReport) {
      const reportOpts: SaveEvidenceReportOptions =
        typeof opts.dumpEvidenceReport === "object" ? opts.dumpEvidenceReport : {};
      evidenceReportFilePath = await saveEvidenceReportEN(evidence, reportOpts);
    }
  };

  // --- Dumping strategy ---
  if (opts.dumpPolicy) {
    // Policy-based dumping
    const cfg = opts.dumpPolicy === true ? {} : opts.dumpPolicy;

    dumpDecision = decideDumpPolicy({
      requestId: req.requestId,
      action: decision.action as any,
      risk: decision.risk,
      findings,
    }, cfg);

    if (dumpDecision.dump) {
      if (opts.dumpSession) {
        // Session layout dump (writes both evidence+report and updates session summary)
        await dumpToSessionLayout();
      } else {
        await dumpFlat(dumpDecision.dumpEvidence, dumpDecision.dumpReport);
      }
    }
  } else {
    // Direct dumping (always, if enabled)
    const wantEvidence = Boolean(opts.dumpEvidence);
    const wantReport = Boolean(opts.dumpEvidenceReport);

    if (wantEvidence || wantReport) {
      if (opts.dumpSession) {
        await dumpToSessionLayout();
      } else {
        await dumpFlat(wantEvidence, wantReport);
      }
    }
  }

  if (opts.autoCloseScanners) {
    tryCloseScanners(opts.scanners);
  }

  return {
    requestId: req.requestId,
    createdAt,
    normalized,
    scanned,
    findings,
    decision,
    integrity: { algo: "sha256", rootHash: evidence.integrity.rootHash },
    evidence,
    evidenceFilePath,
    evidenceReportFilePath,
    sessionRootDir,
    turnDir,
    sessionSummaryPath,
    dumpDecision,
  };
}
