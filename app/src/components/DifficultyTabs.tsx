"use client";

// Difficulty switcher + the glowing Resurrection Rush tab with its
// live countdown, prize pool, and Finalize / Claim actions.
import { useEffect, useState } from "react";
import { DIFFICULTIES, RUSH_DIFF, fmtUsdc } from "@/lib/constants";
import type { GlobalEconomyState, PlayerState } from "@/lib/types";

export default function DifficultyTabs({
  active,
  onSelect,
  economy,
  player,
  busy,
  onFinalize,
  onClaim,
}: {
  active: number;
  onSelect: (diff: number) => void;
  economy: GlobalEconomyState | null;
  player: PlayerState | null;
  busy: string | null;
  onFinalize: () => void;
  onClaim: () => void;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 500);
    return () => clearInterval(id);
  }, []);

  const rushActive = !!economy?.rushActive;
  const rushEnd = economy ? economy.rushEndTs.toNumber() : 0;
  const secsLeft = Math.max(0, rushEnd - now);
  const settled = economy ? economy.settledRushId : 0;
  const canClaim =
    !!player &&
    settled > 0 &&
    player.lastRushId === settled &&
    player.lastRushBestRow >= (economy?.settledWinningRow ?? 99) &&
    player.rushClaimedId !== settled &&
    (economy?.settledPayoutPerWinner.toNumber() ?? 0) > 0;

  return (
    <div className="flex flex-wrap items-stretch gap-2 px-4 pt-2">
      {DIFFICULTIES.slice(0, 3).map((d) => (
        <button
          key={d.diff}
          onClick={() => onSelect(d.diff)}
          className={`rounded-lg border px-4 py-2 font-mono text-sm transition ${
            active === d.diff
              ? "border-abyss-neon bg-abyss-neon/15 text-abyss-neon"
              : "border-abyss-edge bg-abyss-panel text-slate-400 hover:border-slate-500"
          }`}
        >
          {d.name}{" "}
          <span className="text-[10px] opacity-70">
            {d.cols}×{d.rows} · Max {d.maxMultiplier}
          </span>
        </button>
      ))}

      <div
        className={`flex items-center gap-3 rounded-lg border px-4 py-2 font-mono text-sm ${
          rushActive ? "rush-glow border-rose-500 bg-rose-500/15 text-rose-200" : ""
        } ${
          active === RUSH_DIFF
            ? "border-rose-400 bg-rose-500/10 text-rose-200"
            : "border-abyss-edge bg-abyss-panel text-slate-500"
        }`}
      >
        <button onClick={() => onSelect(RUSH_DIFF)} className="text-left">
          🔥 RESURRECTION RUSH{" "}
          <span className="text-[10px] opacity-80">
            {rushActive
              ? `Pool $${fmtUsdc(economy!.rushPrizePool.toNumber())} · ${secsLeft}s`
              : "waiting for the Event Vault…"}
          </span>
        </button>
        {rushActive && secsLeft === 0 && (
          <button
            onClick={onFinalize}
            disabled={busy !== null}
            className="rounded bg-amber-500 px-2 py-1 text-[11px] font-bold text-black disabled:opacity-40"
          >
            {busy === "finalize" ? "…" : "Finalize Rush"}
          </button>
        )}
        {canClaim && (
          <button
            onClick={onClaim}
            disabled={busy !== null}
            className="rounded bg-emerald-500 px-2 py-1 text-[11px] font-bold text-black disabled:opacity-40"
          >
            {busy === "claim"
              ? "…"
              : `Claim $${fmtUsdc(economy!.settledPayoutPerWinner.toNumber())}`}
          </button>
        )}
      </div>
    </div>
  );
}
