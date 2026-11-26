// Diagnostic 3: simulate commit_and_undelegate_player on AS via RAW
// RPC for Nino's wallet in 3 shapes and read the logs.
const { Connection, PublicKey, Transaction, Keypair } = require("@solana/web3.js");
const { AnchorProvider, Program, Wallet } = require("@coral-xyz/anchor");
const fs = require("fs");

const OWNER = new PublicKey("JBisoawJvCfS59DU4Dyzfy9P5KnBhhrLx5KEUh6AGvef");
const AS = "https://devnet-as.magicblock.app";
const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/abyss_bridge.json", "utf8"));
const PROGRAM_ID = new PublicKey(idl.address);
const player = PublicKey.findProgramAddressSync([Buffer.from("player"), OWNER.toBuffer()], PROGRAM_ID)[0];

async function simRaw(tx, feePayer, label) {
  const conn = new Connection(AS, "confirmed");
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = feePayer;
  const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const res = await fetch(AS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "simulateTransaction",
      params: [b64, { sigVerify: false, replaceRecentBlockhash: true, encoding: "base64" }],
    }),
  });
  const j = await res.json();
  const v = j.result.value;
  console.log(`\n=== ${label} ===`);
  console.log("err:", JSON.stringify(v.err));
  for (const l of v.logs || []) console.log("  ", l);
}

async function main() {
  const conn = new Connection(AS, "confirmed");
  const prog = new Program(idl, new AnchorProvider(conn, new Wallet(Keypair.generate()), { commitment: "confirmed" }));
  const p = await prog.account.playerState.fetchNullable(player);
  console.log("balance:", p.balance.toString(), "· session:", p.sessionKey.toBase58(), "· onBridge:", p.isOnBridge);
  const session = p.sessionKey;

  async function buildIx(payer, flip) {
    const ix = await prog.methods
      .commitAndUndelegatePlayer()
      .accounts({ payer, owner: OWNER, player, magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT })
      .instruction();
    if (flip) for (const k of ix.keys) if (k.pubkey.equals(OWNER)) k.isWritable = true;
    return ix;
  }

  await simRaw(new Transaction().add(await buildIx(session, false)), session, "A: payer=session, owner RO (v1 frontend)");
  await simRaw(new Transaction().add(await buildIx(session, true)), session, "B: payer=session, owner W (v2 patched)");
  await simRaw(new Transaction().add(await buildIx(OWNER, false)), OWNER, "C: payer=owner (script style)");
}

main().catch((e) => { console.error(e); process.exit(1); });
