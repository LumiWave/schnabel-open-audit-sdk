/**
 * Schnabel Open Audit SDK (public API)
 *
 * This barrel file is intentionally explicit.
 * - It defines what is considered "public/stable" for SDK consumers.
 * - Internal modules can still exist, but should not be imported directly by apps.
 */

// ---------- L0 / L1 ----------
export { fromAgentIngressEvent } from "./adapters/generic_agent.js";
export type { AgentIngressEvent } from "./adapters/generic_agent.js";

export { normalize } from "./normalizer/normalize.js";
export { canonicalizeJson } from "./normalizer/canonicalize.js";
export type {
  AuditRequest,
  NormalizedInput,
  InputSource,
  SourcedText,
  TextView,
  TextViewSet,
  ChunkViews,
  InputViews,
} from "./normalizer/types.js";

// ---------- L2 Signals ----------
export { scanSignals } from "./signals/scan.js";
export type { ScanOptions } from "./signals/scan.js";

export type {
  Finding,
  FindingTarget,
  RiskLevel,
  ScannerKind,
} from "./signals/types.js";

export type {
  Scanner,
  ScannerContext,
  ScannerOutput,
} from "./signals/scanners/scanner.js";

export {
  ensureViews,
  VIEW_SCAN_ORDER,
  VIEW_PREFERENCE,
  pickPreferredView,
} from "./signals/views.js";

export { sha256Hex } from "./signals/util.js";

// Built-in scanners (prompt / retrieval)
export { UnicodeSanitizerScanner } from "./signals/scanners/sanitize/unicode_sanitizer.js";
export { HiddenAsciiTagsScanner } from "./signals/scanners/sanitize/hidden_ascii_tags.js";
export { SeparatorCollapseScanner } from "./signals/scanners/sanitize/separator_collapse.js";
export { Uts39SkeletonViewScanner } from "./signals/scanners/enrich/uts39_skeleton_view.js";

export { createRulePackScanner } from "./signals/scanners/detect/rulepack_scanner.js";
export { KeywordInjectionScanner } from "./signals/scanners/detect/keyword_injection.js";
export { Uts39ConfusablesScanner } from "./signals/scanners/detect/uts39_confusables.js";

// Tool boundary scanners (toolCalls args)
export { ToolArgsCanonicalizerScanner } from "./signals/scanners/sanitize/tool_args_canonicalizer.js";
export { ToolArgsSSRFScanner } from "./signals/scanners/detect/tool_args_ssrf.js";
export { ToolArgsPathTraversalScanner } from "./signals/scanners/detect/tool_args_path_traversal.js";

// Post-LLM contradiction detectors (toolResults vs responseText)
export { ToolResultContradictionScanner } from "./signals/scanners/detect/tool_result_contradiction.js";
export { ToolResultFactMismatchScanner } from "./signals/scanners/detect/tool_result_fact_mismatch.js";

// Multi-turn (history) detectors require a HistoryStore injection
export { createHistoryContradictionScanner } from "./signals/scanners/detect/history_contradiction.js";
export { createHistoryFlipFlopScanner } from "./signals/scanners/detect/history_flipflop.js";

// ---------- L3 Policy ----------
export { evaluatePolicy } from "./policy/evaluate.js";
export type {
  PolicyDecision,
  PolicyConfig,
  VerdictAction,
} from "./policy/evaluate.js";

export { applyPolicyEscalations } from "./policy/escalations.js";

// ---------- L5 Evidence / Core ----------
export { runAudit } from "./core/run_audit.js";
export type { AuditRunOptions, AuditResult } from "./core/run_audit.js";

export { buildEvidencePackageV0 } from "./core/evidence_package.js";
export type { EvidencePackageV0, EvidenceOptions } from "./core/evidence_package.js";

export { saveEvidencePackage } from "./core/evidence_dump.js";
export type { SaveEvidenceOptions } from "./core/evidence_dump.js";

export { renderEvidenceReportEN } from "./core/evidence_report_en.js";
export type { ReportOptions } from "./core/evidence_report_en.js";

export {
  saveEvidenceReportEN,
  saveEvidenceReportKR,
  saveEvidenceReportMarkdown,
} from "./core/evidence_report_dump.js";
export type { SaveEvidenceReportOptions } from "./core/evidence_report_dump.js";

export { decideDumpPolicy } from "./core/dump_policy.js";
export type {
  DumpPolicyInput,
  DumpPolicyConfig,
  DumpDecision,
} from "./core/dump_policy.js";

export { dumpEvidenceToSessionLayout } from "./core/session_store.js";
export type { SessionDumpOptions, SessionStateV0 } from "./core/session_store.js";

export { SessionAggregator } from "./core/session_aggregator.js";
export type { SessionSummary, TurnRecord } from "./core/session_aggregator.js";

// History store for multi-turn escalation
export { InMemoryHistoryStore } from "./core/history_store.js";
export type { HistoryStore, HistoryTurnV0 } from "./core/history_store.js";

// ---------- Presets (recommended chains) ----------
export {
  createPreLLMScannerChain,
  createToolBoundaryScannerChain,
  createPostLLMScannerChain,
} from "./core/presets.js";
export type { PresetOptions } from "./core/presets.js";

// ---------- Advanced: asset resolver (for packaged builds) ----------
export { resolveAssetUrl } from "./assets/asset_url.js";
