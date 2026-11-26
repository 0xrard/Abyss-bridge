"use client";

// Devnet Traffic Simulator (SPEC.md §6): two simulated bots run the
// SAME shared bridge so a solo judge sees other runners jumping,
// glass breaking and the ticker moving in real time.
//
// Honesty note: until a program is deployed to devnet (Batch 3), the
// bots run as a LOCAL simulation overlay — their reveals are marked
// "SIM" on the tiles and their ticker lines are tagged [SIM]. They
// never write to chain state and never touch the real Event Vault.
// Once Batch 3 is live, this engine can be swapped for two ephemeral
// keypairs playing through useMagicBlock with no UI changes.
import { useEffect, useRef, useState } from "react";
import { Keypair } from "@solana/web3.js";
import { DIFFICULTIES, colorFromPubkey, shortAddr } from "@/lib/constants";
import type { StageRunner } from "./GlassBridge";
import type { TickerEvent } from "@/lib/types";

interface Bot {
  id: string;
  pubkey: string;
  row: number;
  col: number;
  blindSteps: number;
  active: boolean;
  restTicks: number;
}

interface BotWorld {
  bots: Bot[];
  layout: number[];
  revealed: Record<number, number>;
  broken: Set<string>;
}

export function useDemoBots(
  enabled: boolean,
  diff: number,
  onEvent: (text: string, tone: TickerEvent["tone"]) => void
) {
  const worldRef = useRef<BotWorld | null>(null);
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      worldRef.current = null;
      setTick((t) => t + 1);
      return;
    }
    const meta = DIFFICULTIES[diff];
    const layout = Array.from({ length: meta.rows }, () =>
      Math.floor(Math.random() * meta.cols)
    );
    worldRef.current = {
      layout,
      revealed: {},
      broken: new Set(),
      bots: [0, 1].map((i) => ({
        id: `bot-${i}`,
        pubkey: Keypair.generate().publicKey.toBase58(),
        row: 0,
        col: 0,
        blindSteps: 0,
        active: false,
        restTicks: i * 2,
      })),
    };
    eventRef.current(
      "Devnet Traffic Simulator ON — 2 bots joined the bridge [SIM]",
      "sim"
    );
    const id = setInterval(() => {
      const w = worldRef.current;
      if (!w) return;
      for (const bot of w.bots) {
        if (!bot.active) {
          if (bot.restTicks > 0) {
            bot.restTicks -= 1;
            continue;
          }
          bot.active = true;
          bot.row = 0;
          bot.blindSteps = 0;
          eventRef.current(
            `${shortAddr(bot.pubkey)} entered ${meta.name} [SIM]`,
            "sim"
          );
          continue;
        }
        const knownSafe = w.revealed[bot.row];
        const col =
          knownSafe !== undefined && Math.random() < 0.8
            ? knownSafe
            : Math.floor(Math.random() * meta.cols);
        bot.col = col;
        if (col === w.layout[bot.row]) {
          const untouched = knownSafe === undefined;
          if (untouched) {
            bot.blindSteps += 1;
            w.revealed[bot.row] = col;
          }
          if (bot.row + 1 >= meta.rows) {
            eventRef.current(
              `${shortAddr(bot.pubkey)} FINISHED ${meta.name} with ${bot.blindSteps} blind steps [SIM]`,
              "win"
            );
            bot.active = false;
            bot.restTicks = 3;
            // A finish reshuffles the local layout, like a new round.
            w.layout = Array.from({ length: meta.rows }, () =>
              Math.floor(Math.random() * meta.cols)
            );
            w.revealed = {};
            w.broken = new Set();
          } else {
            bot.row += 1;
          }
        } else {
          w.broken.add(`${bot.row}:${col}`);
          eventRef.current(
            `${shortAddr(bot.pubkey)} fell at ${meta.name} R${bot.row + 1} → +$0.25 to Event Vault [SIM]`,
            "fall"
          );
          bot.active = false;
          bot.restTicks = 2;
        }
      }
      setTick((t) => t + 1);
    }, 1300);
    return () => clearInterval(id);
  }, [enabled, diff]);

  const world = worldRef.current;
  const runners: StageRunner[] =
    world?.bots
      .filter((b) => b.active)
      .map((b) => ({
        id: b.id,
        label: `BOT ${shortAddr(b.pubkey)}`,
        color: colorFromPubkey(b.pubkey),
        row: b.row,
        col: b.col,
        tag: `${b.blindSteps} blind`,
        ghost: true,
      })) ?? [];
  return {
    runners,
    simRevealed: world?.revealed ?? {},
    simBroken: world?.broken ?? new Set<string>(),
  };
}

export default function DemoBotToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-abyss-edge bg-abyss-panel px-3 py-2">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-cyan-400"
      />
      <span className="font-mono text-xs text-slate-300">
        [Demo Mode: Simulate 2 Bots]
      </span>
      <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
        Devnet Traffic Simulator
      </span>
    </label>
  );
}
