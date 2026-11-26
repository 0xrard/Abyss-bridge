// Abyss Bridge — idempotent devnet bootstrap (Batch 3).
//
//   npx ts-node scripts/setup-devnet.ts [--validator <PUBKEY>]
//
// Prepares a full devnet deployment in one repeatable command:
// Mock USDC mint -> initialize_protocol -> seed house (2,000 USDC)
// -> init_bridges -> PER permissions on all BridgeSecrets ->
// delegate permissions + economy + bridges to ONE validator
// (default: devnet TEE MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo)
// -> request VRF for all 4 bridges and poll until the layouts land
// -> explicit PER read check -> prints the app env block.
//
// Idempotent: every step checks current chain state first and skips
// work that is already done. Local bookkeeping lives in
// scripts/.devnet-state.json (gitignored). The deployer wallet comes
// from ANCHOR_WALLET or ~/.config/solana/id.json. The program itself
// must already be deployed (anchor deploy --provider.cluster devnet);
// if it is missing the script stops with the exact deploy command.
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
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
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const L1_RPC = process.env.L1_RPC_URL || "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC_URL || "https://devnet-as.magicblock.app";
const TEE_RPC = process.env.TEE_RPC_URL || "https://devnet-tee.magicblock.app";
const DEFAULT_VALIDATOR = "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";
const DELEGATION_PROGRAM = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);
const PERMISSION_PROGRAM = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
);
const VRF_PROGRAM = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);
const VRF_EPHEMERAL_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
);
const SLOT_HASHES = new PublicKey(
  "SysvarS1otHashes111111111111111111111111111"
);

const HOUSE_TARGET = 2_000_000_000; // 2,000 Mock USDC (6 decimals)
const EVENT_TARGET = 1_000_000; // 1 USDC (devnet demo)
const RUSH_DURATION_SECS = 45;

const STATE_PATH = path.join(__dirname, ".devnet-state.json");
const idl = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "target", "idl", "abyss_bridge.json"),
    "utf8"
  )
);
const PROGRAM_ID = new PublicKey(idl.address);

