"use client";

// Abyss Bridge — single-viewport game page.
// Data flow: useMagicBlock (actions, dual connection, session key) +
// useBridgeState (BridgePublic / GlobalEconomy / PlayerState ONLY —
// BridgeSecret is never read) + local demo-bot overlay.
import { useCallback, useEffect, useRef, useState } from "react";
import TopHud from "@/components/TopHud";
import DifficultyTabs from "@/components/DifficultyTabs";
import GlassBridge from "@/components/GlassBridge";
import ControlDeck from "@/components/ControlDeck";
import DemoBotToggle, { useDemoBots } from "@/components/DemoBotToggle";
import { useMagicBlock } from "@/hooks/useMagicBlock";
import { useBridgeState } from "@/hooks/useBridgeState";
import { DIFFICULTIES, fmtUsdc } from "@/lib/constants";
import type { PlayerState, TickerEvent } from "@/lib/types";

let eventId = 0;

export default function Page() {
  const mb = useMagicBlock();
  const { economy, bridges, player, playerDelegated, refresh } =
    useBridgeState(
    mb.erProgram,
    mb.l1Program,
    mb.publicKey
  );
  const [diff, setDiff] = useState(0);
  const [demoOn, setDemoOn] = useState(false);
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const [shakeNonce, setShakeNonce] = useState(0);

  const pushEvent = useCallback(
    (text: string, tone: TickerEvent["tone"] = "info") => {
      setEvents((prev) =>
        [{ id: ++eventId, text, tone, ts: Date.now() }, ...prev].slice(0, 30)
      );
    },
    []
  );

  const bots = useDemoBots(demoOn, diff, pushEvent);
  const bridge = bridges[diff];

  // --- Auto-dispatch request_bridge_vrf when a shuffle is pending ---
  const vrfAttempts = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!mb.sessionKeypair || mb.busy) return;
    for (const d of [0, 1, 2, 3]) {
      const b = bridges[d];
      if (!b?.vrfPending) continue;
      const key = `${d}:${b.roundId}`;
      const last = vrfAttempts.current[key] ?? 0;
      if (Date.now() - last < 20_000) continue;
      vrfAttempts.current[key] = Date.now();
      pushEvent(
        `Bridge ${DIFFICULTIES[d].name} finished — requesting VRF shuffle…`,
        "info"
      );
      void mb.requestVrf(d).then(() => setTimeout(refresh, 800));
    }
  }, [bridges, mb, pushEvent, refresh]);

  // --- Detect falls (new broken bits) -> shake + ticker ---
  const prevBroken = useRef<(number[] | null)[]>([null, null, null, null]);
  useEffect(() => {
    bridges.forEach((b, d) => {
      if (!b) return;
      const prev = prevBroken.current[d];
      if (prev) {
        b.brokenMask.forEach((mask, r) => {
          const fresh = mask & ~(prev[r] ?? 0);
          if (fresh !== 0) {
            setShakeNonce((n) => n + 1);
            pushEvent(
              `A runner fell at ${DIFFICULTIES[d].name} R${r + 1} → +$0.25 to Event Vault`,
              "fall"
            );
          }
        });
      }
      prevBroken.current[d] = [...b.brokenMask];
    });
  }, [bridges, pushEvent]);

  // --- Rush activation ticker ---
  const prevRush = useRef(false);
  useEffect(() => {
    if (economy?.rushActive && !prevRush.current) {
      pushEvent(
        `🔥 RESURRECTION RUSH #${economy.rushRoundId} — pool $${fmtUsdc(economy.rushPrizePool.toNumber())}!`,
        "rush"
      );
    }
    prevRush.current = !!economy?.rushActive;
  }, [economy, pushEvent]);

  // --- Own run end ticker ---
  const prevPlayer = useRef<PlayerState | null>(null);
  useEffect(() => {
    const prev = prevPlayer.current;
    if (prev?.isOnBridge && player && !player.isOnBridge) {
      pushEvent(
        `Your run ended — arcade balance $${fmtUsdc(player.balance.toNumber())}`,
        "win"
      );
    }
    prevPlayer.current = player;
  }, [player, pushEvent]);

  // --- Keyboard quick-step (1/2/3) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!player?.isOnBridge || player.activeDiff !== diff) return;
      const n = parseInt(e.key, 10);
      const cols = bridge?.cols ?? 2;
      if (n >= 1 && n <= cols) void mb.stepTile(player, n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, diff, bridge, mb]);

  const after = useCallback(
    (p: Promise<unknown>) => {
      void p.then(() => setTimeout(refresh, 700));
    },
    [refresh]
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-abyss-bg font-sans text-slate-100">
      <TopHud
        economy={economy}
        player={player}
        sessionReady={!!mb.sessionKeypair}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <DifficultyTabs
            active={diff}
            onSelect={setDiff}
            economy={economy}
            player={player}
            busy={mb.busy}
            onFinalize={() => after(mb.finalizeRush())}
            onClaim={() => after(mb.claimRushReward())}
          />
        </div>
        <div className="px-4 pt-2">
          <DemoBotToggle enabled={demoOn} onChange={setDemoOn} />
        </div>
      </div>
      {mb.lastError && (
        <div className="mx-4 mt-2 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 font-mono text-[11px] text-rose-200">
          {mb.lastError}
        </div>
      )}
      <GlassBridge
        diff={diff}
        bridge={bridge}
        player={player}
        extraRunners={bots.runners}
        simRevealed={bots.simRevealed}
        simBroken={bots.simBroken}
        shakeNonce={shakeNonce}
        canStep={!!player?.isOnBridge && player.activeDiff === diff}
        onStep={(col) => player && after(mb.stepTile(player, col))}
      />
      <ControlDeck
        diff={diff}
        bridge={bridge}
        economy={economy}
        player={player}
        playerDelegated={playerDelegated}
        busy={mb.busy}
        mintConfigured={mb.mintConfigured}
        walletConnected={!!mb.publicKey}
        events={events}
        onEnter={() => after(mb.enterBridge(diff))}
        onStep={(col) => player && after(mb.stepTile(player, col))}
        onCashOut={() => player && after(mb.cashOut(player))}
        onDeposit={(amt) => after(mb.depositAndDelegate(amt))}
        onWithdraw={() => player && after(mb.withdraw(player))}
        onFaucet={() => after(mb.faucet())}
      />
    </div>
  );
}
