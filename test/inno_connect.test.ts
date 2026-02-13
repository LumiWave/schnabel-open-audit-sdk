import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { InnoConnect, InnoConnectError } from "../src/inno/inno_connect.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  baseUrl: "https://api.inno.test",
  publisherUrl: "https://walrus-publisher.test",
  aggregatorUrl: "https://walrus-aggregator.test",
};

const MOCK_WALLET_RAW = {
  base_symbol: "SUI",
  address: "0x2f8e3c6f64d9f4a8f4b3b3e6cb1f65ec6d2b57db99f57c9a6ad4c6c95f2d61aa",
  pk: "",
  bech32: "sui1z4k8q0r4z0l5x8k3c4h5p8u2h7y5n9v4j6f4w8p7m2k7d5xwq2k",
};

const MOCK_UPLOAD_RAW = {
  response: {
    blob_id: "6P7xM7qA8y2yV2JQzJ6NB6g4Xk7X5W1mS8fWmQW7z3U",
    blob_url: "https://walrus-aggregator.test/v1/blobs/6P7xM7qA8y2yV2JQzJ6NB6g4Xk7X5W1mS8fWmQW7z3U",
    store_url: "https://walrus-publisher.test/v1/blobs?deletable=true&epochs=2",
    store_response: {
      newlyCreated: {
        blobObject: {
          id: "0x6a0f3fd979b4f9fc5d8a0c17310c7f8aa1a0638d0f6a6798b6e26ea5157b2d57",
          blobId: "6P7xM7qA8y2yV2JQzJ6NB6g4Xk7X5W1mS8fWmQW7z3U",
          registeredEpoch: 512,
          size: 13,
          deletable: true,
        },
        cost: 1450,
      },
    },
  },
};

const MOCK_BLOB_EXISTS_RAW = {
  response: {
    exists: true,
    blob_url: "https://walrus-aggregator.test/v1/blobs/6P7xM7qA8y2yV2JQzJ6NB6g4Xk7X5W1mS8fWmQW7z3U",
  },
};

const MOCK_BLOB_EXPIRY_RAW = {
  response: {
    blob_object_id: "0x1c42f7bf763f7ee77af851eb64d9cd9d0be3c8b0a93fbe0f2fdbef1cdd8ec8f1",
    blob_id: "2d3M2nnn9Qsp2Y6wL8m8x3zJ1Lw6Y4YqB7u2m5u4n9A",
    move_object_type: "0x2::blob::Blob",
    registered_epoch: 512,
    certified_epoch: 513,
    storage_object_id: "0x9ef6f8ce23b0285c5f0ac12953227dc1f455e42a0862f6f12fd52c494d2f89db",
    start_epoch: 512,
    end_epoch: 514,
    deletable: true,
  },
};

function wrapResponse(value: unknown): unknown {
  return { return: 0, message: "success", value };
}

function mockFetchOk(body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(wrapResponse(body)),
  } as Response);
}

