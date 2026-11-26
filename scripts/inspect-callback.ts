// Diagnostics: did the VRF oracle ever attempt the callback?
//
// 1. Prints BridgePublic(0) state via the ER (ground truth).
// 2. Lists recent ER transactions touching BridgePublic(0) and
//    BridgeSecret(0) and prints their logs — a callback attempt by
//    the oracle (successful or failed) shows up here, with the
//    failure reason in the logs if it errored.
// 3. Dumps the raw BridgeSecret(0) bytes served by the plain ER RPC
//    and by the TEE RPC (both unauthenticated) next to the expected
//    serialized content, to judge whether PER actually hides data.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PROGRAM_ID = new PublicKey(
  "Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX"
);
const ER_RPC = "https://devnet-as.magicblock.app";
const TEE_RPC = "https://devnet-tee.magicblock.app";

const idl = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "target", "idl", "abyss_bridge.json"),
    "utf8"
  )
);
const deployer = anchor.web3.Keypair.fromSecretKey(
  new Uint8Array(
    JSON.parse(
      fs.readFileSync(
        process.env.ANCHOR_WALLET ||
          path.join(os.homedir(), ".config", "solana", "id.json"),
        "utf8"
      )
    )
  )
);
const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const bridgePub = (d: number) =>
  pda([Buffer.from("bridge_pub"), Buffer.from([d])]);
const bridgeSec = (d: number) =>
  pda([Buffer.from("bridge_sec"), Buffer.from([d])]);

async function main() {
  const er = new Connection(ER_RPC, "confirmed");
  const provider = new anchor.AnchorProvider(
    er,
    new anchor.Wallet(deployer),
    { commitment: "confirmed" }
  );
  const program = new Program(idl, provider as any);

  const pub0: any = await (program.account as any).bridgePublic
    .fetch(bridgePub(0))
    .catch((e: any) => {
      console.log("BridgePublic(0) fetch failed:", e?.message ?? e);
      return null;
    });
  if (pub0) {
    console.log(
      `STATE BridgePublic(0): round ${pub0.roundId} · vrfPending ${pub0.vrfPending}`
    );
  }

  // Expected BridgeSecret(0) content right now (never seeded on live):
  // discriminator | diff=0 | round_id=0 (u32 LE) | safe_col=[0;8] | vrf_pending=1
  const disc = crypto
    .createHash("sha256")
    .update("account:BridgeSecret")
    .digest()
    .subarray(0, 8);
  const expected = Buffer.concat([
    disc,
    Buffer.from([0]),
    Buffer.from([0, 0, 0, 0]),
    Buffer.alloc(8),
    Buffer.from([1]),
  ]);
  console.log(`expected BridgeSecret bytes: ${expected.toString("hex")}`);
  for (const [name, url] of [
    ["ER", ER_RPC],
    ["TEE", TEE_RPC],
  ] as const) {
    const conn = new Connection(url, "confirmed");
    const info = await conn.getAccountInfo(bridgeSec(0)).catch(() => null);
    if (!info) {
      console.log(`${name}: BridgeSecret NOT served (null) — hidden ✓`);
    } else {
      const data = Buffer.from(info.data);
      console.log(
        `${name}: BridgeSecret served ${data.length} B: ${data.toString(
          "hex"
        )} — ${data.equals(expected) ? "REAL CONTENT (not hidden)" : "differs from real content"}`
      );
    }
  }

  // --- TEE view: state + signatures as the TEE endpoint sees them.
  // After the validator migration, the generic endpoint may serve a
  // different (stale mirror) ledger than the validator actually
  // hosting the accounts — compare both views.
  const tee = new Connection(TEE_RPC, "confirmed");
  const teeProvider = new anchor.AnchorProvider(
    tee,
    new anchor.Wallet(deployer),
    { commitment: "confirmed" }
  );
  const teeProgram = new Program(idl, teeProvider as any);
  const teePub0: any = await (teeProgram.account as any).bridgePublic
    .fetch(bridgePub(0))
    .catch((e: any) => {
      console.log("TEE BridgePublic(0) fetch failed:", e?.message ?? e);
      return null;
    });
  if (teePub0) {
    console.log(
      `STATE via TEE BridgePublic(0): round ${teePub0.roundId} · vrfPending ${teePub0.vrfPending}`
    );
  }
  const teeSigs = await tee
    .getSignaturesForAddress(bridgePub(0), { limit: 12 })
    .catch((e: any) => {
      console.log(`TEE getSignaturesForAddress failed: ${e?.message ?? e}`);
      return [] as any[];
    });
  console.log(`\n--- BridgePublic(0) via TEE: ${teeSigs.length} recent signatures ---`);
  for (const s of teeSigs) {
    const tx: any = await tee
      .getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })
      .catch(() => null);
    const logs: string[] = tx?.meta?.logMessages ?? [];
    const interesting =
      s.err != null ||
      logs.some((l) => /onsume|Vrf|vrf|ailed|rror|equest/.test(l));
    console.log(
      `${s.signature.slice(0, 16)}… err=${JSON.stringify(s.err)} slot=${s.slot}${interesting ? "" : " (routine)"}`
    );
    if (interesting) {
      for (const l of logs) console.log(`    ${l}`);
    }
  }

  const seen = new Set<string>();
  for (const [label, addr] of [
    ["BridgePublic(0)", bridgePub(0)],
    ["BridgeSecret(0)", bridgeSec(0)],
  ] as const) {
    const sigs = await er
      .getSignaturesForAddress(addr, { limit: 25 })
      .catch((e: any) => {
        console.log(`${label}: getSignaturesForAddress failed: ${e?.message ?? e}`);
        return [];
      });
    console.log(`\n--- ${label}: ${sigs.length} recent signatures ---`);
    for (const s of sigs) {
      if (seen.has(s.signature)) continue;
      seen.add(s.signature);
      const tx: any = await er
        .getTransaction(s.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        })
        .catch(() => null);
      const logs: string[] = tx?.meta?.logMessages ?? [];
      const interesting =
        s.err != null ||
        logs.some((l) => /onsume|Vrf|vrf|ailed|rror/.test(l));
      console.log(
        `${s.signature.slice(0, 16)}… err=${JSON.stringify(s.err)} slot=${s.slot}${interesting ? "" : " (routine)"}`
      );
      if (interesting) {
        for (const l of logs) console.log(`    ${l}`);
      }
    }
  }
}

main().catch((e) => {
  console.error("inspect failed:", e?.message ?? e);
  process.exit(1);
});
