// VRF dispatch experiment (local, LiteSVM).
//
// Reproduces the devnet failure of `request_bridge_vrf` in a fully
// local SVM: a stub program sits at the real MagicBlock VRF program
// address and simply logs + returns Ok. If our handler's
// `invoke_signed_vrf` CPI dispatches, the stub's marker line appears
// in the logs and the call succeeds. If it fails the same way as
// devnet (ProgramFailedToComplete, no callee log), the bug is in our
// program / macro usage and can be bisected locally.
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
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
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
const EPHEMERAL_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
);
const SLOT_HASHES = new PublicKey(
  "SysvarS1otHashes111111111111111111111111111"
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
// The ephemeral oracle queue as a plain existing account owned by the
// VRF program (our handler only checks its address).
svm.setAccount({
  address: EPHEMERAL_QUEUE.toBase58(),
  lamports: 1_000_000_000n,
  data: new Uint8Array(2048),
  executable: false,
  programAddress: VRF_PROGRAM_ID.toBase58(),
} as any);

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const vaultCfgPda = pda([Buffer.from("vault_cfg")]);
const economyPda = pda([Buffer.from("economy")]);
const bridgePubPda = (d: number) =>
  pda([Buffer.from("bridge_pub"), Buffer.from([d])]);
const bridgeSecPda = (d: number) =>
  pda([Buffer.from("bridge_sec"), Buffer.from([d])]);

const USDC = 1_000_000;

describe("vrf dispatch (LiteSVM, stub VRF program)", function () {
  this.timeout(600_000);

  it("initializes protocol + bridges, then requests VRF", async () => {
    const mintKp = Keypair.generate();
    const mint = mintKp.publicKey;
    const rent =
      await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const { Transaction } = anchor.web3;
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

    const pub0: any = await program.account.bridgePublic.fetch(
      bridgePubPda(0)
    );
    console.log(
      `    bridge 0 after init: round ${pub0.roundId} · vrfPending ${pub0.vrfPending}`
    );

    try {
      const sig = await program.methods
        .requestBridgeVrf(0)
        .accounts({
          payer: authority.publicKey,
          bridgePub: bridgePubPda(0),
          bridgeSec: bridgeSecPda(0),
          oracleQueue: EPHEMERAL_QUEUE,
          programIdentity: pda([Buffer.from("identity")]),
          vrfProgram: VRF_PROGRAM_ID,
          slotHashes: SLOT_HASHES,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`    request_bridge_vrf SUCCEEDED: ${sig}`);
    } catch (e: any) {
      console.log("    request_bridge_vrf FAILED:");
      console.log(String(e?.message ?? e));
      if (Array.isArray(e?.logs)) console.log(e.logs.join("\n"));
    }
  });
});
