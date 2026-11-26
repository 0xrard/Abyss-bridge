// Abyss Bridge — one-off diagnostic for the live VRF request failure.
//   npx ts-node scripts/debug-vrf.ts
// Simulates request_bridge_vrf(0) against the ER and prints the full
// program logs (the setup script's error was truncated), plus the
// presence of the key accounts on L1 vs ER.
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const L1_RPC = process.env.L1_RPC_URL || "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC_URL || "https://devnet-as.magicblock.app";
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
  const l1 = new Connection(L1_RPC, "confirmed");
  const er = new Connection(ER_RPC, "confirmed");
  const erProgram = new Program(
    idl,
    new AnchorProvider(er, new Wallet(deployer), { commitment: "confirmed" })
  );

  const bridgePub0 = pda([Buffer.from("bridge_pub"), Buffer.from([0])]);
  const bridgeSec0 = pda([Buffer.from("bridge_sec"), Buffer.from([0])]);
  const identity = pda([Buffer.from("identity")]);

  const pub: any = await (erProgram.account as any).bridgePublic
    .fetch(bridgePub0)
    .catch((e: any) => `fetch failed: ${e?.message ?? e}`);
  console.log(
    "BridgePublic(0) via ER:",
    typeof pub === "string"
      ? pub
      : `round ${pub.roundId} · vrfPending ${pub.vrfPending}`
  );
  for (const [name, conn] of [
    ["L1", l1],
    ["ER", er],
  ] as const) {
    const idInfo = await conn.getAccountInfo(identity).catch(() => null);
    console.log(
      `program identity PDA on ${name}: ${
        idInfo ? `exists (owner ${idInfo.owner.toBase58()}, ${idInfo.data.length} B)` : "MISSING"
      }`
    );
    const secInfo = await conn.getAccountInfo(bridgeSec0).catch(() => null);
    console.log(
      `BridgeSecret(0) on ${name}: ${
        secInfo ? `visible (${secInfo.data.length} B, owner ${secInfo.owner.toBase58()})` : "not served"
      }`
    );
    const qInfo = await conn
      .getAccountInfo(VRF_EPHEMERAL_QUEUE)
      .catch(() => null);
    console.log(
      `VRF ephemeral queue on ${name}: ${qInfo ? "exists" : "MISSING"}`
    );
  }

  console.log("\n--- simulating request_bridge_vrf(0) on ER ---");
  try {
    const tx = await (erProgram.methods as any)
      .requestBridgeVrf(0)
      .accounts({
        payer: deployer.publicKey,
        bridgePub: bridgePub0,
        bridgeSec: bridgeSec0,
        oracleQueue: VRF_EPHEMERAL_QUEUE,
        programIdentity: identity,
        vrfProgram: VRF_PROGRAM,
        slotHashes: SLOT_HASHES,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = deployer.publicKey;
    tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
    const sim = await er.simulateTransaction(tx, [deployer]);
    console.log("err:", JSON.stringify(sim.value.err));
    console.log("logs:\n" + (sim.value.logs ?? []).join("\n"));
  } catch (e: any) {
    console.log("simulation threw:", e?.message ?? e);
    if (e?.getLogs) console.log((await e.getLogs()).join("\n"));
  }
}

main().catch((e) => {
  console.error("debug failed:", e?.message ?? e);
  process.exit(1);
});
