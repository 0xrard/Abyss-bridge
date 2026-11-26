// One-off rescue: REALLY undelegate the persisted smoke player.
//
// The player is still delegated to the TEE validator from an
// earlier smoke run. A previous probe only SIMULATED
// commit_and_undelegate_player — the logs looked real
// ("ScheduledCommitSent") but a simulation submits nothing, so
// the account never came back to L1 and `deposit` now fails with
// AccountOwnedByWrongProgram. This script sends the real
// transaction via the TEE endpoint (with its auth token) and
// waits until L1 shows the account owned by the program again.
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import nacl from "tweetnacl";
import bs58 from "bs58";

const L1_RPC = process.env.L1_RPC_URL || "https://api.devnet.solana.com";
const TEE_RPC = process.env.TEE_RPC_URL || "https://devnet-tee.magicblock.app";
const MAGIC_PROGRAM = new PublicKey(
  "Magic11111111111111111111111111111111111111"
);
const MAGIC_CONTEXT = new PublicKey(
  "MagicContext1111111111111111111111111111111"
);
const STATE_PATH = path.join(__dirname, ".devnet-state.json");
const idl = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "target", "idl", "abyss_bridge.json"),
    "utf8"
  )
);
const PROGRAM_ID = new PublicKey(idl.address);
const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!state.smokePlayerSecret) {
    console.error("no smoke player in state — nothing to rescue");
    process.exit(2);
  }
  const player = Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(state.smokePlayerSecret, "base64"))
  );
  const playerPda = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), player.publicKey.toBuffer()],
    PROGRAM_ID
  )[0];
  const l1 = new Connection(L1_RPC, "confirmed");
  const before = await l1.getAccountInfo(playerPda);
  console.log(
    `player PDA ${playerPda.toBase58()} · owner on L1: ${before?.owner.toBase58()}`
  );
  if (before && before.owner.equals(PROGRAM_ID)) {
    console.log("already back on L1 — just re-run the smoke test");
    return;
  }

  // TEE auth token for the PLAYER keypair (it is the tx signer).
  const challengeRes = await fetch(
    `${TEE_RPC}/auth/challenge?pubkey=${player.publicKey.toBase58()}`
  );
  const challengeJson = (await challengeRes.json()) as {
    challenge?: string;
  };
  const challenge = challengeJson.challenge;
  if (!challenge) throw new Error("TEE auth: no challenge received");
  const signature = nacl.sign.detached(
    new Uint8Array(Buffer.from(challenge, "utf-8")),
    player.secretKey
  );
  const loginRes = await fetch(`${TEE_RPC}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pubkey: player.publicKey.toBase58(),
      challenge,
      signature: bs58.encode(signature),
    }),
  });
  const loginJson = (await loginRes.json()) as { token?: string };
  if (loginRes.status !== 200 || !loginJson.token) {
    throw new Error(`TEE auth failed: ${JSON.stringify(loginJson)}`);
  }
  console.log("TEE auth token obtained ✓");

  const tee = new Connection(`${TEE_RPC}?token=${loginJson.token}`, "confirmed");
  const prog = new Program(
    idl,
    new AnchorProvider(tee, new Wallet(player), { commitment: "confirmed" })
  );
  const sig = await (prog.methods as any)
    .commitAndUndelegatePlayer()
    .accounts({
      payer: player.publicKey,
      owner: player.publicKey,
      player: playerPda,
      magicProgram: MAGIC_PROGRAM,
      magicContext: MAGIC_CONTEXT,
    })
    .rpc();
  console.log(`commit_and_undelegate_player SENT ✓ ${sig}`);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await sleep(4000);
    const info = await l1.getAccountInfo(playerPda);
    if (info && info.owner.equals(PROGRAM_ID)) {
      console.log("player settled back on L1 ✓ — re-run the smoke test");
      return;
    }
  }
  throw new Error("settlement timed out — check again in a minute, then re-run smoke");
}

main().catch((e) => {
  console.error("rescue FAILED:", e?.message ?? e);
  process.exit(1);
});
