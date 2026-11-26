// Abyss Bridge — validator migration (one-off, 2026-11-25).
//
//   npx ts-node scripts/migrate-validator.ts
//
// WHY: the game accounts were delegated to the TEE validator.
// Accounts delegated there are writable ONLY through the TEE
// endpoint; the VRF oracle delivers callbacks on the generic
// validator, where those accounts are immutable replicas — every
// callback failed at commit with "Account is immutable" (proven by
// scripts/probe-er-write.ts: the same commit_and_undelegate_player
// fails via the generic endpoint and succeeds via the TEE one).
//
// WHAT: phase 1 undelegates economy + 4x BridgePublic + 4x
// BridgeSecret via the TEE endpoint; phase 2 waits for L1
// settlement, re-delegates everything with validator = null
// (any-validator) and prints each delegation record's validator;
// phase 3 requests VRF for all bridges via the GENERIC endpoint
// and waits for the oracle callbacks to land.
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import nacl from "tweetnacl";
import bs58 from "bs58";

const L1_RPC = process.env.L1_RPC_URL || "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC_URL || "https://devnet-as.magicblock.app";
const TEE_RPC = process.env.TEE_RPC_URL || "https://devnet-tee.magicblock.app";
const DELEGATION_PROGRAM = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);
const MAGIC_PROGRAM = new PublicKey(
  "Magic11111111111111111111111111111111111111"
);
const MAGIC_CONTEXT = new PublicKey(
  "MagicContext1111111111111111111111111111111"
);
const VRF_PROGRAM = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);
const VRF_EPHEMERAL_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
);
const SLOT_HASHES = new PublicKey(
  "SysvarS1otHashes111111111111111111111111111"
);

const idl = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "target", "idl", "abyss_bridge.json"),
    "utf8"
  )
);
const PROGRAM_ID = new PublicKey(idl.address);

const pda = (seeds: (Buffer | Uint8Array)[], program = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, program)[0];
const vaultCfg = pda([Buffer.from("vault_cfg")]);
const economy = pda([Buffer.from("economy")]);
const bridgePub = (d: number) =>
  pda([Buffer.from("bridge_pub"), Buffer.from([d])]);
const bridgeSec = (d: number) =>
  pda([Buffer.from("bridge_sec"), Buffer.from([d])]);
const bufferOf = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), account.toBuffer()],
    PROGRAM_ID
  )[0];
const recordOf = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), account.toBuffer()],
    DELEGATION_PROGRAM
  )[0];
const metadataOf = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), account.toBuffer()],
    DELEGATION_PROGRAM
  )[0];

