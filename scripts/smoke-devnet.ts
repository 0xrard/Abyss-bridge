// Abyss Bridge — live devnet smoke test (Batch 3).
//
//   npx ts-node scripts/smoke-devnet.ts [--validator <PUBKEY>]
//
// Runs the full player journey against the deployed program with a
// throwaway test wallet (persisted in scripts/.devnet-state.json,
// gitignored): deposit + delegate in ONE L1 tx -> enter -> step ->
// cash out on the ER with a native session key (zero extra signers)
// -> commit + undelegate -> withdraw_l1 on L1. Requires
// scripts/setup-devnet.ts to have completed first (mint + bridges).
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const L1_RPC = process.env.L1_RPC_URL || "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC_URL || "https://devnet-as.magicblock.app";
const DEFAULT_VALIDATOR = "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";
const DELEGATION_PROGRAM = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);
const MAGIC_PROGRAM = new PublicKey(
  "Magic11111111111111111111111111111111111111"
);
const MAGIC_CONTEXT = new PublicKey(
  "MagicContext1111111111111111111111111111111"
);

const STATE_PATH = path.join(__dirname, ".devnet-state.json");
const idl = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "target", "idl", "abyss_bridge.json"),
    "utf8"
  )
);
const PROGRAM_ID = new PublicKey(idl.address);
const state: Record<string, string> = (() => {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
})();
const saveState = () =>
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

const pda = (seeds: (Buffer | Uint8Array)[], program = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, program)[0];
const vaultCfg = pda([Buffer.from("vault_cfg")]);
const economy = pda([Buffer.from("economy")]);
const bridgePub = (d: number) =>
  pda([Buffer.from("bridge_pub"), Buffer.from([d])]);
const bridgeSec = (d: number) =>
  pda([Buffer.from("bridge_sec"), Buffer.from([d])]);
const playerOf = (owner: PublicKey) =>
  pda([Buffer.from("player"), owner.toBuffer()]);
const bufferOf = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), account.toBuffer()],
    PROGRAM_ID
  )[0];
const recordOf = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), account.toBuffer()],
    DELEGATION_PROGRAM
  )[0];
const metadataOf = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), account.toBuffer()],
    DELEGATION_PROGRAM
  )[0];

