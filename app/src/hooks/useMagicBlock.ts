"use client";

// Dual-connection MagicBlock integration (Batch 2 prompt §B.1):
//  - L1 (devnet) handles deposit + delegate (ONE wallet popup, both
//    instructions in a single atomic transaction) and owner-only
//    withdraws.
//  - The Ephemeral Rollup handles all gameplay, signed by a native
//    session key (an ephemeral Keypair kept in localStorage and
//    registered on PlayerState by `deposit`) — zero wallet popups.
//  - The frontend NEVER fetches or subscribes to BridgeSecret (PER
//    will lock it in Batch 3). It reads BridgePublic, GlobalEconomy
//    and PlayerState only. BridgeSecret PDAs appear solely as
//    instruction account addresses, never as read targets.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  useAnchorWallet,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idlJson from "@/idl/abyss_bridge.json";
import {
  DELEGATION_PROGRAM,
  ER_RPC,
  ER_VALIDATOR,
  L1_RPC,
  MAGIC_CONTEXT,
  MAGIC_PROGRAM,
  MOCK_USDC_MINT,
  PROGRAM_ID,
  RUSH_DIFF,
  SLOT_HASHES_SYSVAR,
  VRF_EPHEMERAL_QUEUE,
  VRF_PROGRAM,
  bridgePubPda,
  bridgeSecPda,
  delegationBufferPda,
  delegationMetadataPda,
  delegationRecordPda,
  economyPda,
  fmtUsdc,
  playerPda,
  programIdentityPda,
  vaultCfgPda,
} from "@/lib/constants";
import type { PlayerState } from "@/lib/types";

const idl = idlJson as anchor.Idl;
const SESSION_TTL_SECONDS = 12 * 3600;

// --- Per-wallet session keys (Batch 3 polish) -----------------------
// Storage is scoped by wallet address (abyss_session_<pubkey>) so
// switching wallets in the same browser never mixes signers. The
// stored expiry mirrors the on-chain PlayerState.session_expiry set
// by the last deposit; gameplay actions refuse to fire once it has
// passed (the on-chain check would reject them anyway).
interface StoredSession {
  secret: string; // base64
  expiry: number; // unix seconds, 0 = not registered yet
}

function storageKeyFor(wallet: PublicKey): string {
  return `abyss_session_${wallet.toBase58()}`;
}

function persistSession(wallet: PublicKey, kp: Keypair, expiry: number) {
  try {
    const data: StoredSession = {
      secret: btoa(String.fromCharCode(...kp.secretKey)),
      expiry,
    };
    window.localStorage.setItem(storageKeyFor(wallet), JSON.stringify(data));
  } catch {
    /* storage unavailable; session lives in memory only */
  }
}

function loadOrCreateSession(wallet: PublicKey): {
  kp: Keypair;
  expiry: number;
} {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(wallet));
    if (raw) {
      const parsed = JSON.parse(raw) as StoredSession;
      const secret = Uint8Array.from(
        atob(parsed.secret)
          .split("")
          .map((c) => c.charCodeAt(0))
      );
      return { kp: Keypair.fromSecretKey(secret), expiry: parsed.expiry ?? 0 };
    }
  } catch {
    /* fall through and regenerate */
  }
  const kp = Keypair.generate();
  persistSession(wallet, kp, 0);
  return { kp, expiry: 0 };
}

function sessionWallet(kp: Keypair): anchor.Wallet {
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
      tx: T
    ): Promise<T> => {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else tx.partialSign(kp);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      txs: T[]
    ): Promise<T[]> => {
      for (const tx of txs) {
        if (tx instanceof VersionedTransaction) tx.sign([kp]);
        else tx.partialSign(kp);
      }
      return txs;
    },
  } as anchor.Wallet;
}

