// Diagnostic: reproduce the frontend's failing commit_and_undelegate
// for Nino's Testnet wallet and read the REAL simulation logs.
const { Connection, PublicKey, Transaction } = require("@solana/web3.js");
const { AnchorProvider, Program, Wallet } = require("@coral-xyz/anchor");
const { Keypair } = require("@solana/web3.js");
const fs = require("fs");

const OWNER = new PublicKey("JBisoawJvCfS59DU4Dyzfy9P5KnBhhrLx5KEUh6AGvef");
const L1 = "https://api.devnet.solana.com";
const AS = "https://devnet-as.magicblock.app";
const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/abyss_bridge.json", "utf8"));
const PROGRAM_ID = new PublicKey(idl.address);
const playerPda = PublicKey.findProgramAddressSync(
  [Buffer.from("player"), OWNER.toBuffer()],
  PROGRAM_ID
)[0];

async function main() {
  console.log("player PDA:", playerPda.toBase58());
  const l1 = new Connection(L1, "confirmed");
  const info = await l1.getAccountInfo(playerPda);
  console.log("L1 owner of player account:", info ? info.owner.toBase58() : "MISSING");

  const as = new Connection(AS, "confirmed");
  const dummy = new Wallet(Keypair.generate());
  const prog = new Program(idl, new AnchorProvider(as, dummy, { commitment: "confirmed" }));
  const p = await prog.account.playerState.fetchNullable(playerPda);
  if (!p) {
    console.log("PlayerState NOT readable on AS");
    return;
  }
  console.log("balance:", p.balance.toString(), "· fallenPasses:", p.fallenPasses.toString(),
    "· onBridge:", p.isOnBridge, "· sessionKey:", p.sessionKey.toBase58(),
    "· sessionExpiry:", p.sessionExpiry.toString());

  const sessionKey = p.sessionKey;
  async function simulate(label, payer, flipOwnerWritable) {
    const ix = await prog.methods
      .commitAndUndelegatePlayer()
      .accounts({
        payer,
        owner: OWNER,
        player: playerPda,
        magicProgram: MAGIC_PROGRAM,
        magicContext: MAGIC_CONTEXT,
      })
      .instruction();
    if (flipOwnerWritable) {
      for (const k of ix.keys) if (k.pubkey.equals(OWNER)) k.isWritable = true;
    }
    const tx = new Transaction().add(ix);
    tx.feePayer = payer;
    const { blockhash } = await as.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    const sim = await as.simulateTransaction(tx, { sigVerify: false });
    console.log(`\n=== ${label} ===`);
    console.log("err:", JSON.stringify(sim.value.err));
    for (const l of sim.value.logs || []) console.log("  ", l);
  }

  await simulate("A: payer=session, owner read-only (original frontend)", sessionKey, false);
  await simulate("B: payer=session, owner writable (patched frontend)", sessionKey, true);
  await simulate("C: payer=owner (script style)", OWNER, false);
}

main().catch((e) => { console.error(e); process.exit(1); });
