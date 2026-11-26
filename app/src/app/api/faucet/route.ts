// Devnet faucet: mints 10 Mock USDC to the requester's ATA.
// The mint authority lives ONLY on the server (FAUCET_KEYPAIR_SECRET,
// base64 secret key — devnet only). When the env is not configured
// the route answers 501 with an explicit explanation instead of
// failing silently; the Mock USDC mint itself is created in Batch 3.
import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

export async function POST(req: NextRequest) {
  const secret = process.env.FAUCET_KEYPAIR_SECRET;
  const mintStr = process.env.MOCK_USDC_MINT;
  if (!secret || !mintStr) {
    return NextResponse.json(
      {
        error:
          "Faucet not configured: set FAUCET_KEYPAIR_SECRET (base64 secret key of the devnet mint authority) and MOCK_USDC_MINT in .env.local. The Mock USDC mint is created in Batch 3.",
      },
      { status: 501 }
    );
  }
  let address: string;
  try {
    ({ address } = await req.json());
    new PublicKey(address);
  } catch {
    return NextResponse.json(
      { error: "Body must be { address: <valid pubkey> }" },
      { status: 400 }
    );
  }
  try {
    const authority = Keypair.fromSecretKey(
      Uint8Array.from(Buffer.from(secret, "base64"))
    );
    const mint = new PublicKey(mintStr);
    const conn = new Connection(
      process.env.L1_RPC_URL || "https://api.devnet.solana.com",
      "confirmed"
    );
    const ata = await getOrCreateAssociatedTokenAccount(
      conn,
      authority,
      mint,
      new PublicKey(address)
    );
    const signature = await mintTo(
      conn,
      authority,
      mint,
      ata.address,
      authority,
      10_000_000
    );
    return NextResponse.json({ signature, amount: 10 });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Faucet mint failed: ${e?.message ?? String(e)}` },
      { status: 500 }
    );
  }
}
