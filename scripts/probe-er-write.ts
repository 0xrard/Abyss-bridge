// Probe v2: are writes to delegated accounts broken for EVERYONE
// on the ER, or only for the VRF oracle's callback transactions?
// Uses raw simulateTransaction so the FULL program logs are always
// printed (Anchor's rpc() error path hides them).
//   Probe 1 — enter_bridge(0), owner-signed. Bridge 0 is unseeded,
//     so a healthy program rejects with BridgeSeedPending (6007).
//   Probe 2 — commit_and_undelegate_player, owner-signed: a real
//     PlayerState write/commit path with no seed gate.
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const ER_RPC = process.env.ER_RPC_URL || "https://devnet-as.magicblock.app";
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

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const economy = pda([Buffer.from("economy")]);
const bridgePub = (d: number) =>
  pda([Buffer.from("bridge_pub"), Buffer.from([d])]);
const bridgeSec = (d: number) =>
  pda([Buffer.from("bridge_sec"), Buffer.from([d])]);

async function simulate(
  tag: string,
  er: Connection,
  player: Keypair,
  ix: anchor.web3.TransactionInstruction
) {
  const tx = new Transaction().add(ix);
  tx.feePayer = player.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  const sim = await er.simulateTransaction(tx, [player]);
  console.log(`--- ${tag} ---`);
  console.log(`err: ${JSON.stringify(sim.value.err)}`);
  console.log((sim.value.logs ?? []).join("\n"));
  console.log("");
}

async function main() {
  if (!state.smokePlayerSecret) {
    console.error("no smoke player in state — run smoke-devnet.ts first");
    process.exit(2);
  }
  const player = Keypair.fromSecretKey(
    Uint8Array.from(Buffer.from(state.smokePlayerSecret, "base64"))
  );
  const playerPdaAddr = pda([Buffer.from("player"), player.publicKey.toBuffer()]);
  const er = new Connection(ER_RPC, "confirmed");
  const prog = new Program(
    idl,
    new AnchorProvider(er, new Wallet(player), { commitment: "confirmed" })
  );
  console.log(`player ${player.publicKey.toBase58()} · pda ${playerPdaAddr.toBase58()}`);

  const pub0: any = await (prog.account as any).bridgePublic
    .fetch(bridgePub(0))
    .catch(() => null);
  console.log(
    `bridge 0 via ER: round ${pub0?.roundId} · vrfPending ${pub0?.vrfPending}\n`
  );

  const enterIx = await (prog.methods as any)
    .enterBridge(0)
    .accounts({
      player: playerPdaAddr,
      owner: player.publicKey,
      signer: player.publicKey,
      economy,
      bridgePub: bridgePub(0),
      bridgeSec: bridgeSec(0),
    })
    .instruction();
  await simulate("probe 1: enter_bridge(0)", er, player, enterIx);

  const commitIx = await (prog.methods as any)
    .commitAndUndelegatePlayer()
    .accounts({
      payer: player.publicKey,
      owner: player.publicKey,
      player: playerPdaAddr,
      magicProgram: MAGIC_PROGRAM,
      magicContext: MAGIC_CONTEXT,
    })
    .instruction();
  await simulate("probe 2: commit_and_undelegate_player", er, player, commitIx);
}

main().catch((e) => {
  console.error("probe crashed:", e?.message ?? e);
  process.exit(1);
});
