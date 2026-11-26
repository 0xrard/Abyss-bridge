// Abyss Bridge end-to-end tests (Batch 1).
//
// Runs against LiteSVM (in-process SVM) with a program built under the
// `local-test` Cargo feature, which compiles in `dev_seed_bridge` so
// bridge layouts are deterministic without a VRF oracle. The default
// build (and the shipped IDL) does NOT contain that instruction.
//
// Why LiteSVM instead of `anchor test` + solana-test-validator: this
// sandbox blocks UDP even on loopback, so a validator's gossip/TPU can
// never land transactions here (and Agave 3.x's validator panics on
// its io_uring assertion). LiteSVM needs no sockets at all. See
// tests/litesvm-provider.ts for the Anchor provider shim.
//
// Delegation / commit CPIs are not exercised: the Delegation and
// Magic programs are not loaded into the local SVM. Those paths are
// covered on devnet in Batch 3. Everything else — game logic, native
// session-key auth, the Strict Untouched Row rule, stale-round
// protection, the 70/25/5 loss split and the full Resurrection Rush
// lifecycle — runs for real below.
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
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { Clock, LiteSVM } from "litesvm";
import { LiteSvmProvider } from "./litesvm-provider";

const idl = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "target", "idl", "abyss_bridge.json"), "utf8")
);

// Deterministic SVM clock for the whole suite.
const NOW = 1_764_000_000;

const svm = new LiteSVM();
const authority = Keypair.generate();
const provider = new LiteSvmProvider(svm, new anchor.Wallet(authority));
anchor.setProvider(provider as any);
const program = new Program(idl, provider as any);

const PROGRAM_ID = program.programId;
svm.addProgramFromFile(PROGRAM_ID.toBase58() as any, path.join(process.cwd(), "target", "deploy", "abyss_bridge.so"));
svm.addProgramFromFile(TOKEN_PROGRAM_ID.toBase58() as any, path.join(process.cwd(), "tests", "fixtures", "spl-token.so"));
svm.addProgramFromFile(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() as any, path.join(process.cwd(), "tests", "fixtures", "spl-ata.so"));
svm.airdrop(authority.publicKey.toBase58() as any, BigInt(1_000 * anchor.web3.LAMPORTS_PER_SOL) as any);
svm.setClock(new Clock(0n, BigInt(NOW), 0n, 0n, BigInt(NOW)));

function setUnixTs(ts: number) {
  const c = svm.getClock();
  svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, BigInt(ts)));
}

async function sendIxs(ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const tx = new Transaction().add(...ixs);
  return provider.sendAndConfirm(tx, signers);
}

async function tokenBalance(ata: PublicKey): Promise<number> {
  const info = await provider.connection.getAccountInfo(ata);
  if (!info) return 0;
  return Number((info.data as Buffer).readBigUInt64LE(64));
}

const USDC = 1_000_000;
const ENTRY = 1_000_000;
const HOUSE_SEED = 2_000 * USDC;
const EVENT_TARGET = 1 * USDC;
const RUSH_DURATION = 5; // seconds (devnet demo uses 45)

let mint: PublicKey;
let authorityAta: PublicKey;

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const vaultCfgPda = pda([Buffer.from("vault_cfg")]);
const economyPda = pda([Buffer.from("economy")]);
const bridgePubPda = (diff: number) => pda([Buffer.from("bridge_pub"), Buffer.from([diff])]);
const bridgeSecPda = (diff: number) => pda([Buffer.from("bridge_sec"), Buffer.from([diff])]);
const playerPda = (owner: PublicKey) => pda([Buffer.from("player"), owner.toBuffer()]);
const vaultAta = () => getAssociatedTokenAddressSync(mint, vaultCfgPda, true);

const economy = () => program.account.globalEconomy.fetch(economyPda);
const bridgePub = (d: number) => program.account.bridgePublic.fetch(bridgePubPda(d));
const bridgeSec = (d: number) => program.account.bridgeSecret.fetch(bridgeSecPda(d));

interface Player {
  kp: Keypair;
  session: Keypair;
  ata: PublicKey;
  pda: PublicKey;
}

