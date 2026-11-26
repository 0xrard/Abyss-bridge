// Probe: ask the Magic Router which validator actually hosts our
// accounts after the migration, and read the bridge state through
// the router (which routes reads to the hosting validator).
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ConnectionMagicRouter,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ROUTER_RPC = "https://devnet-router.magicblock.app";
const PROGRAM_ID = new PublicKey(
  "Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX"
);
const idl = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "target", "idl", "abyss_bridge.json"),
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

async function stateVia(conn: any, tag: string) {
  try {
    const provider = new anchor.AnchorProvider(
      conn,
      new anchor.Wallet(deployer),
      { commitment: "confirmed" }
    );
    const program = new Program(idl, provider as any);
    const pub0: any = await (program.account as any).bridgePublic.fetch(
      bridgePub(0)
    );
    console.log(
      `${tag}: round ${pub0.roundId} · vrfPending ${pub0.vrfPending}`
    );
  } catch (e: any) {
    console.log(`${tag}: fetch failed — ${e?.message ?? e}`);
  }
}

async function main() {
  const router = new ConnectionMagicRouter(ROUTER_RPC, "confirmed");
  try {
    const closest = await router.getClosestValidator();
    console.log(`closest validator: ${JSON.stringify(closest)}`);
  } catch (e: any) {
    console.log(`getClosestValidator failed: ${e?.message ?? e}`);
  }
  try {
    const status = await router.getDelegationStatus(bridgePub(0));
    console.log(`BridgePublic(0) delegation status: ${JSON.stringify(status)}`);
  } catch (e: any) {
    console.log(`getDelegationStatus failed: ${e?.message ?? e}`);
  }
  await stateVia(router, "state via ROUTER");
  const sigs = await router
    .getSignaturesForAddress(bridgePub(0), { limit: 8 })
    .catch((e: any) => {
      console.log(`router signatures failed: ${e?.message ?? e}`);
      return [] as any[];
    });
  console.log(`--- BridgePublic(0) via ROUTER: ${sigs.length} signatures ---`);
  for (const s of sigs) {
    console.log(
      `${s.signature.slice(0, 16)}… err=${JSON.stringify(s.err)} slot=${s.slot}`
    );
  }
  // For comparison: the plain generic endpoint's current slot.
  const generic = new Connection("https://devnet.magicblock.app", "confirmed");
  console.log(`generic endpoint slot: ${await generic.getSlot().catch(() => "?")}`);
  console.log(`router endpoint slot: ${await router.getSlot().catch(() => "?")}`);
}

main().catch((e) => {
  console.error("router probe failed:", e?.message ?? e);
  process.exit(1);
});
