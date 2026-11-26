"use client";

// Top HUD: house reserve, the big animated Global Event Vault
// progress bar with the transparent 70/25/5 split, the player's
// arcade balance and Fallen Pass badge.
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { fmtUsdc } from "@/lib/constants";
import type { GlobalEconomyState, PlayerState } from "@/lib/types";

export default function TopHud({
  economy,
  player,
  sessionReady,
}: {
  economy: GlobalEconomyState | null;
  player: PlayerState | null;
  sessionReady: boolean;
}) {
  const reserve = economy ? economy.houseReserveBal.toNumber() : 0;
  const eventBal = economy ? economy.eventVaultBal.toNumber() : 0;
  const target = economy ? economy.eventTarget.toNumber() : 1_000_000;
  const pct = Math.min(100, (eventBal / Math.max(1, target)) * 100);
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-abyss-edge bg-abyss-panel/80 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xl">🌉</span>
        <div className="leading-tight">
          <div className="font-mono text-sm font-bold tracking-widest text-abyss-neon">
            ABYSS BRIDGE
          </div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
            Entertainment Finance · MagicBlock ER + PER
          </div>
        </div>
      </div>

      <div className="min-w-40">
        <div className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
          House Reserve
        </div>
        <div className="font-mono text-lg font-bold text-slate-100">
          ${fmtUsdc(reserve)}
        </div>
      </div>

      <div className="min-w-56 flex-1">
        <div className="flex items-baseline justify-between font-mono text-[10px]">
          <span className="uppercase tracking-wider text-amber-300">
            Global Event Vault
          </span>
          <span className="text-slate-400">
            {fmtUsdc(eventBal)} / {fmtUsdc(target)} USDC → Resurrection Rush!
          </span>
        </div>
        <div className="mt-1 h-3 overflow-hidden rounded-full border border-amber-500/30 bg-slate-800">
          <div
            className="event-bar h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-400 to-rose-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-slate-500">
          Every fall splits the pot: 70% Reserve · 25% Event · 5% Treasury
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
            Arcade Balance
          </div>
          <div className="font-mono text-lg font-bold text-abyss-mint">
            ${player ? fmtUsdc(player.balance.toNumber()) : "0.00"}
          </div>
        </div>
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-center">
          <div className="font-mono text-[9px] uppercase tracking-wider text-rose-300">
            Fallen Passes
          </div>
          <div className="font-mono text-base font-bold text-rose-200">
            🎟 {player ? player.fallenPasses : 0}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <WalletMultiButton />
          <span className="font-mono text-[9px] text-slate-500">
            {sessionReady ? "session key: live (zero-popup)" : "session key: …"}
          </span>
        </div>
      </div>
    </header>
  );
}