export function useMagicBlock() {
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [sessionKeypair, setSessionKeypair] = useState<Keypair | null>(null);
  const [sessionExpiry, setSessionExpiry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // (Re)load the session key whenever the connected wallet changes.
  useEffect(() => {
    if (!publicKey) {
      setSessionKeypair(null);
      setSessionExpiry(0);
      return;
    }
    const { kp, expiry } = loadOrCreateSession(publicKey);
    setSessionKeypair(kp);
    setSessionExpiry(expiry);
  }, [publicKey]);

  const sessionExpired =
    sessionExpiry > 0 && Math.floor(Date.now() / 1000) > sessionExpiry;

  const assertSessionLive = useCallback(() => {
    if (sessionExpired) {
      throw new Error(
        "Session key expired — deposit again (any amount) to re-register a fresh session key on your PlayerState"
      );
    }
  }, [sessionExpired]);

  const l1Connection = useMemo(
    () => new Connection(L1_RPC, "confirmed"),
    []
  );
  const erConnection = useMemo(
    () => new Connection(ER_RPC, "confirmed"),
    []
  );

  const l1Program = useMemo(() => {
    if (!anchorWallet) return null;
    const provider = new AnchorProvider(l1Connection, anchorWallet, {
      commitment: "confirmed",
    });
    return new Program(idl, provider);
  }, [anchorWallet, l1Connection]);

  const erProgram = useMemo(() => {
    if (!sessionKeypair) return null;
    const provider = new AnchorProvider(
      erConnection,
      sessionWallet(sessionKeypair),
      { commitment: "confirmed" }
    );
    return new Program(idl, provider);
  }, [sessionKeypair, erConnection]);

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      setBusy(label);
      setLastError(null);
      try {
        return await fn();
      } catch (e: any) {
        setLastError(e?.message ? String(e.message) : String(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  /** Gameplay actions additionally refuse to fire on an expired
   *  session key (Batch 3 expiry check). */
  const runGameplay = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        assertSessionLive();
      } catch (e: any) {
        setLastError(e?.message ? String(e.message) : String(e));
        return null;
      }
      return run(label, fn);
    },
    [run, assertSessionLive]
  );

  /** Deposit + delegate_player in ONE L1 transaction (1 wallet popup),
   *  registering the native session key on PlayerState. */
  const depositAndDelegate = useCallback(
    (amountMicro: number) =>
      run("deposit", async () => {
        if (!l1Program || !publicKey || !sessionKeypair)
          throw new Error("Wallet or session key not ready");
        if (!MOCK_USDC_MINT)
          throw new Error(
            "NEXT_PUBLIC_MOCK_USDC_MINT is not set — the devnet mint lands in Batch 3"
          );
        const owner = publicKey;
        const player = playerPda(owner);
        const userAta = getAssociatedTokenAddressSync(MOCK_USDC_MINT, owner);
        const vaultAta = getAssociatedTokenAddressSync(
          MOCK_USDC_MINT,
          vaultCfgPda(),
          true
        );
        // Judge-proofing guard: validate balances BEFORE the wallet
        // popup. A shortfall otherwise surfaces inside Phantom as a
        // cryptic simulation failure ("Account is immutable", "Not
        // enough SOL") that reads like an app bug, when the real
        // cause is simply a balance below the requested amount.
        // Measured on-chain cost of a first deposit+delegate is
        // ~0.0044 SOL (fees + PDA rent); the 0.01 SOL floor keeps
        // >2x margin and also covers re-delegation rent.
        if (!Number.isFinite(amountMicro) || amountMicro <= 0)
          throw new Error("Enter a deposit amount above 0.");
        const usdcBal = await l1Connection
          .getTokenAccountBalance(userAta)
          .then((r) => Number(r.value.amount))
          .catch(() => 0);
        if (amountMicro > usdcBal)
          throw new Error(
            `Not enough Mock USDC: you are depositing ${fmtUsdc(amountMicro)} but this wallet only holds ${fmtUsdc(usdcBal)}. Click "Get 10 Mock USDC" first, or lower the deposit amount.`
          );
        const solBal = await l1Connection.getBalance(owner);
        if (solBal < 10_000_000)
          throw new Error(
            `Not enough devnet SOL: this wallet holds ${(solBal / 1e9).toFixed(4)} SOL, but deposit + delegate needs about 0.005 SOL for network fees and account rent. Get free devnet SOL at https://faucet.solana.com (network: Devnet), then try again.`
          );
        const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
        const depositIx = await (l1Program.methods as any)
          .deposit(
            new BN(amountMicro),
            sessionKeypair.publicKey,
            new BN(expiry)
          )
          .accounts({
            owner,
            player,
            vaultCfg: vaultCfgPda(),
            usdcMint: MOCK_USDC_MINT,
            userAta,
            vaultAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        const delegateIx = await (l1Program.methods as any)
          // Same-validator rule (Batch 3): PlayerState delegates to
          // the exact validator the economy + bridges use.
          .delegatePlayer(ER_VALIDATOR)
          .accounts({
            payer: owner,
            bufferPlayer: delegationBufferPda(player),
            delegationRecordPlayer: delegationRecordPda(player),
            delegationMetadataPlayer: delegationMetadataPda(player),
            player,
            ownerProgram: PROGRAM_ID,
            delegationProgram: DELEGATION_PROGRAM,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        const tx = new Transaction().add(depositIx, delegateIx);
        const sig = await sendTransaction(tx, l1Connection);
        await l1Connection.confirmTransaction(sig, "confirmed");
        persistSession(owner, sessionKeypair, expiry);
        setSessionExpiry(expiry);
        return sig;
      }),
    [l1Program, publicKey, sessionKeypair, l1Connection, sendTransaction, run]
  );

  const gameplayAccounts = useCallback(
    (player: PublicKey, owner: PublicKey, diff: number) => ({
      player,
      owner,
      signer: sessionKeypair!.publicKey,
      economy: economyPda(),
      bridgePub: bridgePubPda(diff),
      bridgeSec: bridgeSecPda(diff),
    }),
    [sessionKeypair]
  );

  const enterBridge = useCallback(
    (diff: number) =>
      runGameplay("enter", async () => {
        if (!erProgram || !publicKey || !sessionKeypair)
          throw new Error("Session not ready");
        return (erProgram.methods as any)
          .enterBridge(diff)
          .accounts(gameplayAccounts(playerPda(publicKey), publicKey, diff))
          .rpc();
      }),
    [erProgram, publicKey, sessionKeypair, gameplayAccounts, runGameplay]
  );

  const stepTile = useCallback(
    (player: PlayerState, col: number) =>
      runGameplay("step", async () => {
        if (!erProgram || !publicKey || !sessionKeypair)
          throw new Error("Session not ready");
        const diff = player.activeDiff;
        return (erProgram.methods as any)
          .stepTile(col)
          .accounts({
            ...gameplayAccounts(playerPda(publicKey), publicKey, diff),
            // On the Rush bridge these ARE bridgePub/bridgeSec —
            // Anchor rejects duplicate mutable accounts (Batch 1 fix).
            rushBridgeSec: diff < RUSH_DIFF ? bridgeSecPda(RUSH_DIFF) : null,
            rushBridgePub: diff < RUSH_DIFF ? bridgePubPda(RUSH_DIFF) : null,
          })
          .rpc();
      }),
    [erProgram, publicKey, sessionKeypair, gameplayAccounts, runGameplay]
  );

  const cashOut = useCallback(
    (player: PlayerState) =>
      runGameplay("cashout", async () => {
        if (!erProgram || !publicKey || !sessionKeypair)
          throw new Error("Session not ready");
        return (erProgram.methods as any)
          .cashOut()
          .accounts({
            player: playerPda(publicKey),
            owner: publicKey,
            signer: sessionKeypair.publicKey,
            economy: economyPda(),
            bridgePub: bridgePubPda(player.activeDiff),
          })
          .rpc();
      }),
    [erProgram, publicKey, sessionKeypair, runGameplay]
  );

  /** Permissionless: anyone (here the session key) may fire the VRF
   *  request once BridgePublic.vrf_pending is true. */
  const requestVrf = useCallback(
    (diff: number) =>
      runGameplay("vrf", async () => {
        if (!erProgram || !sessionKeypair)
          throw new Error("Session not ready");
        return (erProgram.methods as any)
          .requestBridgeVrf(diff)
          .accounts({
            payer: sessionKeypair.publicKey,
            bridgePub: bridgePubPda(diff),
            bridgeSec: bridgeSecPda(diff),
            oracleQueue: VRF_EPHEMERAL_QUEUE,
            programIdentity: programIdentityPda(),
            vrfProgram: VRF_PROGRAM,
            slotHashes: SLOT_HASHES_SYSVAR,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }),
    [erProgram, sessionKeypair, runGameplay]
  );

  const finalizeRush = useCallback(
    () =>
      runGameplay("finalize", async () => {
        if (!erProgram || !sessionKeypair)
          throw new Error("Session not ready");
        return (erProgram.methods as any)
          .finalizeRush()
          .accounts({
            signer: sessionKeypair.publicKey,
            economy: economyPda(),
            rushBridgePub: bridgePubPda(RUSH_DIFF),
          })
          .rpc();
      }),
    [erProgram, sessionKeypair, runGameplay]
  );

  const claimRushReward = useCallback(
    () =>
      runGameplay("claim", async () => {
        if (!erProgram || !publicKey || !sessionKeypair)
          throw new Error("Session not ready");
        return (erProgram.methods as any)
          .claimRushReward()
          .accounts({
            player: playerPda(publicKey),
            owner: publicKey,
            signer: sessionKeypair.publicKey,
            economy: economyPda(),
          })
          .rpc();
      }),
    [erProgram, publicKey, sessionKeypair, runGameplay]
  );

  const commitAndUndelegate = useCallback(
    () =>
      runGameplay("undelegate", async () => {
        if (!erProgram || !publicKey || !sessionKeypair)
          throw new Error("Session not ready");
        // Plain session-signed call — this exact shape is
        // simulation-verified against the live AS validator.
        // Do NOT mark `owner` writable here: the Magic commit
        // touches the owner account through its intent outbox,
        // and the ER rejects a writable load of a non-delegated
        // account with InvalidWritableAccount ("loads a writable
        // account that cannot be written").
        return (erProgram.methods as any)
          .commitAndUndelegatePlayer()
          .accounts({
            payer: sessionKeypair.publicKey,
            owner: publicKey,
            player: playerPda(publicKey),
            magicProgram: MAGIC_PROGRAM,
            magicContext: MAGIC_CONTEXT,
          })
          .rpc();
      }),
    [erProgram, publicKey, sessionKeypair, runGameplay]
  );

  /** Poll L1 until the player account is owned by the program
   *  again (undelegation settled) or ~30s pass. */
  const waitForSettlement = useCallback(
    async (owner: PublicKey): Promise<boolean> => {
      const conn = l1Program?.provider.connection;
      if (!conn) return false;
      const pda = playerPda(owner);
      for (let i = 0; i < 15; i++) {
        const info = await conn.getAccountInfo(pda).catch(() => null);
        if (info && info.owner.equals(PROGRAM_ID)) return true;
        await new Promise((r) => setTimeout(r, 2000));
      }
      return false;
    },
    [l1Program]
  );

  /** Owner-only: commit+undelegate in the ER, short settle wait, then
   *  withdraw_l1 signed by the main wallet on L1. */
  const withdraw = useCallback(
    (player: PlayerState) =>
      run("withdraw", async () => {
        if (!l1Program || !publicKey)
          throw new Error("Wallet not ready");
        if (!MOCK_USDC_MINT)
          throw new Error(
            "NEXT_PUBLIC_MOCK_USDC_MINT is not set — the devnet mint lands in Batch 3"
          );
        if (player.isOnBridge)
          throw new Error("Cash out or finish your run before withdrawing");
        const amount = player.balance.toNumber();
        if (amount <= 0) {
          // Zero-balance rescue: deposit is L1-only, so an empty
          // account that is still delegated would be trapped in
          // the ER forever. Withdraw doubles as the way home —
          // undelegate only; there is no token transfer to sign.
          const sig = await commitAndUndelegate();
          if (!sig)
            throw new Error(
              "Undelegation failed — wait a few seconds and press Withdraw again"
            );
          await waitForSettlement(publicKey);
          return sig;
        }
        const commitSig = await commitAndUndelegate();
        if (!commitSig)
          throw new Error(
            "Undelegation failed — wait a few seconds and press Withdraw again"
          );
        // Do not send withdraw_l1 until the account has actually
        // settled back to L1; sending it while the account is
        // still delegated makes Phantom show a scary (and doomed)
        // simulation warning.
        const settled = await waitForSettlement(publicKey);
        if (!settled)
          throw new Error(
            "Undelegation is still settling — wait a few seconds and press Withdraw again"
          );
        const owner = publicKey;
        return (l1Program.methods as any)
          .withdrawL1(new BN(amount))
          .accounts({
            owner,
            player: playerPda(owner),
            vaultCfg: vaultCfgPda(),
            usdcMint: MOCK_USDC_MINT,
            vaultAta: getAssociatedTokenAddressSync(
              MOCK_USDC_MINT,
              vaultCfgPda(),
              true
            ),
            userAta: getAssociatedTokenAddressSync(MOCK_USDC_MINT, owner),
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      }),
    [l1Program, publicKey, commitAndUndelegate, waitForSettlement, run]
  );

  /** Devnet faucet via the Next.js API route (server holds the mint
   *  authority). Surfaces the route's own message when unconfigured. */
  const faucet = useCallback(
    () =>
      run("faucet", async () => {
        if (!publicKey) throw new Error("Connect a wallet first");
        const res = await fetch("/api/faucet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: publicKey.toBase58() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(data?.error || `Faucet failed (${res.status})`);
        return data.signature as string;
      }),
    [publicKey, run]
  );

  return {
    publicKey,
    sessionKeypair,
    l1Connection,
    erConnection,
    l1Program,
    erProgram,
    busy,
    lastError,
    sessionExpiry,
    sessionExpired,
    depositAndDelegate,
    enterBridge,
    stepTile,
    cashOut,
    requestVrf,
    finalizeRush,
    claimRushReward,
    withdraw,
    faucet,
    mintConfigured: !!MOCK_USDC_MINT,
  };
}
