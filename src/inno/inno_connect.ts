/**
 * InnoConnect — REST API client for Inno Platform (inno-wallet).
 *
 * Handles:
 *  - SUI wallet address creation
 *  - Walrus byte upload (evidence storage)
 *  - Walrus blob existence & expiry queries
 *
 * Uses Node.js built-in `fetch` (Node 18+). No external dependencies.
 */

import { Buffer } from "node:buffer";
import type { EvidencePackageV0 } from "../core/evidence_package.js";
import type {
  BaseResponse,
  InnoConnectConfig,
  CreateWalletOptions,
  WalletAddress,
  UploadBytesOptions,
  WalrusUploadResult,
  BlobExistsResult,
  BlobExpiryResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/** Error thrown when an Inno Platform API call fails. */
export class InnoConnectError extends Error {
  /** HTTP status code (if the request reached the server). */
  status?: number | undefined;
  /** Machine-readable error code from the server (the `return` field). */
  code?: number | undefined;

  constructor(message: string, opts?: { status?: number; code?: number | undefined }) {
    super(message);
    this.name = "InnoConnectError";
    this.status = opts?.status;
    this.code = opts?.code;
  }
}

// ---------------------------------------------------------------------------
// Internal response type for Walrus upload (snake_case from server)
// ---------------------------------------------------------------------------

interface RawWalrusUploadResponse {
  blob_id: string;
  blob_url: string;
  store_url: string;
  store_response?: unknown;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_API_VERSION = "v1.0";

export class InnoConnect {
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly publisherUrl: string;
  private readonly aggregatorUrl: string;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: InnoConnectConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.publisherUrl = config.publisherUrl.replace(/\/+$/, "");
    this.aggregatorUrl = config.aggregatorUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    this.defaultHeaders = {
      Accept: "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      ...(config.headers ?? {}),
    };
  }

  // -----------------------------------------------------------------------
  // Public API — Wallet
  // -----------------------------------------------------------------------

  /**
   * Create a new SUI wallet address.
   *
   * GET {baseUrl}/{apiVersion}/wallet/address/new
   */
  async createWallet(opts?: CreateWalletOptions): Promise<WalletAddress> {
    const params: Record<string, string> = {
      base_symbol: opts?.baseSymbol ?? "SUI",
    };
    if (opts?.showPrivateKey !== undefined) {
      params["show_private_key"] = String(opts.showPrivateKey);
    }
    if (opts?.pwd !== undefined) params["pwd"] = opts.pwd;
    if (opts?.nickname !== undefined) params["nickname"] = opts.nickname;
    if (opts?.customerId !== undefined) params["customer_id"] = String(opts.customerId);

    const raw = await this.get<{
      base_symbol: string;
      address: string;
      pk: string;
      bech32: string;
    }>("/wallet/address/new", params);

    return {
      baseSymbol: raw.base_symbol,
      address: raw.address,
      pk: raw.pk,
      bech32: raw.bech32,
    };
  }

  // -----------------------------------------------------------------------
  // Public API — Walrus Upload
  // -----------------------------------------------------------------------

  /**
   * Upload raw bytes to Walrus storage.
   *
   * POST {baseUrl}/{apiVersion}/sui/walrus/upload/bytes
   *
   * @param data  Raw bytes (Uint8Array) or Base64-encoded string.
   * @param opts  Upload options (epochs, deletable, etc.).
   */
  async uploadBytes(
    data: Uint8Array | string,
    opts?: UploadBytesOptions,
  ): Promise<WalrusUploadResult> {
    const base64Data = typeof data === "string"
      ? data
      : Buffer.from(data).toString("base64");

    const body: Record<string, unknown> = {
      base_symbol: "SUI",
      data: base64Data,
      publisher_url: this.publisherUrl,
      aggregator_url: this.aggregatorUrl,
    };
    if (opts?.epochs !== undefined) body["epochs"] = opts.epochs;
    if (opts?.sendObjectTo !== undefined) body["send_object_to"] = opts.sendObjectTo;
    if (opts?.deletable !== undefined) body["deletable"] = opts.deletable;
    if (opts?.timeoutSec !== undefined) body["timeout_sec"] = opts.timeoutSec;
    if (opts?.contentType !== undefined) body["content_type"] = opts.contentType;
    if (opts?.maxUploadSizeBytes !== undefined) body["max_upload_size_bytes"] = opts.maxUploadSizeBytes;

    const raw = await this.post<{ response: RawWalrusUploadResponse }>(
      "/sui/walrus/upload/bytes",
      body,
    );

    return normalizeUploadResult(raw.response);
  }

  /**
   * Convenience: serialize an EvidencePackageV0 to JSON → Base64, then upload.
   */
  async submitEvidence(
    evidence: EvidencePackageV0,
    opts?: UploadBytesOptions,
  ): Promise<WalrusUploadResult> {
    const json = JSON.stringify(evidence);
    const base64 = Buffer.from(json, "utf-8").toString("base64");
    return this.uploadBytes(base64, {
      contentType: "application/json",
      ...opts,
    });
  }

  // -----------------------------------------------------------------------
  // Public API — Walrus Query
  // -----------------------------------------------------------------------

  /**
   * Check whether a Walrus blob exists.
   *
   * POST {baseUrl}/{apiVersion}/sui/walrus/blob/exists
   */
  async blobExists(blobIdOrUrl: string): Promise<BlobExistsResult> {
    const raw = await this.post<{
      response: { exists: boolean; blob_url: string };
    }>("/sui/walrus/blob/exists", {
      base_symbol: "SUI",
      blob_id_or_url: blobIdOrUrl,
      aggregator_url: this.aggregatorUrl,
    });

    return {
      exists: raw.response.exists,
      blobUrl: raw.response.blob_url,
    };
  }

  /**
   * Query blob expiry information by object ID.
   *
   * POST {baseUrl}/{apiVersion}/sui/walrus/blob/expiry
   */
  async blobExpiry(blobObjectId: string): Promise<BlobExpiryResult> {
    const raw = await this.post<{
      response: {
        blob_object_id: string;
        blob_id: string;
        move_object_type?: string;
        registered_epoch: number;
        certified_epoch?: number;
        storage_object_id?: string;
        start_epoch: number;
        end_epoch: number;
        deletable: boolean;
      };
    }>("/sui/walrus/blob/expiry", {
      base_symbol: "SUI",
      blob_object_id: blobObjectId,
    });

    const r = raw.response;
    return {
      blobObjectId: r.blob_object_id,
      blobId: r.blob_id,
      moveObjectType: r.move_object_type,
      registeredEpoch: r.registered_epoch,
      certifiedEpoch: r.certified_epoch,
      storageObjectId: r.storage_object_id,
      startEpoch: r.start_epoch,
      endEpoch: r.end_epoch,
      deletable: r.deletable,
    };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private buildUrl(path: string): string {
    return `${this.baseUrl}/${this.apiVersion}${path}`;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(this.buildUrl(path));
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: this.defaultHeaders,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      return this.handleFetchError(err, `GET ${path}`);
    } finally {
      clearTimeout(timer);
    }

    return this.unwrapResponse<T>(res, `GET ${path}`);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { ...this.defaultHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      return this.handleFetchError(err, `POST ${path}`);
    } finally {
      clearTimeout(timer);
    }

    return this.unwrapResponse<T>(res, `POST ${path}`);
  }

  /**
   * Parse the BaseResponse envelope.
   * If `return !== 0`, throw InnoConnectError with the return code.
   */
  private async unwrapResponse<T>(res: Response, label: string): Promise<T> {
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new InnoConnectError(
        `Inno Platform returned non-JSON response: ${label} (HTTP ${res.status})`,
        { status: res.status },
      );
    }

    // Handle non-200 HTTP status (shouldn't happen per spec, but be safe)
    if (!res.ok) {
      const msg = typeof json === "object" && json !== null && "message" in json
        ? String((json as Record<string, unknown>)["message"])
        : `HTTP ${res.status}`;
      const code = typeof json === "object" && json !== null && "return" in json
        ? Number((json as Record<string, unknown>)["return"])
        : undefined;
      throw new InnoConnectError(
        `Inno Platform error: ${msg} (${label})`,
        { status: res.status, code },
      );
    }

    // Unwrap BaseResponse
    const envelope = json as BaseResponse<T>;
    if (envelope.return !== 0) {
      throw new InnoConnectError(
        `Inno Platform error: ${envelope.message} (${label})`,
        { status: res.status, code: envelope.return },
      );
    }

    if (envelope.value === undefined) {
      throw new InnoConnectError(
        `Inno Platform returned empty value: ${label}`,
        { status: res.status, code: 0 },
      );
    }

    return envelope.value;
  }

  private handleFetchError(err: unknown, label: string): never {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new InnoConnectError(
        `Inno Platform request timed out after ${this.timeoutMs}ms: ${label}`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new InnoConnectError(`Inno Platform network error: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert snake_case raw upload response to camelCase WalrusUploadResult. */
function normalizeUploadResult(raw: RawWalrusUploadResponse): WalrusUploadResult {
  return {
    blobId: raw.blob_id,
    blobUrl: raw.blob_url,
    storeUrl: raw.store_url,
    storeResponse: raw.store_response as WalrusUploadResult["storeResponse"],
  };
}
