// Abyss Bridge — decisive VRF experiment: REAL send, preflight skipped.
//   npx ts-node scripts/try-vrf.ts [diff]
// The setup failure and the debug simulation both died in the ER's
// preflight *simulation* ("Program failed to complete", no VRF-program
// log lines). ER simulation is known to not emulate every native CPI
// path. This script sends request_bridge_vrf for real with
// skipPreflight, prints the landed transaction's logs, and polls the
// public mirror for the oracle callback (vrfPending -> false, round+1).
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const diff = Number(process.argv[2] ?? 0);
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
  const er = new Connection(ER_RPC, "confirmed");
  const provider = new AnchorProvider(er, new Wallet(deployer), {
    commitment: "confirmed",
  });
  const program = new Program(idl, provider);
  const bridgePub = pda([Buffer.from("bridge_pub"), Buffer.from([diff])]);
  const bridgeSec = pda([Buffer.from("bridge_sec"), Buffer.from([diff])]);

  const before: any = await (program.account as any).bridgePublic.fetch(
    bridgePub
  );
  console.log(
    `before: round ${before.roundId} · vrfPending ${before.vrfPending}`
  );
  if (!before.vrfPending) {
    console.log("bridge is not pending — nothing to request.");
    return;
  }

  const tx = await (program.methods as any)
    .requestBridgeVrf(diff)
    .accounts({
      payer: deployer.publicKey,
      bridgePub,
      bridgeSec,
      oracleQueue: VRF_EPHEMERAL_QUEUE,
      programIdentity: pda([Buffer.from("identity")]),
      vrfProgram: VRF_PROGRAM,
      slotHashes: SLOT_HASHES,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  tx.feePayer = deployer.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(deployer);

  console.log("sending with skipPreflight…");
  const sig = await er.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });
  console.log("tx signature:", sig);
  const conf = await er.confirmTransaction(sig, "confirmed").catch((e) => ({
    value: { err: `confirm failed: ${e?.message ?? e}` },
  }));
  console.log("confirmation err:", JSON.stringify(conf.value.err));

  await sleep(3000);
  const landed = await er
    .getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    })
    .catch(() => null);
  console.log(
    "landed tx logs:\n" +
      (landed?.meta?.logMessages ?? ["(no logs available)"]).join("\n")
  );

  console.log("\npolling for the oracle callback (up to 120s)…");
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const now: any = await (program.account as any).bridgePublic
      .fetch(bridgePub)
      .catch(() => null);
    if (!now) continue;
    console.log(`  round ${now.roundId} · vrfPending ${now.vrfPending}`);
    if (!now.vrfPending) {
      console.log(
        `\nSUCCESS: callback landed — bridge diff ${diff} is live at round ${now.roundId}.`
      );
      return;
    }
  }
  console.log(
    "\nRequest sent but the callback did not land within 120s — inspect the tx logs above."
  );
}

main().catch((e) => {
  console.error("try-vrf failed:", e?.message ?? e);
  process.exit(1);
});
