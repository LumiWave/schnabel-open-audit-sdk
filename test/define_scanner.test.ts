import { describe, it, expect } from "vitest";

import { defineScanner } from "../src/signals/define_scanner.js";
import { fromAgentIngressEvent } from "../src/adapters/generic_agent.js";
import { normalize } from "../src/normalizer/normalize.js";
import { scanSignals } from "../src/signals/scan.js";
import { ensureViews } from "../src/signals/views.js";
import { makeFindingId } from "../src/signals/util.js";

describe("defineScanner", () => {
  it("creates a valid detect scanner", async () => {
    const scanner = defineScanner({
      name: "test_detect",
      kind: "detect",
      async run(input) {
        const base = ensureViews(input);
        return {
          input: base,
          findings: [
            {
              id: makeFindingId("test_detect", base.requestId, "prompt"),
              kind: "detect",
              scanner: "test_detect",
              score: 0.5,
              risk: "medium",
              tags: ["test"],
              summary: "Test finding",
              target: { field: "prompt", view: "raw" },
              evidence: { custom: true },
            },
          ],
        };
      },
    });

    expect(scanner.name).toBe("test_detect");
    expect(scanner.kind).toBe("detect");

    const req = fromAgentIngressEvent({
      requestId: "ds-1",
      timestamp: 1,
      userPrompt: "Hello",
    });
    const n = normalize(req);
    const result = await scanner.run(n, { mode: "audit", nowMs: Date.now() });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.scanner).toBe("test_detect");
    expect(result.findings[0]!.evidence?.["custom"]).toBe(true);
  });

  it("creates a valid sanitize scanner that transforms input", async () => {
    const scanner = defineScanner({
      name: "test_sanitize",
      kind: "sanitize",
      async run(input) {
        const base = ensureViews(input);
        const views = base.views!;
        // Replace "bad" with "good" in sanitized view
        views.prompt.sanitized = views.prompt.sanitized.replace("bad", "good");
        return { input: base, findings: [] };
      },
    });

    expect(scanner.kind).toBe("sanitize");

    const req = fromAgentIngressEvent({
      requestId: "ds-2",
      timestamp: 1,
      userPrompt: "This is bad text",
    });
    const n = normalize(req);
    const result = await scanner.run(n, { mode: "audit", nowMs: Date.now() });

    expect(result.input.views!.prompt.sanitized).toBe("This is good text");
    expect(result.input.views!.prompt.raw).toBe("This is bad text");
  });

  it("throws on empty name", () => {
    expect(() =>
      defineScanner({
        name: "",
        kind: "detect",
        async run(input) {
          return { input, findings: [] };
        },
      })
    ).toThrow("defineScanner: name must be a non-empty string");
  });

  it("throws on invalid kind", () => {
    expect(() =>
      defineScanner({
        name: "test",
        kind: "invalid" as "detect",
        async run(input) {
          return { input, findings: [] };
        },
      })
    ).toThrow('defineScanner: invalid kind "invalid"');
  });

  it("throws on non-function run", () => {
    expect(() =>
      defineScanner({
        name: "test",
        kind: "detect",
        run: "not a function" as unknown as () => Promise<{ input: unknown; findings: unknown[] }>,
      } as never)
    ).toThrow("defineScanner: run must be a function");
  });

  it("works in scanSignals chain alongside built-in scanners", async () => {
    const customScanner = defineScanner({
      name: "custom_keyword",
      kind: "detect",
      async run(input) {
        const base = ensureViews(input);
        const prompt = base.views!.prompt.raw;
        const findings = [];

        if (/secret/i.test(prompt)) {
          findings.push({
            id: makeFindingId("custom_keyword", base.requestId, "secret:prompt"),
            kind: "detect" as const,
            scanner: "custom_keyword",
            score: 0.9,
            risk: "high" as const,
            tags: ["custom", "secret"],
            summary: "Secret keyword detected",
            target: { field: "prompt" as const, view: "raw" as const },
            evidence: { keyword: "secret" },
          });
        }

        return { input: base, findings };
      },
    });

    const req = fromAgentIngressEvent({
      requestId: "ds-3",
      timestamp: 1,
      userPrompt: "Tell me the secret password",
    });
    const n = normalize(req);
    const { findings } = await scanSignals(n, [customScanner], {
      mode: "audit",
      failFast: false,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.scanner).toBe("custom_keyword");
    expect(findings[0]!.risk).toBe("high");
    expect(findings[0]!.evidence?.["keyword"]).toBe("secret");
  });
});
