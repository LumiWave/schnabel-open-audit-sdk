import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fromAgentIngressEvent } from "../src/adapters/generic_agent.js";
import { normalize } from "../src/normalizer/normalize.js";
import { scanSignals } from "../src/signals/scan.js";
import { createRulePackScanner } from "../src/signals/scanners/detect/rulepack_scanner.js";

function writePack(filePath: string, version: string, pattern: string) {
  const pack = {
    version,
    rules: [
      {
        id: "tmp.rule",
        category: "tmp",
        patternType: "regex",
        pattern,
        flags: "i",
        risk: "high",
        score: 0.8,
        summary: `tmp: ${pattern}`,
      },
    ],
  };
  fs.writeFileSync(filePath, JSON.stringify(pack, null, 2), "utf8");
}

describe("RulePack hot reload", () => {
  it("reloads rulepack when file changes (fs.watch + mtime fallback)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schnabel-rulepack-"));
    const filePath = path.join(dir, "pack.json");
    const packUrl = pathToFileURL(filePath);

    writePack(filePath, "v1", "foo");

    const scanner = createRulePackScanner({
      packUrl,
      hotReload: true,
      watchDebounceMs: 30,
      logger: () => {}, // silence in test
    });

    // First: "foo" should match
    {
      const req = fromAgentIngressEvent({ requestId: "r-hr-1", timestamp: 1, userPrompt: "foo" });
      const n = normalize(req);
      const { findings } = await scanSignals(n, [scanner], { mode: "audit", failFast: false });
      expect(findings.length).toBeGreaterThan(0);
    }

    // Update pack: now "bar" should match
    writePack(filePath, "v2", "bar");

    // Wait a bit for watch/debounce (mtime fallback also helps)
    await new Promise(r => setTimeout(r, 120));

    {
      const req = fromAgentIngressEvent({ requestId: "r-hr-2", timestamp: 1, userPrompt: "bar" });
      const n = normalize(req);
      const { findings } = await scanSignals(n, [scanner], { mode: "audit", failFast: false });
      expect(findings.length).toBeGreaterThan(0);
    }

    scanner.close();
  });
});
