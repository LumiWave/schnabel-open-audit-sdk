import type { ScannerKind } from "./types.js";
import type { NormalizedInput } from "../normalizer/types.js";
import type { Scanner, ScannerContext, ScannerOutput } from "./scanners/scanner.js";

export interface DefineScannerOptions {
  name: string;
  kind: ScannerKind;
  run: (input: NormalizedInput, ctx: ScannerContext) => Promise<ScannerOutput>;
}

/**
 * defineScanner — convenience factory for creating a Scanner with runtime validation.
 *
 * Usage:
 * ```ts
 * const MyScanner = defineScanner({
 *   name: "my_scanner",
 *   kind: "detect",
 *   async run(input, ctx) {
 *     const findings = [];
 *     // ... detection logic ...
 *     return { input, findings };
 *   },
 * });
 * ```
 */
export function defineScanner(opts: DefineScannerOptions): Scanner {
  if (!opts.name || typeof opts.name !== "string") {
    throw new Error("defineScanner: name must be a non-empty string");
  }
  if (opts.kind !== "sanitize" && opts.kind !== "enrich" && opts.kind !== "detect") {
    throw new Error(`defineScanner: invalid kind "${String(opts.kind)}"`);
  }
  if (typeof opts.run !== "function") {
    throw new Error("defineScanner: run must be a function");
  }
  return {
    name: opts.name,
    kind: opts.kind,
    run: opts.run,
  };
}