function mockFetchError(returnCode: number, message: string): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ return: returnCode, message }),
  } as Response);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InnoConnect", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -- createWallet ---------------------------------------------------------

  describe("createWallet()", () => {
    it("calls GET with query params and returns wallet address", async () => {
      const mockFn = mockFetchOk(MOCK_WALLET_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect(BASE_CONFIG);
      const wallet = await client.createWallet();

      expect(wallet.baseSymbol).toBe("SUI");
      expect(wallet.address).toBe(MOCK_WALLET_RAW.address);
      expect(wallet.bech32).toBe(MOCK_WALLET_RAW.bech32);
      expect(wallet.pk).toBe("");

      expect(mockFn).toHaveBeenCalledOnce();
      const [url, opts] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(opts.method).toBe("GET");
      expect(url).toContain("/v1.0/wallet/address/new");
      expect(url).toContain("base_symbol=SUI");
    });

    it("passes optional query params when provided", async () => {
      const mockFn = mockFetchOk(MOCK_WALLET_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect(BASE_CONFIG);
      await client.createWallet({
        showPrivateKey: true,
        pwd: "mypassword",
        nickname: "test-wallet",
        customerId: 1001,
      });

      const [url] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toContain("show_private_key=true");
      expect(url).toContain("pwd=mypassword");
      expect(url).toContain("nickname=test-wallet");
      expect(url).toContain("customer_id=1001");
    });

    it("sends Authorization header when apiKey is provided", async () => {
      const mockFn = mockFetchOk(MOCK_WALLET_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect({ ...BASE_CONFIG, apiKey: "my-secret-key" });
      await client.createWallet();

      const [, opts] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(opts.headers["Authorization"]).toBe("Bearer my-secret-key");
    });

    it("strips trailing slashes from baseUrl", async () => {
      const mockFn = mockFetchOk(MOCK_WALLET_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect({ ...BASE_CONFIG, baseUrl: "https://api.inno.test///" });
      await client.createWallet();

      const [url] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toContain("https://api.inno.test/v1.0/wallet/address/new");
    });

    it("uses custom apiVersion", async () => {
      const mockFn = mockFetchOk(MOCK_WALLET_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect({ ...BASE_CONFIG, apiVersion: "v2.0" });
      await client.createWallet();

      const [url] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toContain("/v2.0/wallet/address/new");
    });
  });

  // -- uploadBytes ----------------------------------------------------------

  describe("uploadBytes()", () => {
    it("calls POST with base64 data and returns upload result", async () => {
      const mockFn = mockFetchOk(MOCK_UPLOAD_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect(BASE_CONFIG);
      const result = await client.uploadBytes("SGVsbG8gV2FscnVzIQ==", { epochs: 2 });

      expect(result.blobId).toBe("6P7xM7qA8y2yV2JQzJ6NB6g4Xk7X5W1mS8fWmQW7z3U");
      expect(result.blobUrl).toContain("/v1/blobs/");
      expect(result.storeResponse?.newlyCreated?.cost).toBe(1450);

      const [url, opts] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toContain("/v1.0/sui/walrus/upload/bytes");
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.base_symbol).toBe("SUI");
      expect(body.data).toBe("SGVsbG8gV2FscnVzIQ==");
      expect(body.publisher_url).toBe("https://walrus-publisher.test");
      expect(body.aggregator_url).toBe("https://walrus-aggregator.test");
      expect(body.epochs).toBe(2);
    });

    it("accepts Uint8Array and encodes to base64", async () => {
      const mockFn = mockFetchOk(MOCK_UPLOAD_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect(BASE_CONFIG);
      const data = new TextEncoder().encode("Hello Walrus!");
      await client.uploadBytes(data);

      const [, opts] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(opts.body);
      expect(body.data).toBe(Buffer.from("Hello Walrus!").toString("base64"));
    });

    it("passes optional upload options", async () => {
      const mockFn = mockFetchOk(MOCK_UPLOAD_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect(BASE_CONFIG);
      await client.uploadBytes("dGVzdA==", {
        epochs: 5,
        sendObjectTo: "0xabc",
        deletable: true,
        timeoutSec: 60,
        contentType: "text/plain",
        maxUploadSizeBytes: 1048576,
      });

      const [, opts] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(opts.body);
      expect(body.epochs).toBe(5);
      expect(body.send_object_to).toBe("0xabc");
      expect(body.deletable).toBe(true);
      expect(body.timeout_sec).toBe(60);
      expect(body.content_type).toBe("text/plain");
      expect(body.max_upload_size_bytes).toBe(1048576);
    });
  });

  // -- submitEvidence -------------------------------------------------------

  describe("submitEvidence()", () => {
    it("serializes evidence to JSON → base64 → uploadBytes", async () => {
      const mockFn = mockFetchOk(MOCK_UPLOAD_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect(BASE_CONFIG);
      const evidence = { schema: "schnabel-evidence-v0", requestId: "r-1" } as any;
      const result = await client.submitEvidence(evidence, { epochs: 3 });

      expect(result.blobId).toBe("6P7xM7qA8y2yV2JQzJ6NB6g4Xk7X5W1mS8fWmQW7z3U");

      const [, opts] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(opts.body);
      // Decode base64 and verify it's the evidence JSON
      const decoded = Buffer.from(body.data, "base64").toString("utf-8");
      expect(JSON.parse(decoded)).toEqual(evidence);
      expect(body.content_type).toBe("application/json");
      expect(body.epochs).toBe(3);
    });
  });

  // -- blobExists -----------------------------------------------------------

  describe("blobExists()", () => {
    it("checks blob existence and returns result", async () => {
      const mockFn = mockFetchOk(MOCK_BLOB_EXISTS_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect(BASE_CONFIG);
      const result = await client.blobExists("6P7xM7qA8y2yV2JQzJ6NB6g4Xk7X5W1mS8fWmQW7z3U");

      expect(result.exists).toBe(true);
      expect(result.blobUrl).toContain("/v1/blobs/");

      const [url, opts] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toContain("/v1.0/sui/walrus/blob/exists");
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.base_symbol).toBe("SUI");
      expect(body.blob_id_or_url).toBe("6P7xM7qA8y2yV2JQzJ6NB6g4Xk7X5W1mS8fWmQW7z3U");
      expect(body.aggregator_url).toBe("https://walrus-aggregator.test");
    });
  });

  // -- blobExpiry -----------------------------------------------------------

  describe("blobExpiry()", () => {
    it("queries blob expiry and returns camelCase result", async () => {
      const mockFn = mockFetchOk(MOCK_BLOB_EXPIRY_RAW);
      globalThis.fetch = mockFn;

      const client = new InnoConnect(BASE_CONFIG);
      const result = await client.blobExpiry("0x1c42f7bf...");

      expect(result.blobObjectId).toBe(MOCK_BLOB_EXPIRY_RAW.response.blob_object_id);
      expect(result.blobId).toBe(MOCK_BLOB_EXPIRY_RAW.response.blob_id);
      expect(result.registeredEpoch).toBe(512);
      expect(result.certifiedEpoch).toBe(513);
      expect(result.startEpoch).toBe(512);
      expect(result.endEpoch).toBe(514);
      expect(result.deletable).toBe(true);
      expect(result.moveObjectType).toBe("0x2::blob::Blob");

      const [, opts] = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(opts.body);
      expect(body.base_symbol).toBe("SUI");
      expect(body.blob_object_id).toBe("0x1c42f7bf...");
    });
  });

  // -- Error handling -------------------------------------------------------

  describe("error handling", () => {
    it("throws InnoConnectError when return code is non-zero", async () => {
      globalThis.fetch = mockFetchError(81200, "Result_Invalid_Data");

      const client = new InnoConnect(BASE_CONFIG);
      await expect(client.createWallet()).rejects.toThrow(InnoConnectError);

      try {
        await client.createWallet();
      } catch (err) {
        expect(err).toBeInstanceOf(InnoConnectError);
        const e = err as InnoConnectError;
        expect(e.code).toBe(81200);
        expect(e.message).toContain("Result_Invalid_Data");
      }
    });

    it("throws InnoConnectError on HTTP error (non-200)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ return: 500, message: "Internal Server Error" }),
      } as unknown as Response);

      const client = new InnoConnect(BASE_CONFIG);
      await expect(client.createWallet()).rejects.toThrow(/Internal Server Error/);
    });

    it("throws InnoConnectError on non-JSON response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("not JSON")),
      } as unknown as Response);

      const client = new InnoConnect(BASE_CONFIG);
      await expect(client.createWallet()).rejects.toThrow(/non-JSON/);
    });

    it("throws InnoConnectError on network failure", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      const client = new InnoConnect(BASE_CONFIG);
      await expect(client.createWallet()).rejects.toThrow(/network error.*fetch failed/i);
    });

    it("throws InnoConnectError on timeout (AbortError)", async () => {
      globalThis.fetch = vi.fn().mockImplementation(() => {
        const err = new DOMException("signal is aborted", "AbortError");
        return Promise.reject(err);
      });

      const client = new InnoConnect({ ...BASE_CONFIG, timeoutMs: 100 });
      await expect(client.createWallet()).rejects.toThrow(/timed out/);
    });

    it("throws InnoConnectError when value is undefined", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ return: 0, message: "success" }),
      } as Response);

      const client = new InnoConnect(BASE_CONFIG);
      await expect(client.createWallet()).rejects.toThrow(/empty value/);
    });
  });
});