async function makePlayer(depositUsdc: number, expiry: number = NOW + 3600): Promise<Player> {
  const kp = Keypair.generate();
  const session = Keypair.generate();
  svm.airdrop(kp.publicKey.toBase58() as any, BigInt(2 * anchor.web3.LAMPORTS_PER_SOL) as any);
  const ata = getAssociatedTokenAddressSync(mint, kp.publicKey);
  await sendIxs([
    createAssociatedTokenAccountInstruction(authority.publicKey, ata, kp.publicKey, mint),
  ]);
  if (depositUsdc > 0) {
    await sendIxs([createMintToInstruction(mint, ata, authority.publicKey, depositUsdc)]);
  }
  await program.methods
    .deposit(new BN(depositUsdc), session.publicKey, new BN(expiry))
    .accounts({
      owner: kp.publicKey,
      player: playerPda(kp.publicKey),
      vaultCfg: vaultCfgPda,
      usdcMint: mint,
      userAta: ata,
      vaultAta: vaultAta(),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([kp])
    .rpc();
  return { kp, session, ata, pda: playerPda(kp.publicKey) };
}

const playerState = (p: Player) => program.account.playerState.fetch(p.pda);

function gameplayAccounts(p: Player, diff: number, signer: PublicKey) {
  return {
    player: p.pda,
    owner: p.kp.publicKey,
    signer,
    economy: economyPda,
    bridgePub: bridgePubPda(diff),
    bridgeSec: bridgeSecPda(diff),
  };
}

async function enter(p: Player, diff: number, useSession = true) {
  const signerKp = useSession ? p.session : p.kp;
  return program.methods
    .enterBridge(diff)
    .accounts(gameplayAccounts(p, diff, signerKp.publicKey))
    .signers([signerKp])
    .rpc();
}

async function step(p: Player, col: number, useSession = true) {
  const st: any = await playerState(p);
  const signerKp = useSession ? p.session : p.kp;
  return program.methods
    .stepTile(col)
    .accounts({
      ...gameplayAccounts(p, st.activeDiff, signerKp.publicKey),
      // On the Rush bridge itself these accounts ARE bridgePub/bridgeSec;
      // Anchor rejects duplicate mutable accounts, so pass null there.
      rushBridgeSec: st.activeDiff < 3 ? bridgeSecPda(3) : null,
      rushBridgePub: st.activeDiff < 3 ? bridgePubPda(3) : null,
    })
    .signers([signerKp])
    .rpc();
}

async function cashOut(p: Player, useSession = true) {
  const st: any = await playerState(p);
  const signerKp = useSession ? p.session : p.kp;
  return program.methods
    .cashOut()
    .accounts({
      player: p.pda,
      owner: p.kp.publicKey,
      signer: signerKp.publicKey,
      economy: economyPda,
      bridgePub: bridgePubPda(st.activeDiff),
    })
    .signers([signerKp])
    .rpc();
}

async function seedBridge(diff: number, safeCol: number[]) {
  return program.methods
    .devSeedBridge(diff, safeCol)
    .accounts({
      payer: authority.publicKey,
      bridgePub: bridgePubPda(diff),
      bridgeSec: bridgeSecPda(diff),
    })
    .rpc();
}

// Anchor errors surface to the client as { code, msg }; the codes are
// 6000 + the variant index in programs/abyss-bridge/src/errors.rs.
const ERROR_CODES: Record<string, number> = {
  MathOverflow: 6000,
  Unauthorized: 6001,
  SessionExpired: 6002,
  InvalidDifficulty: 6003,
  InvalidColumn: 6004,
  AlreadyOnBridge: 6005,
  NotOnBridge: 6006,
  BridgeSeedPending: 6007,
  BridgeRoundReset: 6008,
  InsufficientBalance: 6009,
  InsufficientPasses: 6010,
  NoBlindSteps: 6011,
  BridgeFull: 6012,
  RushNotActive: 6013,
  RushStillActive: 6014,
  NotRushWinner: 6015,
  AlreadyClaimed: 6016,
  InvalidOracleQueue: 6017,
  PlayerOnBridge: 6018,
  DevSeedDisabled: 6019,
};

async function expectError(promise: Promise<any>, code: string) {
  try {
    await promise;
  } catch (e: any) {
    const text =
      String(e?.message ?? "") +
      "\n" +
      (Array.isArray(e?.logs) ? e.logs.join("\n") : "") +
      "\n" +
      JSON.stringify(e ?? {});
    const numeric = ERROR_CODES[code];
    const matched =
      text.includes(code) ||
      (numeric !== undefined &&
        (text.includes(`"code":${numeric}`) ||
          text.includes(`Error Number: ${numeric}`)));
    expect(matched, `expected ${code} (${numeric}), got: ${text.slice(0, 300)}`).to.equal(true);
    return;
  }
  throw new Error(`expected error ${code}, but the call succeeded`);
}

describe("abyss-bridge (e2e, LiteSVM)", function () {
  this.timeout(600_000);

  let A: Player, B: Player, C: Player, D: Player;

  before(async () => {
    const mintKp = Keypair.generate();
    mint = mintKp.publicKey;
    const rent = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    await sendIxs(
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
    authorityAta = getAssociatedTokenAddressSync(mint, authority.publicKey);
    await sendIxs([
      createAssociatedTokenAccountInstruction(authority.publicKey, authorityAta, authority.publicKey, mint),
      createMintToInstruction(mint, authorityAta, authority.publicKey, 10_000 * USDC),
    ]);

    await program.methods
      .initializeProtocol(new BN(EVENT_TARGET), new BN(RUSH_DURATION), new BN(HOUSE_SEED))
      .accounts({
        authority: authority.publicKey,
        vaultCfg: vaultCfgPda,
        economy: economyPda,
        usdcMint: mint,
        vaultAta: vaultAta(),
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

    // Deterministic layouts: Easy safe=0, Normal safe=1, Hard safe=2, Rush safe=0.
    await seedBridge(0, [0, 0, 0, 0, 0, 0, 0, 0]);
    await seedBridge(1, [1, 1, 1, 1, 1, 1, 1, 1]);
    await seedBridge(2, [2, 2, 2, 2, 2, 2, 2, 2]);
    await seedBridge(3, [0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("initializes protocol + bridges with devnet defaults", async () => {
    const eco: any = await economy();
    expect(eco.houseReserveBal.toNumber()).to.equal(HOUSE_SEED);
    expect(eco.eventTarget.toNumber()).to.equal(EVENT_TARGET);
    expect(eco.eventVaultBal.toNumber()).to.equal(0);
    expect(await tokenBalance(vaultAta())).to.equal(HOUSE_SEED);
    const b0: any = await bridgePub(0);
    expect(b0.cols).to.equal(2);
    expect(b0.rows).to.equal(6);
    expect(b0.roundId).to.equal(1); // dev seed advanced the round
    const s0: any = await bridgeSec(0);
    expect(s0.vrfPending).to.equal(false);
  });

  it("deposit credits balance and registers the native session key", async () => {
    A = await makePlayer(20 * USDC);
    const st: any = await playerState(A);
    expect(st.balance.toNumber()).to.equal(20 * USDC);
    expect(st.owner.toBase58()).to.equal(A.kp.publicKey.toBase58());
    expect(st.sessionKey.toBase58()).to.equal(A.session.publicKey.toBase58());
  });

  it("rejects a random signer and an expired session key", async () => {
    const stranger = Keypair.generate();
    await expectError(
      program.methods
        .enterBridge(0)
        .accounts(gameplayAccounts(A, 0, stranger.publicKey))
        .signers([stranger])
        .rpc(),
      "Unauthorized"
    );
    const expired = await makePlayer(20 * USDC, NOW - 1); // already expired
    await expectError(enter(expired, 0), "SessionExpired");
    await enter(expired, 0, false); // owner signature still works
    await cashOut(expired, false).catch(() => {}); // may fail (no blind steps); ignore
  });

  it("full blind finish auto-pays 41.95x on Easy", async () => {
    await enter(A, 0, false); // owner signs the entry
    await step(A, 0);
    let st: any = await playerState(A);
    expect(st.blindSteps).to.equal(1);
    for (let i = 0; i < 5; i++) await step(A, 0); // session signs the run
    st = await playerState(A);
    expect(st.isOnBridge).to.equal(false);
    expect(st.balance.toNumber()).to.equal(20 * USDC - ENTRY + 41_950_000);
    const sec: any = await bridgeSec(0);
    expect(sec.vrfPending).to.equal(true); // reset flagged, VRF decoupled
    // Batch 2 mirror: the same flag is readable from BridgePublic —
    // the only account the frontend will ever read (PER-safe).
    const pub0: any = await bridgePub(0);
    expect(pub0.vrfPending).to.equal(true);
    await seedBridge(0, [0, 0, 0, 0, 0, 0, 0, 0]); // round 2
    expect(((await bridgePub(0)) as any).vrfPending).to.equal(false);
  });

  it("Strict Untouched Row: revealed and broken rows do not count", async () => {
    B = await makePlayer(20 * USDC);
    C = await makePlayer(20 * USDC);
    D = await makePlayer(20 * USDC);

    await enter(B, 0);
    await step(B, 0); // untouched -> blind 1
    expect(((await playerState(B)) as any).blindSteps).to.equal(1);

    await enter(C, 0);
    await step(C, 0); // row 0 already revealed by B -> blind stays 0
    expect(((await playerState(C)) as any).blindSteps).to.equal(0);

    const ecoBefore: any = await economy();
    await step(C, 1); // row 1 trap (safe col is 0) -> C falls
    const cState: any = await playerState(C);
    expect(cState.isOnBridge).to.equal(false);
    expect(cState.fallenPasses).to.equal(1);
    const ecoAfter: any = await economy();
    expect(ecoAfter.houseReserveBal.toNumber() - ecoBefore.houseReserveBal.toNumber()).to.equal(700_000);
    expect(ecoAfter.eventVaultBal.toNumber() - ecoBefore.eventVaultBal.toNumber()).to.equal(250_000);
    expect(ecoAfter.treasuryBal.toNumber() - ecoBefore.treasuryBal.toNumber()).to.equal(50_000);

    await enter(D, 0);
    await step(D, 0); // revealed row -> 0
    await step(D, 0); // broken row 1 (safe, but broken_mask != 0) -> 0
    expect(((await playerState(D)) as any).blindSteps).to.equal(0);
    await step(D, 0); // untouched row 2 -> 1
    expect(((await playerState(D)) as any).blindSteps).to.equal(1);
    await cashOut(D);
    expect(((await playerState(D)) as any).balance.toNumber()).to.equal(
      20 * USDC - ENTRY + 1_650_000
    );

    await step(B, 0); // B crosses broken row 1 safely, blind unchanged
    expect(((await playerState(B)) as any).blindSteps).to.equal(1);
    await cashOut(B);
    expect(((await playerState(B)) as any).balance.toNumber()).to.equal(
      20 * USDC - ENTRY + 1_650_000
    );
  });

  it("cash out pays the exact formula amount on Hard (k=3 -> 17.90x)", async () => {
    const E = await makePlayer(20 * USDC);
    await enter(E, 2);
    await step(E, 2);
    await step(E, 2);
    await step(E, 2);
    expect(((await playerState(E)) as any).blindSteps).to.equal(3);
    await cashOut(E);
    expect(((await playerState(E)) as any).balance.toNumber()).to.equal(
      20 * USDC - ENTRY + 17_900_000
    );
  });

  it("stale round: step blocked, cash out pays or refunds in full", async () => {
    const F = await makePlayer(20 * USDC);
    const G = await makePlayer(20 * USDC);
    await enter(F, 1);
    await step(F, 1); // blind 1 on round 1
    await enter(G, 1);
    for (let i = 0; i < 8; i++) await step(G, 1); // G finishes round 1
    // F revealed row 0 first, so only 7 of G's 8 steps were blind:
    // payout = M(2,7) = 83.55x — the shared board working as designed.
    expect(((await playerState(G)) as any).balance.toNumber()).to.equal(
      20 * USDC - ENTRY + 83_550_000
    );
    await seedBridge(1, [1, 1, 1, 1, 1, 1, 1, 1]); // round 2

    await expectError(step(F, 1), "BridgeRoundReset");
    await cashOut(F); // stale but blind >= 1 -> normal payout
    expect(((await playerState(F)) as any).balance.toNumber()).to.equal(
      20 * USDC - ENTRY + 1_650_000
    );

    // Zero-blind stale player gets the full entry fee back.
    const H = await makePlayer(20 * USDC);
    await enter(H, 1); // round 2, never steps
    await enter(A, 1);
    for (let i = 0; i < 8; i++) await step(A, 1); // A finishes round 2
    await seedBridge(1, [1, 1, 1, 1, 1, 1, 1, 1]); // round 3
    await cashOut(H);
    expect(((await playerState(H)) as any).balance.toNumber()).to.equal(20 * USDC);
  });

  it("4 losses trigger Resurrection Rush; finisher claims the pool", async () => {
    // C's fall in the earlier test was loss #1 (event vault = 250_000).
    const fallers: Player[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await makePlayer(20 * USDC);
      await enter(p, 2);
      await step(p, 0); // Hard safe col is 2 -> trap on row 0
      expect(((await playerState(p)) as any).fallenPasses).to.equal(1);
      fallers.push(p);
    }
    let eco: any = await economy();
    expect(eco.rushActive).to.equal(true);
    expect(eco.rushPrizePool.toNumber()).to.equal(EVENT_TARGET);
    expect(eco.eventVaultBal.toNumber()).to.equal(0);
    expect(eco.rushRoundId).to.equal(1);
    expect(eco.treasuryBal.toNumber()).to.equal(4 * 50_000);

    await seedBridge(3, [0, 0, 0, 0, 0, 0, 0, 0]); // rush layout

    // C (1 pass) enters and finishes all 6 rows.
    await enter(C, 3);
    expect(((await playerState(C)) as any).fallenPasses).to.equal(0);
    for (let i = 0; i < 6; i++) await step(C, 0);
    eco = await economy();
    expect(eco.rushFinishersCount).to.equal(1);
    expect(eco.rushHighestRow).to.equal(6);

    // A faller reaches row 3, then falls.
    const p1 = fallers[0];
    await enter(p1, 3);
    await step(p1, 0);
    await step(p1, 0);
    await step(p1, 0);
    await step(p1, 1); // trap at row 3
    expect(((await playerState(p1)) as any).lastRushBestRow).to.equal(3);
    eco = await economy();
    expect(eco.rushFinishersCount).to.equal(1); // no double-count

    // Advance the SVM clock past the rush end and settle.
    setUnixTs(NOW + 10);
    await program.methods
      .finalizeRush()
      .accounts({
        signer: authority.publicKey,
        economy: economyPda,
        rushBridgePub: bridgePubPda(3),
      })
      .rpc();
    eco = await economy();
    expect(eco.rushActive).to.equal(false);
    expect(eco.settledRushId).to.equal(1);
    expect(eco.settledWinningRow).to.equal(6);
    expect(eco.settledPayoutPerWinner.toNumber()).to.equal(EVENT_TARGET);

    // Non-winner cannot claim; the finisher pulls the full pool.
    await expectError(
      program.methods
        .claimRushReward()
        .accounts({
          player: p1.pda,
          owner: p1.kp.publicKey,
          signer: p1.session.publicKey,
          economy: economyPda,
        })
        .signers([p1.session])
        .rpc(),
      "NotRushWinner"
    );
    const cBefore = ((await playerState(C)) as any).balance.toNumber();
    await program.methods
      .claimRushReward()
      .accounts({
        player: C.pda,
        owner: C.kp.publicKey,
        signer: C.session.publicKey, // session key may claim (rule 1)
        economy: economyPda,
      })
      .signers([C.session])
      .rpc();
    expect(((await playerState(C)) as any).balance.toNumber()).to.equal(cBefore + EVENT_TARGET);
    await expectError(
      program.methods
        .claimRushReward()
        .accounts({
          player: C.pda,
          owner: C.kp.publicKey,
          signer: C.session.publicKey,
          economy: economyPda,
        })
        .signers([C.session])
        .rpc(),
      "AlreadyClaimed"
    );

    // Withdraw everything back to C's wallet ATA on L1 (owner only).
    const bal = ((await playerState(C)) as any).balance.toNumber();
    const ataBefore = await tokenBalance(C.ata);
    await program.methods
      .withdrawL1(new BN(bal))
      .accounts({
        owner: C.kp.publicKey,
        player: C.pda,
        vaultCfg: vaultCfgPda,
        usdcMint: mint,
        vaultAta: vaultAta(),
        userAta: C.ata,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([C.kp])
      .rpc();
    expect(((await playerState(C)) as any).balance.toNumber()).to.equal(0);
    expect(await tokenBalance(C.ata)).to.equal(ataBefore + bal);
  });
});