const log = (m: string) => console.log(`[migrate] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const deployer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(
          process.env.ANCHOR_WALLET ||
            path.join(os.homedir(), ".config", "solana", "id.json"),
          "utf8"
        )
      )
    )
  );
  log(`authority ${deployer.publicKey.toBase58()}`);

  // The TEE endpoint requires an auth token for SENDING
  // transactions (reads/simulations are open). Flow per the ER
  // SDK's getAuthToken: GET /auth/challenge?pubkey=…, sign the
  // challenge with the authority keypair, POST /auth/login, then
  // append ?token=… to the RPC URL.
  const authedUrl = async (base: string): Promise<string> => {
    const challengeRes = await fetch(
      `${base}/auth/challenge?pubkey=${deployer.publicKey.toBase58()}`
    );
    const challengeJson = (await challengeRes.json()) as {
      challenge?: string;
    };
    const challenge = challengeJson.challenge;
    if (typeof challenge !== "string" || !challenge) {
      throw new Error(`auth at ${base}: no challenge received`);
    }
    const signature = nacl.sign.detached(
      new Uint8Array(Buffer.from(challenge, "utf-8")),
      deployer.secretKey
    );
    const loginRes = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pubkey: deployer.publicKey.toBase58(),
        challenge,
        signature: bs58.encode(signature),
      }),
    });
    const loginJson = (await loginRes.json()) as { token?: string };
    if (loginRes.status !== 200 || typeof loginJson.token !== "string") {
      throw new Error(`auth at ${base} failed: ${JSON.stringify(loginJson)}`);
    }
    return `${base}?token=${loginJson.token}`;
  };
  const TEE_RPC_AUTHED = await authedUrl(TEE_RPC);
  log("TEE auth token obtained ✓");

  const l1 = new Connection(L1_RPC, "confirmed");
  const tee = new Connection(TEE_RPC_AUTHED, "confirmed");
  const er = new Connection(ER_RPC, "confirmed");
  const mk = (conn: Connection) =>
    new Program(
      idl,
      new AnchorProvider(conn, new Wallet(deployer), {
        commitment: "confirmed",
      })
    );
  const teeProgram = mk(tee);
  const l1Program = mk(l1);
  const erProgram = mk(er);

  const targets: { name: string; addr: PublicKey }[] = [
    { name: "economy", addr: economy },
    ...[0, 1, 2, 3].map((d) => ({
      name: `bridge_pub ${d}`,
      addr: bridgePub(d),
    })),
    ...[0, 1, 2, 3].map((d) => ({
      name: `bridge_sec ${d}`,
      addr: bridgeSec(d),
    })),
  ];

  // ---- Phase 1: undelegate everything via the TEE endpoint ----
  // Skipped with --phase3 (resume mode: migration already done,
  // only the VRF requests remain).
  const phase3Only = process.argv.includes("--phase3");
  if (!phase3Only) {
  log("phase 1: commit + undelegate via TEE…");
  const magic = { magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT };
  const und = async (tag: string, fn: () => Promise<any>) => {
    try {
      await fn();
      log(`${tag} undelegation scheduled ✓`);
    } catch (e: any) {
      log(`${tag} undelegate call failed (may already be back on L1): ${e?.message ?? e}`);
    }
  };
  await und("economy", () =>
    (teeProgram.methods as any)
      .commitAndUndelegateEconomy()
      .accounts({ payer: deployer.publicKey, vaultCfg, economy, ...magic })
      .rpc()
  );
  for (let d = 0; d < 4; d++) {
    await und(`bridge_pub ${d}`, () =>
      (teeProgram.methods as any)
        .commitAndUndelegateBridgePub(d)
        .accounts({
          payer: deployer.publicKey,
          vaultCfg,
          bridgePub: bridgePub(d),
          ...magic,
        })
        .rpc()
    );
    await und(`bridge_sec ${d}`, () =>
      (teeProgram.methods as any)
        .commitAndUndelegateBridgeSec(d)
        .accounts({
          payer: deployer.publicKey,
          vaultCfg,
          bridgeSec: bridgeSec(d),
          ...magic,
        })
        .rpc()
    );
  }

  // ---- Phase 2: wait for L1 settlement, re-delegate any-validator ----
  log("phase 2: waiting for all 9 accounts to settle back on L1…");
  const deadline = Date.now() + 240_000;
  let settled = false;
  while (Date.now() < deadline) {
    const infos = await l1.getMultipleAccountsInfo(targets.map((t) => t.addr));
    settled = infos.every(
      (i) => i && i.owner.equals(PROGRAM_ID)
    );
    if (settled) break;
    await sleep(4000);
  }
  if (!settled) {
    const infos = await l1.getMultipleAccountsInfo(targets.map((t) => t.addr));
    targets.forEach((t, i) =>
      log(`${t.name}: owner on L1 = ${infos[i]?.owner.toBase58() ?? "MISSING"}`)
    );
    throw new Error("settlement timed out — re-run this script to resume");
  }
  log("all 9 accounts back on L1 ✓");

  const isDelegated = async (addr: PublicKey) => {
    const info = await l1.getAccountInfo(addr);
    return !!info && info.owner.equals(DELEGATION_PROGRAM);
  };
  const delAccounts = (name: string, addr: PublicKey) => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    return {
      payer: deployer.publicKey,
      [`buffer${cap}`]: bufferOf(addr),
      [`delegationRecord${cap}`]: recordOf(addr),
      [`delegationMetadata${cap}`]: metadataOf(addr),
      [name]: addr,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM,
      systemProgram: SystemProgram.programId,
    } as any;
  };
  if (!(await isDelegated(economy))) {
    await (l1Program.methods as any)
      .delegateEconomy(null)
      .accounts(delAccounts("economy", economy))
      .rpc();
    log("economy re-delegated (validator: null) ✓");
  }
  for (let d = 0; d < 4; d++) {
    if (!(await isDelegated(bridgePub(d)))) {
      await (l1Program.methods as any)
        .delegateBridgePub(d, null)
        .accounts(delAccounts("bridgePub", bridgePub(d)))
        .rpc();
      log(`bridge_pub ${d} re-delegated (validator: null) ✓`);
    }
    if (!(await isDelegated(bridgeSec(d)))) {
      await (l1Program.methods as any)
        .delegateBridgeSec(d, null)
        .accounts(delAccounts("bridgeSec", bridgeSec(d)))
        .rpc();
      log(`bridge_sec ${d} re-delegated (validator: null) ✓`);
    }
  }
  for (const t of targets) {
    const rec = await l1.getAccountInfo(recordOf(t.addr));
    const validator = rec
      ? new PublicKey(rec.data.subarray(8, 40)).toBase58()
      : "NO RECORD";
    log(`${t.name}: delegation record validator = ${validator}`);
  }
  } else {
    log("phases 1-2 skipped (--phase3 resume mode)");
  }

  // ---- Phase 3: VRF via the GENERIC endpoint ----
  // After re-delegation the generic endpoint also demands an auth
  // token for sends touching these accounts (401 without one), so
  // authenticate there too; fall back to the plain URL if that
  // endpoint has no auth flow.
  log("phase 3: requesting VRF for all bridges via the generic ER…");
  let erProgramAuthed = erProgram;
  try {
    const erAuthed = new Connection(await authedUrl(ER_RPC), "confirmed");
    erProgramAuthed = mk(erAuthed);
    log("generic ER auth token obtained ✓");
  } catch (e: any) {
    log(`generic ER auth unavailable (${e?.message ?? e}) — using plain URL`);
  }
  for (let d = 0; d < 4; d++) {
    let pub: any = null;
    for (let i = 0; i < 15 && !pub; i++) {
      pub = await (erProgramAuthed.account as any).bridgePublic
        .fetch(bridgePub(d))
        .catch(() => null);
      if (!pub) await sleep(3000);
    }
    if (!pub) {
      log(`diff ${d}: BridgePublic not visible on the generic ER yet — skipping (re-run setup or this script)`);
      continue;
    }
    if (pub.vrfPending) {
      await (erProgramAuthed.methods as any)
        .requestBridgeVrf(d)
        .accounts({
          payer: deployer.publicKey,
          bridgePub: bridgePub(d),
          bridgeSec: bridgeSec(d),
          oracleQueue: VRF_EPHEMERAL_QUEUE,
          programIdentity: pda([Buffer.from("identity")]),
          vrfProgram: VRF_PROGRAM,
          slotHashes: SLOT_HASHES,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      log(`diff ${d}: VRF requested, waiting for the oracle…`);
      const dl = Date.now() + 120_000;
      while (Date.now() < dl) {
        await sleep(3000);
        pub = await (erProgramAuthed.account as any).bridgePublic
          .fetch(bridgePub(d))
          .catch(() => pub);
        if (pub && !pub.vrfPending) break;
      }
    }
    log(
      pub && !pub.vrfPending
        ? `diff ${d}: CALLBACK LANDED — layout live (round ${pub.roundId}) ✓✓✓`
        : `diff ${d}: still pending after timeout ✗`
    );
  }
  log("MIGRATION DONE");
}

main().catch((e) => {
  console.error("[migrate] FAILED:", e?.message ?? e);
  process.exit(1);
});
