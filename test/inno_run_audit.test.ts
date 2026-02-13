import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fromAgentIngressEvent } from "../src/adapters/generic_agent.js";
import { createInnoAuditSession, InnoAuditSession } from "../src/inno/run_audit_inno.js";
import { UnicodeSanitizerScanner } from "../src/signals/scanners/sanitize/unicode_sanitizer.js";
import { KeywordInjectionScanner } from "../src/signals/scanners/detect/keyword_injection.js";
import type { WalletAddress } from "../src/inno/types.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_WALLET_RAW = {
  base_symbol: "SUI",
  address: "0xabc123wallet",
  pk: "",
  bech32: "sui1abc123bech32",
};

const MOCK_UPLOAD_RAW = {
  response: {
    blob_id: "walrus-blob-002",
    blob_url: "https://walrus-aggregator.test/v1/blobs/walrus-blob-002",
    store_url: "https://walrus-publisher.test/v1/blobs?epochs=1",
    store_response: {
      newlyCreated: {
        blobObject: {
          id: "0xblobobject123",
          blobId: "walrus-blob-002",
          registeredEpoch: 512,
          size: 500,
        },
        cost: 2000,
      },
    },
  },
};

function wrapResponse(value: unknown): unknown {
  return { return: 0, message: "success", value };
}

const BASE_CONFIG = {
  baseUrl: "https://api.inno.test",
  publisherUrl: "https://walrus-publisher.test",
  aggregatorUrl: "https://walrus-aggregator.test",
};

const SCANNERS = [UnicodeSanitizerScanner, KeywordInjectionScanner];

function makeRequest(prompt = "Hello world") {
  return fromAgentIngressEvent({
    requestId: `r-inno-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    userPrompt: prompt,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InnoAuditSession", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCallCount: number;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCallCount = 0;

    // Mock fetch: first call → wallet, subsequent calls → upload
    globalThis.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(wrapResponse(MOCK_WALLET_RAW)),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(wrapResponse(MOCK_UPLOAD_RAW)),
      } as Response);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -- Factory --

  it("createInnoAuditSession returns an InnoAuditSession", () => {
    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
    });
    expect(session).toBeInstanceOf(InnoAuditSession);
    expect(session.sessionState).toBe("idle");
  });

  // -- Lifecycle: start → audit → finish --

  it("full lifecycle: start → multiple audits → finish", async () => {
    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
    });

    await session.start();
    expect(session.sessionState).toBe("started");
    expect(session.walletInfo?.address).toBe("0xabc123wallet");

    // Run 3 audits
    const r1 = await session.audit(makeRequest("Test prompt 1"));
    const r2 = await session.audit(makeRequest("Test prompt 2"));
    const r3 = await session.audit(makeRequest("Test prompt 3"));
    expect(session.auditCount).toBe(3);
    expect(r1.decision).toBeDefined();
    expect(r2.decision).toBeDefined();
    expect(r3.decision).toBeDefined();

    // Finish → batch upload all evidence as one blob (default)
    const result = await session.finish();
    expect(session.sessionState).toBe("finished");
    expect(result.auditResults).toHaveLength(3);
    expect(result.inno?.submission?.blobId).toBe("walrus-blob-002");
    expect(result.inno?.submission?.blobObjectId).toBe("0xblobobject123");
    expect(result.inno?.walletExplorerUrl).toContain("suiscan.xyz/testnet/account/0xabc123wallet");
    expect(result.uploads).toHaveLength(1); // batch mode → single upload

    // batch: false → individual uploads
    fetchCallCount = 0; // reset for new session
    const session2 = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
    });
    await session2.start();
    await session2.audit(makeRequest("a"));
    await session2.audit(makeRequest("b"));
    const result2 = await session2.finish({ batch: false });
    expect(result2.uploads).toHaveLength(2);
  });

  // -- wallet callback --

  it("calls onWalletCreated with wallet info", async () => {
    const walletCallback = vi.fn();
    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
      onWalletCreated: walletCallback,
    });

    await session.start();

    expect(walletCallback).toHaveBeenCalledOnce();
    const received = walletCallback.mock.calls[0]![0] as WalletAddress;
    expect(received.address).toBe("0xabc123wallet");
    expect(received.bech32).toBe("sui1abc123bech32");
  });

  // -- network config --

  it("uses specified network for explorer URL", async () => {
    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
      network: "mainnet",
    });

    await session.start();
    await session.audit(makeRequest());
    const result = await session.finish();

    expect(result.inno!.walletExplorerUrl).toBe("https://suiscan.xyz/mainnet/account/0xabc123wallet");
  });

  // -- error handling: wallet fail + continue --

  it("continues when wallet creation fails (continueOnInnoError default)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
    });

    await session.start(); // should not throw
    expect(session.sessionState).toBe("started");
    expect(session.walletInfo).toBeUndefined();

    await session.audit(makeRequest());
    const result = await session.finish();

    expect(result.auditResults).toHaveLength(1);
    expect(result.inno).toBeUndefined(); // no wallet → no inno meta

    consoleSpy.mockRestore();
  });

  // -- error handling: wallet fail + throw --

  it("throws when wallet creation fails and continueOnInnoError is false", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
      continueOnInnoError: false,
    });

    await expect(session.start()).rejects.toThrow("network down");
  });

  // -- error handling: upload fail + continue --

  it("returns wallet info even when upload fails", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(wrapResponse(MOCK_WALLET_RAW)),
        } as Response);
      }
      return Promise.reject(new Error("upload failed"));
    });
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
    });

    await session.start();
    await session.audit(makeRequest());
    const result = await session.finish();

    expect(result.inno?.wallet?.address).toBe("0xabc123wallet");
    expect(result.inno?.submission).toBeUndefined();
    expect(result.uploads).toBeUndefined();

    consoleSpy.mockRestore();
  });

  // -- state guards --

  it("throws when calling start() twice", async () => {
    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
    });

    await session.start();
    await expect(session.start()).rejects.toThrow(/cannot start/);
  });

  it("throws when calling audit() before start()", async () => {
    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
    });

    await expect(session.audit(makeRequest())).rejects.toThrow(/Call start\(\) first/);
  });

  it("throws when calling finish() before start()", async () => {
    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
    });

    await expect(session.finish()).rejects.toThrow(/cannot finish/);
  });

  it("throws when calling audit() after finish()", async () => {
    const session = createInnoAuditSession({
      inno: BASE_CONFIG,
      auditDefaults: { scanners: SCANNERS },
    });

    await session.start();
    await session.finish();
    await expect(session.audit(makeRequest())).rejects.toThrow(/cannot audit/);
  });
});