const log = (m: string) => console.log(`[smoke] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf("--validator");
  // Default: any-validator (null) — TEE-pinned accounts are writable
  // only via the TEE endpoint, which breaks VRF oracle callbacks.
  const validator: PublicKey | null =
    vIdx >= 0 ? new PublicKey(args[vIdx + 1]) : null;
  if (!state.mint) {
    console.error("[smoke] no mint in state — run scripts/setup-devnet.ts first");
    process.exit(2);
  }
  const mint = new PublicKey(state.mint);

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

  let player: Keypair;
  if (state.smokePlayerSecret) {
    player = Keypair.fromSecretKey(
      Uint8Array.from(Buffer.from(state.smokePlayerSecret, "base64"))
    );
  } else {
    player = Keypair.generate();
    state.smokePlayerSecret = Buffer.from(player.secretKey).toString("base64");
    saveState();
  }
  const session = Keypair.generate();
  log(`player ${player.publicKey.toBase58()} · session ${session.publicKey.toBase58()}`);

  const l1 = new Connection(L1_RPC, "confirmed");
  const er = new Connection(ER_RPC, "confirmed");
  const l1Program = new Program(
    idl,
    new AnchorProvider(l1, new Wallet(player), { commitment: "confirmed" })
  );
  const erSession = new Program(
    idl,
    new AnchorProvider(er, new Wallet(session), { commitment: "confirmed" })
  );
  const playerPdaAddr = playerOf(player.publicKey);

  // Fund the player: SOL (airdrop, best effort) + Mock USDC (mint).
  const sol = await l1.getBalance(player.publicKey);
  if (sol < 0.3 * LAMPORTS_PER_SOL) {
    try {
      const sig = await l1.requestAirdrop(player.publicKey, LAMPORTS_PER_SOL);
      await l1.confirmTransaction(sig, "confirmed");
      log("airdrop 1 SOL ✓");
    } catch (e: any) {
      log(`airdrop failed (${e?.message ?? e}) — deployer will fund`);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: deployer.publicKey,
          toPubkey: player.publicKey,
          lamports: 0.5 * LAMPORTS_PER_SOL,
        })
      );
      await new AnchorProvider(l1, new Wallet(deployer), {}).sendAndConfirm(tx);
      log("funded 0.5 SOL from deployer ✓");
    }
  }
  const playerAta = (
    await getOrCreateAssociatedTokenAccount(l1, deployer, mint, player.publicKey)
  ).address;
  await mintTo(l1, deployer, mint, playerAta, deployer, 20_000_000);
  log("minted 20 Mock USDC to player ✓");

  // Deposit + delegate in ONE L1 transaction (the frontend pattern).
  const vaultAta = getAssociatedTokenAddressSync(mint, vaultCfg, true);
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const depositIx = await (l1Program.methods as any)
    .deposit(new BN(10_000_000), session.publicKey, new BN(expiry))
    .accounts({
      owner: player.publicKey,
      player: playerPdaAddr,
      vaultCfg,
      usdcMint: mint,
      userAta: playerAta,
      vaultAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const delegateIx = await (l1Program.methods as any)
    .delegatePlayer(validator)
    .accounts({
      payer: player.publicKey,
      bufferPlayer: bufferOf(playerPdaAddr),
      delegationRecordPlayer: recordOf(playerPdaAddr),
      delegationMetadataPlayer: metadataOf(playerPdaAddr),
      player: playerPdaAddr,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const depositSig = await new AnchorProvider(l1, new Wallet(player), {
    commitment: "confirmed",
  }).sendAndConfirm(new Transaction().add(depositIx, delegateIx));
  log(`deposit+delegate (1 tx) ✓ ${depositSig}`);

  // Wait until the ER sees the player, then play on Easy (diff 0).
  let pState: any = null;
  for (let i = 0; i < 20 && !pState; i++) {
    await sleep(2000);
    pState = await (erSession.account as any).playerState
      .fetchNullable(playerPdaAddr)
      .catch(() => null);
  }
  if (!pState) throw new Error("player never appeared in the ER");
  log(`player live in ER · balance ${pState.balance.toNumber() / 1e6} USDC ✓`);

  const gameplay = {
    player: playerPdaAddr,
    owner: player.publicKey,
    signer: session.publicKey,
    economy,
    bridgePub: bridgePub(0),
    bridgeSec: bridgeSec(0),
  };
  await (erSession.methods as any).enterBridge(0).accounts(gameplay).rpc();
  log("enter_bridge (session key) ✓");

  let outcome = "still on bridge";
  for (let step = 0; step < 6; step++) {
    await (erSession.methods as any)
      .stepTile(0)
      .accounts({
        ...gameplay,
        rushBridgeSec: bridgeSec(3),
        rushBridgePub: bridgePub(3),
      })
      .rpc()
      .catch((e: any) => {
        throw new Error(`step ${step} failed: ${e?.message ?? e}`);
      });
    pState = await (erSession.account as any).playerState.fetch(playerPdaAddr);
    log(
      `step ${step + 1}: row ${pState.currentRow} · blind ${pState.blindSteps} · onBridge ${pState.isOnBridge}`
    );
    if (!pState.isOnBridge) {
      outcome =
        pState.fallenPasses > 0 && pState.balance.toNumber() === 0
          ? "fell (pot lost)"
          : "finished / settled";
      break;
    }
    if (pState.blindSteps >= 1) {
      await (erSession.methods as any)
        .cashOut()
        .accounts({
          player: playerPdaAddr,
          owner: player.publicKey,
          signer: session.publicKey,
          economy,
          bridgePub: bridgePub(0),
        })
        .rpc();
      outcome = "cashed out";
      break;
    }
  }
  pState = await (erSession.account as any).playerState.fetch(playerPdaAddr);
  log(`run outcome: ${outcome} · balance ${pState.balance.toNumber() / 1e6} USDC ✓`);

  // Commit + undelegate, then withdraw on L1 (owner signature).
  await (erSession.methods as any)
    .commitAndUndelegatePlayer()
    .accounts({
      payer: session.publicKey,
      owner: player.publicKey,
      player: playerPdaAddr,
      magicProgram: MAGIC_PROGRAM,
      magicContext: MAGIC_CONTEXT,
    })
    .rpc();
  log("commit_and_undelegate_player ✓ — waiting for L1 settlement…");
  await sleep(6000);
  const backOnL1 = await l1.getAccountInfo(playerPdaAddr);
  log(
    `player owner on L1: ${backOnL1?.owner.toBase58()} (program = ${PROGRAM_ID.toBase58()})`
  );

  const finalState: any = await (l1Program.account as any).playerState
    .fetch(playerPdaAddr)
    .catch(() => null);
  if (finalState && finalState.balance.toNumber() > 0) {
    const before = Number(
      (await l1.getTokenAccountBalance(playerAta)).value.amount
    );
    await (l1Program.methods as any)
      .withdrawL1(new BN(finalState.balance.toNumber()))
      .accounts({
        owner: player.publicKey,
        player: playerPdaAddr,
        vaultCfg,
        usdcMint: mint,
        vaultAta,
        userAta: playerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    const after = Number(
      (await l1.getTokenAccountBalance(playerAta)).value.amount
    );
    log(`withdraw_l1 ✓ ATA ${before / 1e6} → ${after / 1e6} USDC`);
  } else {
    log("withdraw skipped (balance 0 after the run — the pot was lost or fully settled)");
  }
  log("SMOKE TEST COMPLETE ✓");
}

main().catch((e) => {
  console.error("[smoke] FAILED:", e?.message ?? e);
  process.exit(1);
});
