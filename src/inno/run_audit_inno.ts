/**
 * InnoAuditSession — Session-based orchestrator for Inno Platform integration.
 *
 * Lifecycle:
 *  1. start()  → Create SUI wallet (once per session)
 *  2. audit()  → Run individual audits, results accumulate
 *  3. finish() → Upload all accumulated evidence to Walrus,
 *                optionally verify blob existence, return session result
 */

import { Buffer } from "node:buffer";
import type { AuditRequest } from "../normalizer/types.js";
import { runAudit, type AuditRunOptions, type AuditResult } from "../core/run_audit.js";

import type {
  InnoConnectConfig,
  CreateWalletOptions,
  WalletAddress,
  WalrusUploadResult,
  InnoAuditMeta,
  UploadBytesOptions,
} from "./types.js";
import { InnoConnect, InnoConnectError } from "./inno_connect.js";
import {
  getSuiExplorerAccountUrl,
  openSuiExplorerAccount,
  getWalrusBlobUrl,
  type SuiNetwork,
} from "./explorer.js";

// ---------------------------------------------------------------------------
// Session config
// ---------------------------------------------------------------------------

export interface InnoAuditSessionConfig {
  /** Inno Platform connection config. */
  inno: InnoConnectConfig;

  /** Default scanner chain & audit options used for each audit() call. */
  auditDefaults: AuditRunOptions;

  /** Called once when the wallet is created during start(). */
  onWalletCreated?: ((wallet: WalletAddress) => void) | undefined;

  /** Open suiscan.xyz account page when wallet is created. Default: false. */
  openExplorerOnWalletCreated?: boolean | undefined;

  /** SUI network for explorer URLs. Default: "testnet". */
  network?: SuiNetwork | undefined;

  /** Options passed to createWallet() during start(). */
  walletOptions?: CreateWalletOptions | undefined;

  /** Walrus upload options applied to all evidence submissions. */
  uploadDefaults?: UploadBytesOptions | undefined;

  /**
   * If true (default), Inno API errors are caught and logged as warnings.
   * If false, errors propagate and the caller must handle them.
   */
  continueOnInnoError?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Session result (returned by finish())
// ---------------------------------------------------------------------------

export interface InnoSessionResult {
  /** All audit results collected during the session. */
  auditResults: AuditResult[];

  /** Inno/SUI metadata (wallet, submissions). */
  inno?: InnoAuditMeta | undefined;

  /** Per-evidence upload results (parallel to auditResults). */
  uploads?: WalrusUploadResult[] | undefined;
}

// ---------------------------------------------------------------------------
// Session class
// ---------------------------------------------------------------------------

type SessionState = "idle" | "started" | "finished";

export class InnoAuditSession {
  private readonly connect: InnoConnect;
  private readonly config: InnoAuditSessionConfig;
  private readonly network: SuiNetwork;
  private readonly continueOnError: boolean;

  private state: SessionState = "idle";
  private wallet: WalletAddress | undefined;
  private results: AuditResult[] = [];

  constructor(config: InnoAuditSessionConfig) {
    this.config = config;
    this.connect = new InnoConnect(config.inno);
    this.network = config.network ?? "testnet";
    this.continueOnError = config.continueOnInnoError ?? true;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the audit session.
   * Creates a SUI wallet via Inno Platform.
   */
  async start(): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`InnoAuditSession: cannot start() in state "${this.state}"`);
    }

    try {
      this.wallet = await this.connect.createWallet(this.config.walletOptions);
      if (this.config.onWalletCreated) {
        this.config.onWalletCreated(this.wallet);
      }
      if (this.config.openExplorerOnWalletCreated && this.wallet) {
        try {
          await openSuiExplorerAccount(this.wallet.address, this.network);
        } catch {
          // Best-effort
        }
      }
    } catch (err) {
      if (!this.continueOnError) throw err;
      const detail = err instanceof InnoConnectError
        ? `${err.message}${err.code !== undefined ? ` (code=${err.code})` : ""}`
        : String(err);
      console.warn(`[InnoConnect] Wallet creation failed: ${detail}`);
    }

