/**
 * Inno Platform + SUI Wallet + Walrus Storage type definitions.
 *
 * Matches the inno-wallet external API (v1.0):
 *  - Wallet creation (GET /wallet/address/new)
 *  - Walrus byte upload (POST /sui/walrus/upload/bytes)
 *  - Walrus blob query (POST /sui/walrus/blob/exists, /blob/expiry)
 */

// ---------------------------------------------------------------------------
// Base response envelope
// ---------------------------------------------------------------------------

/**
 * Common response wrapper from the inno-wallet API.
 * HTTP status is always 200; success/failure is determined by `return`.
 */
export interface BaseResponse<T = unknown> {
  /** Result code. `0` = success, anything else = failure. */
  return: number;
  /** Human-readable result message. */
  message: string;
  /** Response payload (structure varies by endpoint). */
  value?: T | undefined;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Inno Platform REST API connection configuration. */
export interface InnoConnectConfig {
  /** Inno Platform REST API base URL (e.g. "https://dev.lumiwavelab.com:51121"). */
  baseUrl: string;
  /** API version path prefix. Default: "v1.0". */
  apiVersion?: string | undefined;
  /** Walrus Publisher base URL (e.g. "https://walrus-testnet-publisher.nodeinfra.com"). */
  publisherUrl: string;
  /** Walrus Aggregator base URL (e.g. "https://walrus-testnet-aggregator.nodeinfra.com"). */
  aggregatorUrl: string;
  /** API key or auth token sent as `Authorization: Bearer <apiKey>`. */
  apiKey?: string | undefined;
  /** Request timeout in milliseconds. Default: 30 000. */
  timeoutMs?: number | undefined;
  /** Extra headers merged into every request. */
  headers?: Record<string, string> | undefined;
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

/** Options for `createWallet()`. */
export interface CreateWalletOptions {
  /** Chain symbol. Default: "SUI". */
  baseSymbol?: string | undefined;
  /** If true, the response includes the private key. Default: false. */
  showPrivateKey?: boolean | undefined;
  /** Password used during wallet creation. */
  pwd?: string | undefined;
  /** Wallet nickname. */
  nickname?: string | undefined;
  /** Customer ID (recommended for production). */
  customerId?: number | undefined;
}

/** Response from `GET /wallet/address/new`. */
export interface WalletAddress {
  /** Chain symbol of the created wallet. */
  baseSymbol: string;
  /** Created wallet address. */
  address: string;
  /** Private key (only populated when `showPrivateKey=true`). */
  pk: string;
  /** SUI bech32 address. */
  bech32: string;
}

// ---------------------------------------------------------------------------
// Walrus Upload
// ---------------------------------------------------------------------------

/** Options for `uploadBytes()`. */
export interface UploadBytesOptions {
  /** Storage epochs. Default: 1, max: 53. */
  epochs?: number | undefined;
  /** SUI address to receive the blob object. */
  sendObjectTo?: string | undefined;
  /** Whether the blob can be deleted. Default: false. */
  deletable?: boolean | undefined;
  /** Request timeout in seconds. Default: 30. */
  timeoutSec?: number | undefined;
  /** Upload content type. Default: "application/octet-stream". */
  contentType?: string | undefined;
  /** Max upload size in bytes. 0 = no limit. */
  maxUploadSizeBytes?: number | undefined;
}

/** Walrus upload response (shared by bytes/file/files endpoints). */
export interface WalrusUploadResult {
  /** Created or reused blob ID. */
  blobId: string;
  /** Aggregator URL for blob retrieval. */
  blobUrl: string;
  /** Publisher URL that was called. */
  storeUrl: string;
  /** Raw Walrus store response (variant object). */
  storeResponse?: WalrusStoreResponse | undefined;
}

/** Walrus Publisher raw response variants. */
export interface WalrusStoreResponse {
  /** Newly created blob. */
  newlyCreated?: {
    blobObject: {
      id: string;
      blobId: string;
      registeredEpoch: number;
      certifiedEpoch?: number | undefined;
      size?: number | undefined;
      deletable?: boolean | undefined;
      storage?: {
        id: string;
        startEpoch: number;
        endEpoch: number;
      } | undefined;
    };
    cost: number;
  } | undefined;
  /** Already certified (reused) blob. */
  alreadyCertified?: {
    blobId: string;
    object: string;
  } | undefined;
  /** Marked invalid blob. */
  markedInvalid?: {
    blobId: string;
  } | undefined;
  /** Publisher processing failure. */
  error?: {
    failurePhase: string;
    errorMsg: string;
  } | undefined;
}

// ---------------------------------------------------------------------------
// Walrus Query
// ---------------------------------------------------------------------------

/** Response from `POST /sui/walrus/blob/exists`. */
export interface BlobExistsResult {
  /** Whether the blob exists. */
  exists: boolean;
  /** Normalized blob URL. */
  blobUrl: string;
}

/** Response from `POST /sui/walrus/blob/expiry`. */
export interface BlobExpiryResult {
  /** Blob object ID on SUI. */
  blobObjectId: string;
  /** Blob ID. */
  blobId: string;
  /** SUI Move object type. */
  moveObjectType?: string | undefined;
  /** Epoch when blob was registered. */
  registeredEpoch: number;
  /** Epoch when blob was certified (null if not yet). */
  certifiedEpoch?: number | undefined;
  /** Storage object ID. */
  storageObjectId?: string | undefined;
  /** Storage start epoch. */
  startEpoch: number;
  /** Storage end epoch. */
  endEpoch: number;
  /** Whether the blob is deletable. */
  deletable: boolean;
}

// ---------------------------------------------------------------------------
// Audit meta (safe — attached to audit results)
// ---------------------------------------------------------------------------

/** SUI/Inno metadata attached to the audit result. */
export interface InnoAuditMeta {
  /** Wallet used for the session. */
  wallet?: {
    address: string;
    bech32: string;
  } | undefined;
  /** suiscan.xyz account URL for the wallet. */
  walletExplorerUrl?: string | undefined;
  /** Walrus submission details. */
  submission?: {
    blobId: string;
    blobUrl: string;
    /** SUI blob object ID (from store_response.newlyCreated.blobObject.id). */
    blobObjectId?: string | undefined;
  } | undefined;
}
