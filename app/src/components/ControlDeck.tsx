"use client";

// Bottom control deck: enter / step / cash-out (or REFUND on a stale
// round), deposit & withdraw, the devnet faucet, and the live
// activity ticker.
import { useState } from "react";
import {
  ENTRY_FEE,
  RUSH_DIFF,
  cappedPayout,
  fmtUsdc,
  formatMultiplier,
} from "@/lib/constants";
import type {
  BridgePublicState,
  GlobalEconomyState,
  PlayerState,
  TickerEvent,
} from "@/lib/types";

export default function ControlDeck({
  diff,
  bridge,
  economy,
  player,
  playerDelegated,
  busy,
  mintConfigured,
  walletConnected,
  events,
  onEnter,
  onStep,
  onCashOut,
  onDeposit,
  onWithdraw,
  onFaucet,
}: {
  diff: number;
  bridge: BridgePublicState | null;
  economy: GlobalEconomyState | null;
  player: PlayerState | null;
  playerDelegated: boolean;
  busy: string | null;
  mintConfigured: boolean;
  walletConnected: boolean;
  events: TickerEvent[];
  onEnter: () => void;
  onStep: (col: number) => void;
  onCashOut: () => void;
  onDeposit: (amountMicro: number) => void;
  onWithdraw: () => void;
  onFaucet: () => void;
}) {
  const [depositUsdc, setDepositUsdc] = useState("10");
  const onBridge = !!player?.isOnBridge && player.activeDiff === diff;
  const stale =
    onBridge && !!bridge && player!.entryRoundId !== bridge.roundId;
  const cols = bridge?.cols ?? 2;
  const blind = onBridge ? player!.blindSteps : 0;
  const payout =
    onBridge && economy
      ? stale && blind === 0
        ? ENTRY_FEE
        : cappedPayout(
            ENTRY_FEE,
            cols,
            blind,
            economy.houseReserveBal.toNumber()
          )
      : 0;
  const isRush = diff === RUSH_DIFF;
  const enterDisabled =
    !walletConnected ||
    busy !== null ||
    onBridge ||
    !player ||
    player.balance.toNumber() < ENTRY_FEE ||
    (isRush && (!economy?.rushActive || player.fallenPasses < 1));

  return (
    <div className="flex flex-wrap items-start gap-4 border-t border-abyss-edge bg-abyss-panel/80 px-4 py-3">
      <div className="flex flex-col gap-2">
        {!onBridge ? (
          <button
            onClick={onEnter}
            disabled={enterDisabled}
            className={`rounded-xl px-6 py-3 font-mono text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              isRush
                ? "bg-rose-600 text-white hover:bg-rose-500"
                : "bg-abyss-neon text-black hover:bg-cyan-300"
            }`}
          >
            {busy === "enter"
              ? "ENTERING…"
              : isRush
                ? "ENTER RUSH (1 PASS 🎟)"
                : "ENTER BRIDGE (1 USDC)"}
          </button>
        ) : (
          <>
            <div className="flex gap-2">
              {Array.from({ length: cols }, (_, c) => (
                <button
                  key={c}
                  onClick={() => onStep(c)}
                  disabled={busy !== null || !!bridge?.vrfPending}
                  className="h-12 w-12 rounded-xl border border-abyss-neon/60 bg-abyss-neon/10 font-mono text-lg font-bold text-abyss-neon transition hover:bg-abyss-neon/25 disabled:opacity-40"
                  title={`Jump to column ${c + 1} (key ${c + 1})`}
                >
                  {c + 1}
                </button>
              ))}
              {isRush ? (
                <div
                  className="flex items-center rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 font-mono text-[11px] leading-tight text-rose-200"
                  title="Rush runs settle from the prize pool after Finalize — there is no mid-run cash out on this bridge"
                >
                  NO CASH OUT IN RUSH — finish or fall;
                  <br />
                  the pool pays after Finalize
                </div>
              ) : (
                <button
                  onClick={onCashOut}
                  disabled={busy !== null || (blind < 1 && !stale)}
                  className="rounded-xl bg-emerald-500 px-5 font-mono text-base font-bold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "cashout"
                    ? "…"
                    : stale && blind === 0
                      ? "REFUND ($1.00)"
                      : `CASH OUT ($${fmtUsdc(payout)})`}
                </button>
              )}
            </div>
            <div className="font-mono text-[10px] text-slate-400">
              Row {player!.currentRow + 1} · Blind steps: {blind} · Current:{" "}
              {formatMultiplier(cols, blind)}
              {stale && (
                <span className="text-amber-300">
                  {" "}
                  · bridge reset — stepping is blocked, exit is safe
                </span>
              )}
            </div>
          </>
        )}
        {!walletConnected && (
          <div className="font-mono text-[10px] text-slate-500">
            Connect a wallet to play.
          </div>
        )}
        {walletConnected && !player && (
          <div className="font-mono text-[10px] text-slate-500">
            Deposit once to create your PlayerState + session key.
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            value={depositUsdc}
            onChange={(e) => setDepositUsdc(e.target.value)}
            className="w-20 rounded-lg border border-abyss-edge bg-abyss-bg px-2 py-2 font-mono text-sm text-slate-100"
            inputMode="decimal"
            aria-label="Deposit amount (USDC)"
          />
          <button
            onClick={() =>
              onDeposit(Math.round(parseFloat(depositUsdc || "0") * 1_000_000))
            }
            disabled={!walletConnected || busy !== null || !mintConfigured || playerDelegated}
            className="rounded-lg bg-cyan-600 px-3 py-2 font-mono text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-40"
            title={
              playerDelegated
                ? "Your account is in the rollup — Withdraw to return to L1 before topping up"
                : mintConfigured
                  ? "deposit + delegate_player in ONE L1 transaction"
                  : "Mock USDC mint not configured yet (Batch 3)"
            }
          >
            {busy === "deposit" ? "…" : "Deposit + Delegate"}
          </button>
          <button
            onClick={onWithdraw}
            disabled={!walletConnected || busy !== null || !player}
            title="Commit + undelegate back to L1, then withdraw. With a 0 balance it simply brings your account home so you can deposit again."
            className="rounded-lg border border-abyss-edge px-3 py-2 font-mono text-sm text-slate-300 transition hover:border-slate-400 disabled:opacity-40"
          >
            {busy === "withdraw" ? "…" : "Withdraw (owner)"}
          </button>
          <button
            onClick={onFaucet}
            disabled={!walletConnected || busy !== null}
            className="rounded-lg border border-amber-500/50 px-3 py-2 font-mono text-sm text-amber-300 transition hover:border-amber-400 disabled:opacity-40"
          >
            {busy === "faucet" ? "…" : "Get 10 Mock USDC"}
          </button>
        </div>
        {!mintConfigured && (
          <div className="max-w-md font-mono text-[10px] text-amber-400/90">
            Devnet mint not set yet — deposit/withdraw/faucet activate in
            Batch 3 once NEXT_PUBLIC_MOCK_USDC_MINT + faucet env exist.
          </div>
        )}
        {playerDelegated && (
          <div className="max-w-md font-mono text-[10px] text-cyan-300/90">
            Your account is in the rollup — Deposit is disabled. Withdraw
            to return to L1 before topping up.
          </div>
        )}
      </div>

      <div className="min-w-56 flex-1">
        <div className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
          Live activity
        </div>
        <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
          {events.slice(0, 5).map((e) => (
            <li
              key={e.id}
              className={
                e.tone === "fall"
                  ? "text-rose-300"
                  : e.tone === "win"
                    ? "text-emerald-300"
                    : e.tone === "rush"
                      ? "text-amber-300"
                      : e.tone === "sim"
                        ? "text-slate-500"
                        : "text-slate-400"
              }
            >
              {e.text}
            </li>
          ))}
          {events.length === 0 && (
            <li className="text-slate-600">— waiting for runners —</li>
          )}
        </ul>
      </div>
    </div>
  );
}
