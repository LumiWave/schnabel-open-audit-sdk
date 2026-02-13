import { describe, it, expect } from "vitest";

import { getSuiExplorerTxUrl, getSuiExplorerAccountUrl, getSuiExplorerUrl, getWalrusBlobUrl } from "../src/inno/explorer.js";

describe("getSuiExplorerTxUrl()", () => {
  it("returns mainnet TX URL by default", () => {
    const url = getSuiExplorerTxUrl("AbCdEf123");
    expect(url).toBe("https://suiscan.xyz/mainnet/tx/AbCdEf123");
  });

  it("returns testnet TX URL when specified", () => {
    const url = getSuiExplorerTxUrl("tx-hash-456", "testnet");
    expect(url).toBe("https://suiscan.xyz/testnet/tx/tx-hash-456");
  });

  it("returns devnet TX URL when specified", () => {
    const url = getSuiExplorerTxUrl("tx-hash-789", "devnet");
    expect(url).toBe("https://suiscan.xyz/devnet/tx/tx-hash-789");
  });
});

describe("getSuiExplorerAccountUrl()", () => {
  it("returns mainnet account URL by default", () => {
    const url = getSuiExplorerAccountUrl("0xabc123");
    expect(url).toBe("https://suiscan.xyz/mainnet/account/0xabc123");
  });

  it("returns testnet account URL when specified", () => {
    const url = getSuiExplorerAccountUrl("0xdef456", "testnet");
    expect(url).toBe("https://suiscan.xyz/testnet/account/0xdef456");
  });
});

describe("getSuiExplorerUrl() (deprecated alias)", () => {
  it("is an alias for getSuiExplorerTxUrl", () => {
    expect(getSuiExplorerUrl("AbC123", "mainnet"))
      .toBe(getSuiExplorerTxUrl("AbC123", "mainnet"));
  });
});

describe("getWalrusBlobUrl()", () => {
  it("returns aggregator blob URL", () => {
    const url = getWalrusBlobUrl(
      "6P7xM7qA8y2y",
      "https://walrus-testnet-aggregator.nodeinfra.com",
    );
    expect(url).toBe("https://walrus-testnet-aggregator.nodeinfra.com/v1/blobs/6P7xM7qA8y2y");
  });

  it("strips trailing slashes from aggregator URL", () => {
    const url = getWalrusBlobUrl(
      "blobId123",
      "https://walrus-aggregator.test///",
    );
    expect(url).toBe("https://walrus-aggregator.test/v1/blobs/blobId123");
  });
});
