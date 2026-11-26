"use client";

// Live game state: polls + account-change subscriptions on the ER
// connection for GlobalEconomy, the four BridgePublic accounts and
// the user's PlayerState. BridgeSecret is NEVER read (PER, Batch 3).
// PlayerState is read from the ER once delegated; before delegation
// it still lives on L1, so an L1 fallback fetch is attempted.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Program } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import {
  bridgePubPda,
  DELEGATION_PROGRAM,
  economyPda,
  playerPda,
} from "@/lib/constants";
import type {
  BridgePublicState,
  GlobalEconomyState,
  PlayerState,
} from "@/lib/types";

export function useBridgeState(
  erProgram: Program<any> | null,
  l1Program: Program<any> | null,
  owner: PublicKey | null
) {
  const [economy, setEconomy] = useState<GlobalEconomyState | null>(null);
  const [bridges, setBridges] = useState<(BridgePublicState | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [playerDelegated, setPlayerDelegated] = useState(false);
  const fetching = useRef(false);

  const fetchAll = useCallback(async () => {
    if (!erProgram || fetching.current) return;
    fetching.current = true;
    try {
      const eco = await (erProgram.account as any).globalEconomy
        .fetchNullable(economyPda())
        .catch(() => null);
      if (eco) setEconomy(eco as GlobalEconomyState);
      const pubs = await Promise.all(
        [0, 1, 2, 3].map((d) =>
          (erProgram.account as any).bridgePublic
            .fetchNullable(bridgePubPda(d))
            .catch(() => null)
        )
      );
      setBridges(pubs as (BridgePublicState | null)[]);
      if (owner) {
        let p = await (erProgram.account as any).playerState
          .fetchNullable(playerPda(owner))
          .catch(() => null);
        if (!p && l1Program) {
          p = await (l1Program.account as any).playerState
            .fetchNullable(playerPda(owner))
            .catch(() => null);
        }
        setPlayer(p as PlayerState | null);
        if (l1Program) {
          // Delegation is decided by the L1 account owner: while
          // the Delegation Program owns the account, the player
          // lives in the rollup and L1 actions (deposit) revert.
          const info = await l1Program.provider.connection
            .getAccountInfo(playerPda(owner))
            .catch(() => null);
          setPlayerDelegated(
            !!info && info.owner.equals(DELEGATION_PROGRAM)
          );
        }
      } else {
        setPlayer(null);
        setPlayerDelegated(false);
      }
    } finally {
      fetching.current = false;
    }
  }, [erProgram, l1Program, owner]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 2500);
    return () => clearInterval(id);
  }, [fetchAll]);

  useEffect(() => {
    if (!erProgram) return;
    const conn = erProgram.provider.connection;
    const watched = [
      economyPda(),
      bridgePubPda(0),
      bridgePubPda(1),
      bridgePubPda(2),
      bridgePubPda(3),
      ...(owner ? [playerPda(owner)] : []),
    ];
    const subIds = watched.map((addr) =>
      conn.onAccountChange(addr, () => void fetchAll())
    );
    return () => {
      subIds.forEach((id) => {
        conn.removeAccountChangeListener(id).catch(() => {});
      });
    };
  }, [erProgram, owner, fetchAll]);

  return { economy, bridges, player, playerDelegated, refresh: fetchAll };
}
