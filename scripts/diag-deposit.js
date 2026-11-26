// Diagnostic 2: simulate the frontend's deposit+delegate bundle on
// L1 for Nino's wallet via RAW RPC (sigVerify off) and read logs.
const { Connection, PublicKey, Transaction, SystemProgram, Keypair } = require("@solana/web3.js");
const { AnchorProvider, Program, Wallet, BN } = require("@coral-xyz/anchor");
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const fs = require("fs");

const OWNER = new PublicKey("JBisoawJvCfS59DU4Dyzfy9P5KnBhhrLx5KEUh6AGvef");
const L1 = "https://api.devnet.solana.com";
const MINT = new PublicKey("4GP8vbT9hrHfMmoJnfXeErFAAEL54UPfSRqZXC4Q79pi");
const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/abyss_bridge.json", "utf8"));
const PROGRAM_ID = new PublicKey(idl.address);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const player = pda([Buffer.from("player"), OWNER.toBuffer()]);
const vaultCfg = pda([Buffer.from("vault_cfg")]);
const bufferPlayer = PublicKey.findProgramAddressSync([Buffer.from("buffer"), player.toBuffer()], PROGRAM_ID)[0];
const recordPlayer = PublicKey.findProgramAddressSync([Buffer.from("delegation"), player.toBuffer()], DELEGATION_PROGRAM)[0];
const metaPlayer = PublicKey.findProgramAddressSync([Buffer.from("delegation-metadata"), player.toBuffer()], DELEGATION_PROGRAM)[0];

async function simRaw(conn, tx, label) {
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = OWNER;
  const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const res = await fetch(L1, {
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
  const conn = new Connection(L1, "confirmed");
  const prog = new Program(idl, new AnchorProvider(conn, new Wallet(Keypair.generate()), { commitment: "confirmed" }));
  const session = Keypair.generate().publicKey;
  const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
  const userAta = getAssociatedTokenAddressSync(MINT, OWNER);
  const vaultAta = getAssociatedTokenAddressSync(MINT, vaultCfg, true);

  const depositIx = await prog.methods
    .deposit(new BN(10_000_000), session, expiry)
    .accounts({
      owner: OWNER, player, vaultCfg, usdcMint: MINT, userAta, vaultAta,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .instruction();

  const delegateIx = await prog.methods
    .delegatePlayer(VALIDATOR)
    .accounts({
      payer: OWNER, bufferPlayer, delegationRecordPlayer: recordPlayer,
      delegationMetadataPlayer: metaPlayer, player, ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM, systemProgram: SystemProgram.programId,
    })
    .instruction();

  await simRaw(conn, new Transaction().add(depositIx), "deposit ONLY");
  await simRaw(conn, new Transaction().add(depositIx, delegateIx), "deposit + delegate (frontend bundle)");
}

main().catch((e) => { console.error(e); process.exit(1); });
