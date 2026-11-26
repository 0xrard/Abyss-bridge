// LiteSVM-backed Anchor provider for local tests.
//
// Why: this sandbox blocks UDP entirely (even on loopback), so
// solana-test-validator can never land a transaction here, and Agave
// 3.x's validator additionally panics on its io_uring assertion.
// LiteSVM executes transactions in-process — no sockets at all.
//
// The shim speaks the legacy @solana/web3.js (1.x) dialect that
// @coral-xyz/anchor 0.32 expects, and bridges to LiteSVM's @solana/kit
// API by round-tripping signed transactions through their wire format.
import * as anchor from "@coral-xyz/anchor";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { getTransactionDecoder } from "@solana/kit";
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

const bs58 = anchor.utils.bytes.bs58;

class LiteSvmConnection {
  constructor(private svm: LiteSVM) {}

  async getAccountInfo(pubkey: PublicKey): Promise<any> {
    const acc: any = this.svm.getAccount(pubkey.toBase58() as any);
    if (!acc || acc.exists === false) return null;
    const data =
      acc.data instanceof Uint8Array
        ? Buffer.from(acc.data)
        : Buffer.from(acc.data?.[0] ?? "", "base64");
    return {
      data,
      executable: !!acc.executable,
      lamports: Number(acc.lamports ?? 0),
      owner: new PublicKey(acc.owner ?? acc.programAddress),
      rentEpoch: 0,
    };
  }

  async getAccountInfoAndContext(pubkey: PublicKey): Promise<any> {
    const value = await this.getAccountInfo(pubkey);
    return { context: { slot: 0 }, value };
  }

  async getLatestBlockhash(): Promise<any> {
    return {
      blockhash: this.svm.latestBlockhash(),
      lastValidBlockHeight: Number.MAX_SAFE_INTEGER,
    };
  }

  async getBalance(pubkey: PublicKey): Promise<number> {
    const bal: any = this.svm.getBalance(pubkey.toBase58() as any);
    return bal == null ? 0 : Number(bal);
  }

  async getMinimumBalanceForRentExemption(len: number): Promise<number> {
    return Number(this.svm.minimumBalanceForRentExemption(BigInt(len)));
  }

  async confirmTransaction(): Promise<any> {
    // LiteSVM finalizes synchronously inside sendTransaction.
    return { context: { slot: 0 }, value: { err: null } };
  }

  async sendRawTransaction(raw: Uint8Array): Promise<string> {
    const kitTx = getTransactionDecoder().decode(raw);
    const res: any = this.svm.sendTransaction(kitTx as any);
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(res.err())}\nLogs:\n${res
          .meta()
          .logs()
          .join("\n")}`
      );
    }
    const sigBytes = res.signature();
    return bs58.encode(Buffer.from(sigBytes));
  }

  async requestAirdrop(pubkey: PublicKey, lamports: number): Promise<string> {
    this.svm.airdrop(pubkey.toBase58() as any, BigInt(lamports) as any);
    return "airdrop";
  }
}

export class LiteSvmProvider implements anchor.Provider {
  connection: LiteSvmConnection;
  opts: anchor.Options = {
    preflightCommitment: "confirmed",
    commitment: "confirmed",
  } as anchor.Options;

  constructor(
    public svm: LiteSVM,
    public wallet: anchor.Wallet
  ) {
    this.connection = new LiteSvmConnection(svm);
  }

  async sendAndConfirm(
    tx: Transaction | VersionedTransaction,
    signers: Keypair[] = [],
    _opts?: anchor.Options
  ): Promise<string> {
    // Fresh blockhash per send so repeated identical instructions do
    // not collide as duplicate signatures.
    this.svm.expireBlockhash();
    const blockhash = this.svm.latestBlockhash();

    if (tx instanceof VersionedTransaction) {
      (tx.message as any).recentBlockhash = blockhash;
      const all = dedupeSigners([this.wallet.payer, ...signers]);
      tx.sign(all);
      const wire = tx.serialize();
      return this.connection.sendRawTransaction(wire);
    }

    tx.feePayer = tx.feePayer ?? this.wallet.publicKey;
    tx.recentBlockhash = blockhash;
    const all = dedupeSigners([this.wallet.payer, ...signers]);
    tx.sign(...all);
    const wire = tx.serialize();
    return this.connection.sendRawTransaction(wire);
  }

  // The remaining Provider surface Anchor may touch.
  async sendAll(): Promise<string[]> {
    throw new Error("sendAll not implemented in LiteSvmProvider");
  }
}

function dedupeSigners(signers: Keypair[]): Keypair[] {
  const seen = new Map<string, Keypair>();
  for (const s of signers) seen.set(s.publicKey.toBase58(), s);
  return [...seen.values()];
}
