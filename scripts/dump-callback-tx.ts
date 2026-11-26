// Dump the raw structure of the newest FAILED oracle callback tx:
// every account key with its signer/writable flags, the top-level
// instructions, and — most importantly — the INNER instruction the
// VRF program used to call our consume_vrf_randomness (account order
// + flags + exact data bytes), compared against what our program
// expects: [scoped identity (signer), bridge_pub (w), bridge_sec (w)]
// and data = discriminator(8) + randomness(32).
import { Connection, PublicKey } from "@solana/web3.js";
// @ts-ignore — transitive dep of @coral-xyz/anchor
import bs58 from "bs58";

const ER_RPC = "https://devnet.magicblock.app";
const PROGRAM_ID = new PublicKey(
  "Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX"
);
const VRF_PROGRAM = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);
const bridgePub0 = PublicKey.findProgramAddressSync(
  [Buffer.from("bridge_pub"), Buffer.from([0])],
  PROGRAM_ID
)[0];
const bridgeSec0 = PublicKey.findProgramAddressSync(
  [Buffer.from("bridge_sec"), Buffer.from([0])],
  PROGRAM_ID
)[0];
const scopedIdentity = PublicKey.findProgramAddressSync(
  [Buffer.from("identity"), PROGRAM_ID.toBuffer()],
  VRF_PROGRAM
)[0];

const label = (k: PublicKey) =>
  k.equals(PROGRAM_ID)
    ? "OUR PROGRAM"
    : k.equals(VRF_PROGRAM)
      ? "VRF PROGRAM"
      : k.equals(bridgePub0)
        ? "BridgePublic(0)"
        : k.equals(bridgeSec0)
          ? "BridgeSecret(0)"
          : k.equals(scopedIdentity)
            ? "SCOPED VRF IDENTITY"
            : "";

async function main() {
  console.log(`scoped identity: ${scopedIdentity.toBase58()}`);
  console.log(`bridgePub(0):    ${bridgePub0.toBase58()}`);
  console.log(`bridgeSec(0):    ${bridgeSec0.toBase58()}\n`);

  const er = new Connection(ER_RPC, "confirmed");
  const sigs = await er.getSignaturesForAddress(bridgePub0, { limit: 10 });
  const failed = sigs.find((s) => s.err != null);
  if (!failed) {
    console.log("no failed tx found in the recent signatures");
    return;
  }
  console.log(`dumping failed tx: ${failed.signature}\n`);
  const tx: any = await er.getTransaction(failed.signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) {
    console.log("getTransaction returned null");
    return;
  }
  const msg = tx.transaction.message;
  const keys: PublicKey[] = msg.accountKeys;
  const header = msg.header;
  const flags = (i: number) => {
    const signer = i < header.numRequiredSignatures;
    const writable = signer
      ? i < header.numRequiredSignatures - header.numReadonlySignedAccounts
      : i <
        keys.length - header.numReadonlyUnsignedAccounts;
    return `${signer ? "signer" : "      "}/${writable ? "writable" : "readonly"}`;
  };
  console.log("--- account keys ---");
  keys.forEach((k, i) =>
    console.log(`  [${i}] ${k.toBase58()}  ${flags(i)}  ${label(k)}`)
  );
  const showIx = (ix: any, prefix: string) => {
    const prog = keys[ix.programIdIndex];
    const accts = (ix.accounts as number[])
      .map((ai) => `[${ai}] ${keys[ai].toBase58()} ${label(keys[ai])}`)
      .join(", ");
    const data = Buffer.from(bs58.decode(ix.data));
    console.log(
      `${prefix} program=${prog.toBase58()} ${label(prog)}\n${prefix}   accounts: ${accts}\n${prefix}   data (${data.length} B): ${data.toString("hex")}`
    );
  };
  console.log("--- top-level instructions ---");
  msg.instructions.forEach((ix: any, i: number) => showIx(ix, `  ix${i}:`));
  console.log("--- inner instructions ---");
  for (const inner of tx.meta?.innerInstructions ?? []) {
    inner.instructions.forEach((ix: any, j: number) =>
      showIx(ix, `  inner[${inner.index}].${j}:`)
    );
  }
}

main().catch((e) => {
  console.error("dump failed:", e?.message ?? e);
  process.exit(1);
});
