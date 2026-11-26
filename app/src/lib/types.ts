// Decoded account shapes (Anchor camelCases the Rust field names).
import type { PublicKey } from "@solana/web3.js";
import type { BN } from "@coral-xyz/anchor";

export interface GlobalEconomyState {
  houseReserveBal: BN;
  eventVaultBal: BN;
  treasuryBal: BN;
  eventTarget: BN;
  rushDurationSecs: BN;
  rushActive: boolean;
  rushRoundId: number;
  rushEndTs: BN;
  rushPrizePool: BN;
  rushHighestRow: number;
  rushHighestCount: number;
  rushFinishersCount: number;
  settledRushId: number;
  settledWinningRow: number;
  settledPayoutPerWinner: BN;
}

export interface RunnerSlot {
  pubkey: PublicKey;
  row: number;
  col: number;
  blindSteps: number;
  active: boolean;
}

export interface BridgePublicState {
  diff: number;
  cols: number;
  rows: number;
  roundId: number;
  /** Batch 2 mirror of BridgeSecret.vrf_pending — the frontend reads
   * ONLY this account for shuffle state (PER-safe). */
  vrfPending: boolean;
  revealedSafeCol: number[];
  brokenMask: number[];
  activeRunners: RunnerSlot[];
}

export interface PlayerState {
  owner: PublicKey;
  balance: BN;
  fallenPasses: number;
  isOnBridge: boolean;
  activeDiff: number;
  entryRoundId: number;
  currentRow: number;
  blindSteps: number;
  lastRushId: number;
  lastRushBestRow: number;
  rushClaimedId: number;
  sessionKey: PublicKey;
  sessionExpiry: BN;
}

export interface TickerEvent {
  id: number;
  text: string;
  tone: "info" | "fall" | "win" | "rush" | "sim";
  ts: number;
}
