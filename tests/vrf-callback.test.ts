// VRF callback reproduction (local, LiteSVM).
//
// The devnet oracle callback is perfectly formed (verified by
// scripts/dump-callback-tx.ts: right accounts, order, flags, and the
// exact 40-byte data) yet burns its full CU budget on the ER before
// our handler's first log line. consume_vrf_randomness has never been
// executed in ANY environment — the e2e suite seeds via dev_seed.
// This test executes it locally for the first time: the stub VRF
// program plays the oracle and invoke_signed-CPIs into the callback
// with its scoped identity PDA, byte-for-byte like the real oracle.
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Clock, LiteSVM } from "litesvm";
import { LiteSvmProvider } from "./litesvm-provider";

const idl = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "target", "idl", "abyss_bridge.json"),
    "utf8"
  )
);

const NOW = 1_764_000_000;
const VRF_PROGRAM_ID = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);

const svm = new LiteSVM();
const authority = Keypair.generate();
const provider = new LiteSvmProvider(svm, new anchor.Wallet(authority));
anchor.setProvider(provider as any);
const program = new Program(idl, provider as any);
const PROGRAM_ID = program.programId;

svm.addProgramFromFile(
  PROGRAM_ID.toBase58() as any,
  path.join(process.cwd(), "target", "deploy", "abyss_bridge.so")
);
svm.addProgramFromFile(
  VRF_PROGRAM_ID.toBase58() as any,
  path.join(process.cwd(), "tests", "fixtures", "vrf_stub.so")
);
svm.addProgramFromFile(
  TOKEN_PROGRAM_ID.toBase58() as any,
  path.join(process.cwd(), "tests", "fixtures", "spl-token.so")
);
svm.addProgramFromFile(
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() as any,
  path.join(process.cwd(), "tests", "fixtures", "spl-ata.so")
);
svm.airdrop(
  authority.publicKey.toBase58() as any,
  BigInt(1_000 * anchor.web3.LAMPORTS_PER_SOL) as any
);
svm.setClock(new Clock(0n, BigInt(NOW), 0n, 0n, BigInt(NOW)));

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const vaultCfgPda = pda([Buffer.from("vault_cfg")]);
const economyPda = pda([Buffer.from("economy")]);
const bridgePubPda = (d: number) =>
  pda([Buffer.from("bridge_pub"), Buffer.from([d])]);
const bridgeSecPda = (d: number) =>
  pda([Buffer.from("bridge_sec"), Buffer.from([d])]);
const scopedIdentity = PublicKey.findProgramAddressSync(
  [Buffer.from("identity"), PROGRAM_ID.toBuffer()],
  VRF_PROGRAM_ID
)[0];

const USDC = 1_000_000;

describe("vrf callback (LiteSVM, stub oracle)", function () {
  this.timeout(600_000);

  it("initializes, then the stub oracle fulfills the callback", async () => {
    const mintKp = Keypair.generate();
    const mint = mintKp.publicKey;
    const rent =
      await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const sendTx = async (ixs: any[], signers: Keypair[] = []) =>
      provider.sendAndConfirm(new Transaction().add(...ixs), signers);

    await sendTx(
      [
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: mint,
          space: MINT_SIZE,
          lamports: rent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(mint, 6, authority.publicKey, null),
      ],
      [mintKp]
    );
    const authorityAta = getAssociatedTokenAddressSync(
      mint,
      authority.publicKey
    );
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultCfgPda, true);
    await sendTx([
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        authorityAta,
        authority.publicKey,
        mint
      ),
      createMintToInstruction(mint, authorityAta, authority.publicKey, 10_000 * USDC),
    ]);

    await program.methods
      .initializeProtocol(new BN(1 * USDC), new BN(45), new BN(2_000 * USDC))
      .accounts({
        authority: authority.publicKey,
        vaultCfg: vaultCfgPda,
        economy: economyPda,
        usdcMint: mint,
        vaultAta,
        authorityAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .initBridges()
      .accounts({
        authority: authority.publicKey,
        vaultCfg: vaultCfgPda,
        bridgePub0: bridgePubPda(0),
        bridgeSec0: bridgeSecPda(0),
        bridgePub1: bridgePubPda(1),
        bridgeSec1: bridgeSecPda(1),
        bridgePub2: bridgePubPda(2),
        bridgeSec2: bridgeSecPda(2),
        bridgePub3: bridgePubPda(3),
        bridgeSec3: bridgeSecPda(3),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Bridges are born vrf_pending=true (unseeded), so a healthy
    // callback applies the seed and advances the round. The devnet
    // bug shape was ProgramFailedToComplete with the full budget
    // burned inside try_accounts and no handler log.
    const fulfillIx = new TransactionInstruction({
      programId: VRF_PROGRAM_ID,
      keys: [
        { pubkey: scopedIdentity, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: bridgePubPda(0), isSigner: false, isWritable: true },
        { pubkey: bridgeSecPda(0), isSigner: false, isWritable: true },
      ],
      data: Buffer.from([1]),
    });
    {
      const { getTransactionDecoder } = await import("@solana/kit");
      const { FailedTransactionMetadata } = await import("litesvm");
      svm.expireBlockhash();
      const tx = new Transaction().add(fulfillIx);
      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = svm.latestBlockhash();
      tx.sign(authority);
      const kitTx = getTransactionDecoder().decode(tx.serialize());
      const res: any = svm.sendTransaction(kitTx as any);
      if (res instanceof FailedTransactionMetadata) {
        const meta: any = res.meta();
        console.log(`    fulfill err: ${JSON.stringify(res.err())}`);
        console.log(
          `    computeUnitsConsumed: ${meta.computeUnitsConsumed()}`
        );
        console.log(`    logs:\n${meta.logs().join("\n")}`);
        throw new Error("callback failed — see logs above");
      }
      const sec0: any = await program.account.bridgeSecret.fetch(
        bridgeSecPda(0)
      );
      const pub0: any = await program.account.bridgePublic.fetch(
        bridgePubPda(0)
      );
      console.log(
        `    after callback: round pub ${pub0.roundId} · sec ${sec0.roundId} · pending ${sec0.vrfPending} · safeCol [${sec0.safeCol.slice(0, 6).join(",")}]`
      );
      if (pub0.roundId !== 1 || sec0.vrfPending !== false) {
        throw new Error("callback did not apply the seed");
      }
      // Stub randomness is [7;32]; diff 0 has 2 columns → 7 % 2 = 1.
      if (sec0.safeCol[0] !== 1) {
        throw new Error(`unexpected safeCol[0]: ${sec0.safeCol[0]}`);
      }
    }
  });

  it("rejects a callback signed by anyone but the scoped identity", async () => {
    try {
      await program.methods
        .consumeVrfRandomness(new Array(32).fill(9))
        .accounts({
          vrfProgramIdentity: authority.publicKey,
          bridgePub: bridgePubPda(0),
          bridgeSec: bridgeSecPda(0),
        })
        .rpc();
      throw new Error("unauthorized callback was ACCEPTED");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      console.log(
        `    unauthorized callback rejected: ${msg.split("\n")[0].slice(0, 140)}`
      );
      if (msg.includes("unauthorized callback was ACCEPTED")) throw e;
    }
  });
});
