import { describe, it, expect } from "vitest";

import { fromAgentIngressEvent } from "../src/adapters/generic_agent.js";
import { normalize } from "../src/normalizer/normalize.js";
import { scanSignals } from "../src/signals/scan.js";
import { createRulePackScanner } from "../src/signals/scanners/detect/rulepack_scanner.js";

describe("RulePack negativePattern", () => {
  it("does not flag when negativePattern matches (false positive reduction)", async () => {
    const req = fromAgentIngressEvent({
      requestId: "r-neg-1",
      timestamp: 1,
      userPrompt: "I will never ignore previous instructions.",
    });

    const n = normalize(req);
    const rulepack = createRulePackScanner();

    const { findings } = await scanSignals(n, [rulepack], { mode: "audit", failFast: false });

    const overrideHit = findings.some(
      f => (f.evidence as any)?.ruleId === "injection.override.ignore_previous_instructions"
    );

    expect(overrideHit).toBe(false);

    // optional cleanup if your scanner supports hotReload watchers later
    if ((rulepack as any).close) (rulepack as any).close();
  });
});
