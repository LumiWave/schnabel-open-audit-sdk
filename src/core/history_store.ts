import type { RiskLevel } from "../signals/types.js";

export type VerdictAction = "allow" | "allow_with_warning" | "challenge" | "block";

/**
 * HistoryTurnV0
 * - Minimal per-turn record used for multi-turn escalation and contradiction detection.
 * - Stored by sessionId in a HistoryStore.
 */
export interface HistoryTurnV0 {
  requestId: string;
  createdAtMs: number;
  action: VerdictAction;
  risk: RiskLevel;

  // Tool outcome snapshot (useful for gaslighting checks)
  succeededTools: string[];
  failedTools: string[];

  // Short response snippet (for light heuristic comparisons)
  responseSnippet?: string;

  // Optional: signal digest (rule ids / categories)
  ruleIds?: string[];
  categories?: string[];

  // Detect scanner names / tags (for repetition-based escalation)
  detectScanners?: string[];
  detectTags?: string[];
}

export interface HistoryStore {
  getRecent(sessionId: string, limit: number): Promise<HistoryTurnV0[]>;
  append(sessionId: string, turn: HistoryTurnV0): Promise<void>;
}

/**
 * InMemoryHistoryStore
 * - In-memory session history store (good for dev/testing and simple integrations).
 * - You can replace this with Redis/DB later without changing scan/policy logic.
 */
export class InMemoryHistoryStore implements HistoryStore {
  private maxTurns: number;
  private map = new Map<string, HistoryTurnV0[]>();

  constructor(opts?: { maxTurns?: number }) {
    this.maxTurns = opts?.maxTurns ?? 200;
  }

  async getRecent(sessionId: string, limit: number): Promise<HistoryTurnV0[]> {
    const arr = this.map.get(sessionId) ?? [];
    if (limit <= 0) return [];
    return arr.slice(Math.max(0, arr.length - limit));
  }

  async append(sessionId: string, turn: HistoryTurnV0): Promise<void> {
    const arr = this.map.get(sessionId) ?? [];
    arr.push(turn);
    if (arr.length > this.maxTurns) {
      arr.splice(0, arr.length - this.maxTurns);
    }
    this.map.set(sessionId, arr);
  }
}
