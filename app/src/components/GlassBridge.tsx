"use client";

// The glass bridge stage. Reads ONLY BridgePublic (+ PlayerState for
// the local runner) — never BridgeSecret (PER rule). Every row carries
// the Strict Untouched Row badge from the Batch 2 prompt:
//   BLIND (+Multiplier)        — row untouched by anyone
//   REVEALED (Safe · +0x)      — safe path or broken glass is public
import { useEffect, useState } from "react";
import RunnerAvatar from "./RunnerAvatar";
import { DIFFICULTIES, RUSH_DIFF, colorFromPubkey, shortAddr } from "@/lib/constants";
import type { BridgePublicState, PlayerState } from "@/lib/types";

export interface StageRunner {
  id: string;
  label: string;
  color: string;
  row: number;
  col: number;
  tag: string;
  aura?: boolean;
  ghost?: boolean;
}

export default function GlassBridge({
  diff,
  bridge,
  player,
  extraRunners,
  simRevealed,
  simBroken,
  shakeNonce,
  onStep,
  canStep,
}: {
  diff: number;
  bridge: BridgePublicState | null;
  player: PlayerState | null;
  extraRunners: StageRunner[];
  simRevealed: Record<number, number>;
  simBroken: Set<string>;
  shakeNonce: number;
  onStep: (col: number) => void;
  canStep: boolean;
}) {
  const meta = DIFFICULTIES[diff];
  const cols = bridge?.cols ?? meta.cols;
  const rows = bridge?.rows ?? meta.rows;
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (shakeNonce === 0) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 450);
    return () => clearTimeout(t);
  }, [shakeNonce]);

  const myRow =
    player && player.isOnBridge && player.activeDiff === diff
      ? player.currentRow
      : -1;

  const runners: StageRunner[] = [...extraRunners];
  let selfSlotted = false;
  if (bridge) {
    for (const r of bridge.activeRunners) {
      if (!r.active) continue;
      const isSelf = !!player && r.pubkey.equals(player.owner);
      if (isSelf) selfSlotted = true;
      runners.push({
        id: r.pubkey.toBase58(),
        label: isSelf ? "YOU" : shortAddr(r.pubkey),
        color: isSelf ? "#22d3ee" : colorFromPubkey(r.pubkey),
        row: r.row,
        col: r.col,
        // PlayerState is fresher than the slot for our own blind count.
        tag: `${isSelf && player ? player.blindSteps : r.blindSteps} blind`,
        aura: isSelf && diff === RUSH_DIFF,
      });
    }
  }
  if (myRow >= 0 && player && !selfSlotted) {
    // Slot not visible yet (state lag): fall back to PlayerState's row.
    runners.push({
      id: "self",
      label: "YOU",
      color: "#22d3ee",
      row: player.currentRow,
      col: 0,
      tag: `${player.blindSteps} blind`,
      aura: diff === RUSH_DIFF,
    });
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {bridge?.vrfPending && (
        <div className="vrf-banner pointer-events-none absolute inset-x-0 top-1 z-30 mx-auto w-fit rounded-full border border-abyss-neon/60 bg-abyss-panel/90 px-4 py-1 text-center font-mono text-xs text-abyss-neon">
          Shuffling new bridge via MagicBlock VRF…
        </div>
      )}
      <div
        className={`relative mx-auto w-full max-w-3xl flex-1 px-10 pb-2 pt-8 ${shaking ? "stage-shake" : ""}`}
        style={{ perspective: "900px" }}
      >
        <div
          className="relative h-full"
          style={{ transform: "rotateX(14deg)", transformStyle: "preserve-3d" }}
        >
          {/* rows rendered top (finish) -> bottom (start) */}
          <div className="flex h-full flex-col-reverse gap-1.5">
            {/* START platform — runners stand here before their
                first step (standing row -1). It is NOT a bridge
                row: the first clickable floor is row 0 above it,
                so the first decision is always a step FORWARD
                onto the bridge, never a sideways click on the
                tile under the avatar. */}
            <div className="relative flex flex-1 items-center justify-center rounded-md border border-slate-400/30 bg-slate-300/[0.08]">
              <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-slate-400">
                Start
              </span>
            </div>
            {Array.from({ length: rows }, (_, r) => {
              const revealed = bridge ? bridge.revealedSafeCol[r] : 255;
              const broken = bridge ? bridge.brokenMask[r] : 0;
              const simSafe = simRevealed[r];
              const untouched =
                revealed === 255 && broken === 0 && simSafe === undefined;
              const isMyRow = r === myRow;
              return (
                <div key={r} className="relative flex flex-1 items-stretch gap-1.5">
                  <div
                    className={`absolute -left-2 top-1/2 z-10 -translate-y-1/2 -translate-x-full whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide ${
                      untouched
                        ? "bg-abyss-neon/15 text-abyss-neon"
                        : "bg-slate-500/15 text-slate-400"
                    }`}
                  >
                    {untouched ? "BLIND (+Multiplier)" : "REVEALED (Safe · +0x)"}
                  </div>
                  {Array.from({ length: cols }, (_, c) => {
                    const isSafe = revealed === c || simSafe === c;
                    const isBroken =
                      (broken & (1 << c)) !== 0 || simBroken.has(`${r}:${c}`);
                    const clickable = canStep && isMyRow && !bridge?.vrfPending;
                    return (
                      <button
                        key={c}
                        disabled={!clickable}
                        onClick={() => onStep(c)}
                        className={`relative flex-1 rounded-md border transition-all duration-300 ${
                          isBroken
                            ? "tile-broken border-rose-900/70"
                            : isSafe
                              ? "border-emerald-400/50 bg-emerald-400/15 shadow-[inset_0_0_18px_rgba(52,211,153,0.25)]"
                              : "border-cyan-200/25 bg-cyan-100/[0.07] shadow-[inset_0_0_14px_rgba(34,211,238,0.12)]"
                        } ${clickable ? "cursor-pointer brightness-125 hover:border-abyss-neon hover:bg-cyan-300/20" : "cursor-default"}`}
                        aria-label={`row ${r + 1} column ${c + 1}`}
                      >
                        {isBroken && (
                          <span className="absolute inset-0 grid place-items-center text-lg opacity-80">
                            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
                              <path
                                d="M4 3 L10 9 L6 12 L12 15 L9 21 M12 4 L14 10 L20 8 M14 14 L21 18"
                                stroke="#f43f5e"
                                strokeWidth="1.4"
                                fill="none"
                                opacity="0.9"
                              />
                              <text x="12" y="10" textAnchor="middle" fontSize="8" fill="#fda4af">
                                ☠
                              </text>
                            </svg>
                          </span>
                        )}
                        {isSafe && !isBroken && (
                          <span className="absolute right-1 top-0.5 font-mono text-[9px] text-emerald-300/80">
                            SAFE
                          </span>
                        )}
                        {simSafe === c && revealed !== c && (
                          <span className="absolute left-1 top-0.5 font-mono text-[8px] text-amber-300/70">
                            SIM
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {runners.map((rn) => (
            <RunnerAvatar
              key={rn.id}
              label={rn.label}
              color={rn.color}
              // Slot/sim `row` is the NEXT row to attempt; the
              // avatar must stand on the last tile it stepped
              // (row - 1), or on the START platform when row is 0.
              row={rn.row - 1}
              col={rn.col}
              cols={cols}
              rows={rows}
              tag={rn.tag}
              aura={rn.aura}
              ghost={rn.ghost}
            />
          ))}
        </div>
      </div>
      <div className="pb-1 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
        {meta.name} · Round {bridge ? bridge.roundId : "—"} · start ↓ — finish ↑
      </div>
    </div>
  );
}