    this.state = "started";
  }

  /**
   * Run a single audit within the session.
   * Results are accumulated for the final submission.
   */
  async audit(
    req: AuditRequest,
    overrides?: Partial<AuditRunOptions>,
  ): Promise<AuditResult> {
    if (this.state !== "started") {
      throw new Error(`InnoAuditSession: cannot audit() in state "${this.state}". Call start() first.`);
    }

    const opts: AuditRunOptions = { ...this.config.auditDefaults, ...overrides };
    const result = await runAudit(req, opts);
    this.results.push(result);
    return result;
  }

  /**
   * Finish the session: upload accumulated evidence to Walrus.
   *
   * @param opts.batch  If true (default), bundle all evidence into a single
   *                    upload.  If false, upload each evidence individually.
   * @param opts.uploadContent  Custom content to upload instead of the default
   *                            JSON evidence bundle (e.g. an HTML report).
   */
  async finish(opts?: {
    openExplorer?: boolean;
    verifyBlobs?: boolean;
    /** Bundle all evidence into one Walrus blob (default: true). */
    batch?: boolean;
    /** Upload custom content instead of the evidence JSON bundle. */
    uploadContent?: { data: string; contentType: string };
  }): Promise<InnoSessionResult> {
    if (this.state !== "started") {
      throw new Error(`InnoAuditSession: cannot finish() in state "${this.state}".`);
    }

    this.state = "finished";

    const innoMeta: InnoAuditMeta = {};
    const uploads: WalrusUploadResult[] = [];

    if (this.wallet) {
      innoMeta.wallet = {
        address: this.wallet.address,
        bech32: this.wallet.bech32,
      };
      innoMeta.walletExplorerUrl = getSuiExplorerAccountUrl(this.wallet.address, this.network);
    }

    if (this.results.length > 0 || opts?.uploadContent) {
      const uploadOpts: UploadBytesOptions = {
        ...this.config.uploadDefaults,
        ...(this.wallet ? { sendObjectTo: this.wallet.address } : {}),
      };

      if (opts?.uploadContent) {
        // Custom content (e.g. HTML report)
        try {
          const base64 = Buffer.from(opts.uploadContent.data, "utf-8").toString("base64");
          const upload = await this.connect.uploadBytes(base64, {
            contentType: opts.uploadContent.contentType,
            ...uploadOpts,
          });
          uploads.push(upload);
        } catch (err) {
          if (!this.continueOnError) throw err;
          console.warn(
            "[InnoConnect] Custom content upload failed:",
            err instanceof InnoConnectError ? err.message : err,
          );
        }
      } else if (opts?.batch !== false) {
        // Default: single upload with all evidence bundled as JSON
        try {
          const bundle = this.results.map((r) => r.evidence);
          const json = JSON.stringify(bundle);
          const base64 = Buffer.from(json, "utf-8").toString("base64");
          const upload = await this.connect.uploadBytes(base64, {
            contentType: "application/json",
            ...uploadOpts,
          });
          uploads.push(upload);
        } catch (err) {
          if (!this.continueOnError) throw err;
          console.warn(
            "[InnoConnect] Batch evidence upload failed:",
            err instanceof InnoConnectError ? err.message : err,
          );
        }
      } else {
        // Individual uploads (one per audit result)
        for (const result of this.results) {
          try {
            const upload = await this.connect.submitEvidence(
              result.evidence,
              uploadOpts,
            );
            uploads.push(upload);
          } catch (err) {
            if (!this.continueOnError) throw err;
            console.warn(
              "[InnoConnect] Evidence upload failed:",
              err instanceof InnoConnectError ? err.message : err,
            );
          }
        }
      }

      // Optionally verify blob existence
      if (opts?.verifyBlobs) {
        for (const upload of uploads) {
          try {
            await this.connect.blobExists(upload.blobId);
          } catch {
            // Verification is best-effort
          }
        }
      }

      // Attach first successful upload to meta
      if (uploads.length > 0) {
        const first = uploads[0]!;
        const blobObjectId = first.storeResponse?.newlyCreated?.blobObject.id
          ?? first.storeResponse?.alreadyCertified?.object;

        innoMeta.submission = {
          blobId: first.blobId,
          blobUrl: first.blobUrl,
          blobObjectId,
        };
      }

      if (opts?.openExplorer && uploads.length > 0) {
        const blobUrl = getWalrusBlobUrl(
          uploads[0]!.blobId,
          this.config.inno.aggregatorUrl,
        );
        try {
          const { openInBrowser } = await import("./explorer.js");
          await openInBrowser(blobUrl);
        } catch {
          // Best-effort
        }
      }
    }

    const hasInnoData = innoMeta.wallet !== undefined || innoMeta.submission !== undefined;

    return {
      auditResults: this.results,
      inno: hasInnoData ? innoMeta : undefined,
      uploads: uploads.length > 0 ? uploads : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Current session state. */
  get sessionState(): SessionState { return this.state; }

  /** Wallet info. Undefined until start() succeeds. */
  get walletInfo(): WalletAddress | undefined {
    return this.wallet;
  }

  /** Number of audits completed so far. */
  get auditCount(): number { return this.results.length; }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a new Inno audit session. */
export function createInnoAuditSession(
  config: InnoAuditSessionConfig,
): InnoAuditSession {
  return new InnoAuditSession(config);
}
