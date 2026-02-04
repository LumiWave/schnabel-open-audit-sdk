import type { EvidencePackageV0 } from "./evidence_package.js";
import { renderEvidenceReportEN } from "./evidence_report_en.js";

/**
 * Compatibility wrapper:
 * Keep KR entrypoint, but return the EN simple report to avoid mixed output.
 */
export function renderEvidenceReportKR(e: EvidencePackageV0): string {
  return renderEvidenceReportEN(e);
}