function loadState(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveState(s: Record<string, string>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function loadDeployer(): Keypair {
  const file =
    process.env.ANCHOR_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const pda = (seeds: (Buffer | Uint8Array)[], program = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, program)[0];
const vaultCfg = pda([Buffer.from("vault_cfg")]);
const economy = pda([Buffer.from("economy")]);
const bridgePub = (d: number) =>
  pda([Buffer.from("bridge_pub"), Buffer.from([d])]);
const bridgeSec = (d: number) =>
  pda([Buffer.from("bridge_sec"), Buffer.from([d])]);
const permissionOf = (sec: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("permission:"), sec.toBuffer()],
    PERMISSION_PROGRAM
  )[0];
const bufferOf = (account: PublicKey, ownerProgram: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), account.toBuffer()],
    ownerProgram
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

const log = (msg: string) => console.log(`[setup] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf("--validator");
  // Default delegation target is now any-validator (null): accounts
  // pinned to the TEE validator are writable ONLY via the TEE
  // endpoint, which breaks VRF oracle callbacks (they execute on the
  // generic validator). --validator <PUBKEY> still pins explicitly.
  const validator: PublicKey | null =
    vIdx >= 0 ? new PublicKey(args[vIdx + 1]) : null;
  log(`validator target: ${validator ? validator.toBase58() : "any-validator (null)"}`);

  const deployer = loadDeployer();
  log(`deployer: ${deployer.publicKey.toBase58()}`);
  const l1 = new Connection(L1_RPC, "confirmed");
  const er = new Connection(ER_RPC, "confirmed");
  const wallet = new Wallet(deployer);
  const l1Program = new Program(
    idl,
    new AnchorProvider(l1, wallet, { commitment: "confirmed" })
  );
  const erProgram = new Program(
    idl,
    new AnchorProvider(er, wallet, { commitment: "confirmed" })
  );
  const state = loadState();

  // 1. SOL balance (+ a best-effort airdrop).
  let sol = (await l1.getBalance(deployer.publicKey)) / LAMPORTS_PER_SOL;
  log(`deployer SOL: ${sol.toFixed(3)}`);
  if (sol < 0.5) {
    try {
      const sig = await l1.requestAirdrop(
        deployer.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await l1.confirmTransaction(sig, "confirmed");
      sol = (await l1.getBalance(deployer.publicKey)) / LAMPORTS_PER_SOL;
      log(`airdrop done, SOL: ${sol.toFixed(3)}`);
    } catch (e: any) {
      log(`airdrop failed (${e?.message ?? e}) — continuing with ${sol}`);
    }
  }

  // Program must exist.
  const progInfo = await l1.getAccountInfo(PROGRAM_ID);
  if (!progInfo?.executable) {
    console.error(
      `[setup] program ${PROGRAM_ID.toBase58()} is NOT deployed on devnet.\n` +
        `Deploy first (no Anchor CLI needed):\n` +
        `  solana program deploy target\\deploy\\abyss_bridge.so --program-id target\\deploy\\abyss_bridge-keypair.json --url devnet\n` +
        `(needs ~5 devnet SOL in ${deployer.publicKey.toBase58()})`
    );
    process.exit(2);
  }
  log("program found on devnet ✓");

  // 2. Mock USDC mint (create once, reuse afterwards).
  let mint: PublicKey;
  const knownMint = process.env.MOCK_USDC_MINT || state.mint;
  if (knownMint && (await l1.getAccountInfo(new PublicKey(knownMint)))) {
    mint = new PublicKey(knownMint);
    log(`reusing Mock USDC mint ${mint.toBase58()}`);
  } else {
    mint = await createMint(l1, deployer, deployer.publicKey, null, 6);
    state.mint = mint.toBase58();
    saveState(state);
    log(`created Mock USDC mint ${mint.toBase58()}`);
  }
  const authorityAta = (
    await getOrCreateAssociatedTokenAccount(
      l1,
      deployer,
      mint,
      deployer.publicKey
    )
  ).address;
  const vaultAta = getAssociatedTokenAddressSync(mint, vaultCfg, true);

  const mintIfNeeded = async (micro: number) => {
    const bal = await l1
      .getTokenAccountBalance(authorityAta)
      .then((r) => Number(r.value.amount))
      .catch(() => 0);
    if (bal < micro) {
      await mintTo(
        l1,
        deployer,
        mint,
        authorityAta,
        deployer,
        micro - bal
      );
      log(`minted ${(micro - bal) / 1e6} Mock USDC to deployer ATA`);
    }
  };

  // 3. initialize_protocol (skips if VaultConfig exists).
  if (!(await l1.getAccountInfo(vaultCfg))) {
    await mintIfNeeded(HOUSE_TARGET);
    await (l1Program.methods as any)
      .initializeProtocol(
        new BN(EVENT_TARGET),
        new BN(RUSH_DURATION_SECS),
        new BN(HOUSE_TARGET)
      )
      .accounts({
        authority: deployer.publicKey,
        vaultCfg,
        economy,
        usdcMint: mint,
        vaultAta,
        authorityAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    log("initialize_protocol ✓ (house seeded 2,000 USDC by init)");
  } else {
    log("initialize_protocol — already done, skipped");
  }

  // 4. seed_house top-up to the 2,000 USDC target.
  const eco: any = await (l1Program.account as any).globalEconomy.fetch(
    economy
  );
  const reserve = eco.houseReserveBal.toNumber();
  if (reserve < HOUSE_TARGET) {
    const diff = HOUSE_TARGET - reserve;
    await mintIfNeeded(diff);
    await (l1Program.methods as any)
      .seedHouse(new BN(diff))
      .accounts({
        authority: deployer.publicKey,
        vaultCfg,
        economy,
        authorityAta,
        vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    log(`seed_house topped up ${diff / 1e6} USDC ✓`);
  } else {
    log(`house reserve already ${reserve / 1e6} USDC ✓`);
  }

  // 5. init_bridges.
  if (!(await l1.getAccountInfo(bridgePub(0)))) {
    await (l1Program.methods as any)
      .initBridges()
      .accounts({
        authority: deployer.publicKey,
        vaultCfg,
        bridgePub0: bridgePub(0),
        bridgeSec0: bridgeSec(0),
        bridgePub1: bridgePub(1),
        bridgeSec1: bridgeSec(1),
        bridgePub2: bridgePub(2),
        bridgeSec2: bridgeSec(2),
        bridgePub3: bridgePub(3),
        bridgeSec3: bridgeSec(3),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    log("init_bridges ✓");
  } else {
    log("init_bridges — already done, skipped");
  }

  const isDelegated = async (addr: PublicKey) => {
    const info = await l1.getAccountInfo(addr);
    return !!info && info.owner.equals(DELEGATION_PROGRAM);
  };

  // 6. PER permissions on all four BridgeSecrets (create + delegate).
  for (let d = 0; d < 4; d++) {
    const sec = bridgeSec(d);
    const permission = permissionOf(sec);
    if (!(await l1.getAccountInfo(permission))) {
      await (l1Program.methods as any)
        .createBridgeSecPermission(d)
        .accounts({
          authority: deployer.publicKey,
          vaultCfg,
          bridgeSec: sec,
          permission,
          permissionProgram: PERMISSION_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      log(`PER permission created for BridgeSecret diff ${d} ✓`);
    } else {
      log(`PER permission diff ${d} — already exists`);
    }
    if (!(await isDelegated(permission))) {
      await (l1Program.methods as any)
        .delegateBridgeSecPermission(d)
        .accounts({
          authority: deployer.publicKey,
          vaultCfg,
          bridgeSec: sec,
          permission,
          bufferPermission: bufferOf(permission, PERMISSION_PROGRAM),
          delegationRecordPermission: recordOf(permission),
          delegationMetadataPermission: metadataOf(permission),
          permissionProgram: PERMISSION_PROGRAM,
          delegationProgram: DELEGATION_PROGRAM,
          // The legacy permission account stays pinned to the TEE
          // validator this round (its own migration comes with the
          // ephemeral-permission move); game accounts go any-validator.
          validator: new PublicKey(DEFAULT_VALIDATOR),
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      log(`PER permission delegated (diff ${d}) ✓`);
    } else {
      log(`PER permission diff ${d} — already delegated`);
    }
  }

  // 7. Delegate economy + bridges to the SAME validator.
  if (!(await isDelegated(economy))) {
    await (l1Program.methods as any)
      .delegateEconomy(validator)
      .accounts({
        payer: deployer.publicKey,
        bufferEconomy: bufferOf(economy, PROGRAM_ID),
        delegationRecordEconomy: recordOf(economy),
        delegationMetadataEconomy: metadataOf(economy),
        economy,
        ownerProgram: PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    log("GlobalEconomy delegated ✓");
  }
  for (let d = 0; d < 4; d++) {
    if (!(await isDelegated(bridgePub(d)))) {
      await (l1Program.methods as any)
        .delegateBridgePub(d, validator)
        .accounts({
          payer: deployer.publicKey,
          bufferBridgePub: bufferOf(bridgePub(d), PROGRAM_ID),
          delegationRecordBridgePub: recordOf(bridgePub(d)),
          delegationMetadataBridgePub: metadataOf(bridgePub(d)),
          bridgePub: bridgePub(d),
          ownerProgram: PROGRAM_ID,
          delegationProgram: DELEGATION_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      log(`BridgePublic diff ${d} delegated ✓`);
    }
    if (!(await isDelegated(bridgeSec(d)))) {
      await (l1Program.methods as any)
        .delegateBridgeSec(d, validator)
        .accounts({
          payer: deployer.publicKey,
          bufferBridgeSec: bufferOf(bridgeSec(d), PROGRAM_ID),
          delegationRecordBridgeSec: recordOf(bridgeSec(d)),
          delegationMetadataBridgeSec: metadataOf(bridgeSec(d)),
          bridgeSec: bridgeSec(d),
          ownerProgram: PROGRAM_ID,
          delegationProgram: DELEGATION_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      log(`BridgeSecret diff ${d} delegated ✓`);
    }
  }

  // 8. VRF: request a shuffle for every bridge whose layout is
  //    pending, then poll the PUBLIC mirror until the oracle lands.
  for (let d = 0; d < 4; d++) {
    let pub: any = await (erProgram.account as any).bridgePublic
      .fetch(bridgePub(d))
      .catch(() => null);
    if (!pub) {
      log(`diff ${d}: BridgePublic not visible in ER yet (delegation settling?) — skipping VRF`);
      continue;
    }
    if (pub.vrfPending) {
      await (erProgram.methods as any)
        .requestBridgeVrf(d)
        .accounts({
          payer: deployer.publicKey,
          bridgePub: bridgePub(d),
          bridgeSec: bridgeSec(d),
          oracleQueue: VRF_EPHEMERAL_QUEUE,
          programIdentity: pda([Buffer.from("identity")]),
          vrfProgram: VRF_PROGRAM,
          slotHashes: SLOT_HASHES,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      log(`diff ${d}: VRF requested, waiting for the oracle…`);
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await sleep(3000);
        pub = await (erProgram.account as any).bridgePublic
          .fetch(bridgePub(d))
          .catch(() => pub);
        if (pub && !pub.vrfPending) break;
      }
    }
    log(
      pub && !pub.vrfPending
        ? `diff ${d}: layout live (round ${pub.roundId}) ✓`
        : `diff ${d}: VRF still pending after timeout — the frontend auto-requests on load, or re-run this script`
    );
  }

  // 9. PER verification: public bridge readable, secret hidden.
  const pubCheck: any = await (erProgram.account as any).bridgePublic
    .fetch(bridgePub(0))
    .catch(() => null);
  log(
    pubCheck
      ? `PER check: BridgePublic readable via ER RPC (round ${pubCheck.roundId}) ✓`
      : "PER check: BridgePublic NOT readable via ER RPC ✗"
  );
  for (const [name, conn] of [
    ["ER", er],
    ["TEE", new Connection(TEE_RPC, "confirmed")],
  ] as const) {
    const info = await conn.getAccountInfo(bridgeSec(0)).catch(() => null);
    const visible = !!info && info.data.length >= 22;
    log(
      `PER check: BridgeSecret via ${name} RPC — ${
        visible
          ? `FULL DATA VISIBLE (${info!.data.length} bytes) — investigate!`
          : "hidden / not served ✓"
      }`
    );
  }

  // 10. Env block for app/.env.local + Vercel.
  console.log(`
# ---- Abyss Bridge devnet env (copy into app/.env.local) ----
NEXT_PUBLIC_L1_RPC=${L1_RPC}
NEXT_PUBLIC_ER_RPC=${ER_RPC}
NEXT_PUBLIC_PROGRAM_ID=${PROGRAM_ID.toBase58()}
NEXT_PUBLIC_MOCK_USDC_MINT=${mint.toBase58()}
NEXT_PUBLIC_ER_VALIDATOR=${validator ? validator.toBase58() : ""}
# Server-only (faucet): the mint authority is the deployer wallet.
# FAUCET_KEYPAIR_SECRET=<base64 of the deployer secret key>  (never commit)
MOCK_USDC_MINT=${mint.toBase58()}
L1_RPC_URL=${L1_RPC}
# -------------------------------------------------------------`);
  log("done.");
}

main().catch((e) => {
  console.error("[setup] FAILED:", e?.message ?? e);
  process.exit(1);
});
