// Shared constants, PDA helpers and display math for the Abyss Bridge
// frontend. Everything here mirrors the on-chain program
// (programs/abyss-bridge/src) and the MagicBlock SDK 0.18 constants
// verified against the Rust crates in Batch 2.
import { PublicKey } from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";

export const L1_RPC =
  process.env.NEXT_PUBLIC_L1_RPC || "https://api.devnet.solana.com";
export const ER_RPC =
  process.env.NEXT_PUBLIC_ER_RPC || "https://devnet-as.magicblock.app";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    "Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX"
);

export const MOCK_USDC_MINT = process.env.NEXT_PUBLIC_MOCK_USDC_MINT
  ? new PublicKey(process.env.NEXT_PUBLIC_MOCK_USDC_MINT)
  : null;

// Delegation target for the player account: the Asia devnet
// validator (MAS1…), which hosts all game accounts — a delegated
// account is writable ONLY on its own validator, and the VRF
// oracle fulfills requests sent to that validator's endpoint
// (devnet-as). Proven live 2026-11-25 (see BATCH3-REPORT.md
// addenda 3-4). NEXT_PUBLIC_ER_VALIDATOR overrides.
export const ER_VALIDATOR: PublicKey | null = process.env
  .NEXT_PUBLIC_ER_VALIDATOR
  ? new PublicKey(process.env.NEXT_PUBLIC_ER_VALIDATOR)
  : new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");

// MagicBlock protocol constants: the program ids come from the
// official TS SDK (values verified identical to the Rust crates);
// the VRF ids are pinned from ephemeral-vrf-sdk 0.18 sources (the TS
// ER SDK does not export them).
export const DELEGATION_PROGRAM = DELEGATION_PROGRAM_ID;
export const MAGIC_PROGRAM = MAGIC_PROGRAM_ID;
export const MAGIC_CONTEXT = MAGIC_CONTEXT_ID;
export const VRF_PROGRAM = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);
export const VRF_EPHEMERAL_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
);
export const SLOT_HASHES_SYSVAR = new PublicKey(
  "SysvarS1otHashes111111111111111111111111111"
);

export const ENTRY_FEE = 1_000_000; // 1 Mock USDC, 6 decimals
export const USDC_DECIMALS = 6;
export const RUSH_DIFF = 3;

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export const vaultCfgPda = () => pda([Buffer.from("vault_cfg")]);
export const economyPda = () => pda([Buffer.from("economy")]);
export const bridgePubPda = (diff: number) =>
  pda([Buffer.from("bridge_pub"), Buffer.from([diff])]);
export const bridgeSecPda = (diff: number) =>
  pda([Buffer.from("bridge_sec"), Buffer.from([diff])]);
export const playerPda = (owner: PublicKey) =>
  pda([Buffer.from("player"), owner.toBuffer()]);
export const programIdentityPda = () => pda([Buffer.from("identity")]);

// Delegation-program PDAs (seeds verified against
// magicblock-delegation-program-api 3.1.0 src/pda.rs).
export const delegationBufferPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), account.toBuffer()],
    PROGRAM_ID
  )[0];
export const delegationRecordPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), account.toBuffer()],
    DELEGATION_PROGRAM
  )[0];
export const delegationMetadataPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), account.toBuffer()],
    DELEGATION_PROGRAM
  )[0];

export interface DifficultyMeta {
  diff: number;
  name: string;
  cols: number;
  rows: number;
  maxMultiplier: string;
}

export const DIFFICULTIES: DifficultyMeta[] = [
  { diff: 0, name: "Easy", cols: 2, rows: 6, maxMultiplier: "41.95x" },
  { diff: 1, name: "Normal", cols: 2, rows: 8, maxMultiplier: "166.75x" },
  { diff: 2, name: "Hard", cols: 3, rows: 6, maxMultiplier: "474.20x" },
  { diff: 3, name: "Resurrection Rush", cols: 2, rows: 6, maxMultiplier: "POOL" },
];

// Exact mirror of math.rs calc_multiplier_bps: 1 + 0.65 * (c^k - 1).
export function multiplierBps(cols: number, blindSteps: number): number {
  if (blindSteps <= 0) return 10_000;
  return 10_000 + 65 * (Math.pow(cols, blindSteps) - 1) * 100;
}

export function formatMultiplier(cols: number, blindSteps: number): string {
  return `${(multiplierBps(cols, blindSteps) / 10_000).toFixed(2)}x`;
}

// Exact mirror of math.rs calc_capped_payout.
export function cappedPayout(
  entryFee: number,
  cols: number,
  blindSteps: number,
  houseReserve: number
): number {
  const raw = Math.floor((entryFee * multiplierBps(cols, blindSteps)) / 10_000);
  const cap = Math.floor(houseReserve / 4);
  return Math.min(raw, cap);
}

export function fmtUsdc(micro: number | bigint): string {
  const n = typeof micro === "bigint" ? Number(micro) : micro;
  return (n / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function shortAddr(pk: PublicKey | string): string {
  const s = typeof pk === "string" ? pk : pk.toBase58();
  return `${s.slice(0, 4)}..${s.slice(-4)}`;
}

// Deterministic neon color from a pubkey (avatar tint).
export function colorFromPubkey(pk: PublicKey | string): string {
  const s = typeof pk === "string" ? pk : pk.toBase58();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 90% 62%)`;
}
