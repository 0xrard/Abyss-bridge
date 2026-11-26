// One-time setup: create a DEDICATED faucet keypair and transfer
// the Mock USDC mint authority to it, so the key that lives in
// app/.env.local and in Vercel can ONLY mint play-money tokens —
// it is not the deployer (no program upgrade authority).
//
// Run from the repo root on the PC that holds the deployer key:
//   npx tsx scripts/create-faucet-keypair.ts
//
// - New keypair saved to ~/.config/solana/abyss-faucet.json
//   (outside the repo; never commit it, never paste it in chat)
// - Prints the base64 secret for FAUCET_KEYPAIR_SECRET
// - Transfers mint authority deployer -> faucet keypair and
//   verifies the result on-chain
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  createSetAuthorityInstruction,
  getMint,
} from "@solana/spl-token";

const L1_RPC = process.env.L1_RPC_URL || "https://api.devnet.solana.com";
const MINT = new PublicKey(
  process.env.MOCK_USDC_MINT || "4GP8vbT9hrHfMmoJnfXeErFAAEL54UPfSRqZXC4Q79pi"
);
const FAUCET_PATH = path.join(os.homedir(), ".config", "solana", "abyss-faucet.json");

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const deployerPath =
    process.env.ANCHOR_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  const deployer = loadKeypair(deployerPath);
  console.log("deployer:", deployer.publicKey.toBase58());

  const conn = new Connection(L1_RPC, "confirmed");
  const mintInfo = await getMint(conn, MINT);
  if (!mintInfo.mintAuthority || !mintInfo.mintAuthority.equals(deployer.publicKey)) {
    throw new Error(
      `Loaded wallet is NOT the current mint authority (authority: ${mintInfo.mintAuthority?.toBase58()}). Aborting — nothing changed.`
    );
  }
  console.log("mint authority confirmed = deployer ✓");

  let faucet: Keypair;
  if (fs.existsSync(FAUCET_PATH)) {
    faucet = loadKeypair(FAUCET_PATH);
    console.log("reusing existing faucet keypair:", faucet.publicKey.toBase58());
  } else {
    faucet = Keypair.generate();
    fs.mkdirSync(path.dirname(FAUCET_PATH), { recursive: true });
    fs.writeFileSync(FAUCET_PATH, JSON.stringify(Array.from(faucet.secretKey)));
    console.log("faucet keypair created:", faucet.publicKey.toBase58());
    console.log("saved to:", FAUCET_PATH);
  }

  if (mintInfo.mintAuthority.equals(faucet.publicKey)) {
    console.log("mint authority already = faucet keypair — nothing to do.");
  } else {
    const ix = createSetAuthorityInstruction(
      MINT,
      deployer.publicKey,
      AuthorityType.MintTokens,
      faucet.publicKey
    );
    const sig = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(ix),
      [deployer],
      { commitment: "confirmed" }
    );
    console.log("mint authority transferred ✓", sig);
  }

  const after = await getMint(conn, MINT);
  console.log(
    "verified mint authority:",
    after.mintAuthority?.toBase58(),
    after.mintAuthority?.equals(faucet.publicKey) ? "✓" : "✗ MISMATCH"
  );

  console.log("\n=== FAUCET_KEYPAIR_SECRET (paste into app/.env.local AND Vercel) ===");
  console.log(Buffer.from(faucet.secretKey).toString("base64"));
  console.log("=== end ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
