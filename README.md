# Abyss Bridge

**Entertainment Finance on a glass bridge.** A real-time, on-chain glass-bridge
game on Solana devnet: step across a bridge of hidden tiles, go blind to grow
your multiplier, cash out before you fall. Gameplay runs inside a MagicBlock
Ephemeral Rollup (zero wallet popups via native session keys), tile layouts are
seeded by VRF, and every fall feeds a shared Event Vault — 70% Reserve /
25% Event / 5% Treasury.

**Live demo: https://abyss-bridge-beige.vercel.app** (Solana **devnet** — play
money only, no real funds are ever involved)

- Program: `Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX` (devnet)
- Mock USDC mint: `4GP8vbT9hrHfMmoJnfXeErFAAEL54UPfSRqZXC4Q79pi` (6 decimals)
- Ephemeral Rollup: `https://devnet-as.magicblock.app` (validator
  `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`)

## The game

- Pick a difficulty: **Easy** 2×6 (max 41.95×), **Normal** 2×8 (max 166.75×),
  **Hard** 3×6 (max 474.20×). Entering a bridge costs **1 Mock USDC**.
- Each row has exactly one safe tile. Step on a safe tile that the bridge has
  already revealed and you advance for free; step where nobody has proven the
  safe tile yet and the step is **blind** — blind steps are what grow your
  payout: `M(c, k) = 1 + 0.65 · (c^k − 1)` for `c` columns and `k` blind steps.
  A blind step only counts on a **strictly untouched row** — if anyone has
  already revealed any tile in that row, the step is not blind.
- **Cash out** any time after at least one blind step to collect
  `entry × multiplier` (capped by the house reserve). Fall, and your entry
  feeds the Event Vault split above.
- **Resurrection Rush:** falls fill a Rush pool. When it triggers, fallen
  players re-enter with passes and race the same bridge; the best rows are
  rewarded from the pool. Rewards are pull-based (`finalize_rush` +
  `claim_rush_reward`) — claim while your account is delegated, *before* you
  withdraw.

## Play it now (judges: follow this order)

1. Install **Phantom** and switch it to **Devnet**
   (Phantom → Settings → Developer Settings → Testnet Mode → Devnet).
2. **Get devnet SOL first.** Your wallet needs a small amount of devnet SOL
   to pay network fees and account rent (≈0.005 SOL per deposit). Go to
   https://faucet.solana.com, paste your wallet address, network **Devnet**,
   and request an airdrop. *Skipping this step is the #1 cause of scary red
   Phantom popups later — the app cannot pay your fees for you.*
3. Open **https://abyss-bridge-beige.vercel.app** and **Connect Wallet**.
4. Click **Get 10 Mock USDC** — the in-app faucet mints 10 play USDC to your
   wallet (the faucet pays its own fees; this step works even with 0 SOL).
5. Set a deposit amount (default 10) and click **Deposit + Delegate** —
   one Phantom popup. This moves your USDC into the game and delegates your
   player account to the Ephemeral Rollup, registering a 12-hour session key.
6. Click **ENTER BRIDGE (1 USDC)** and play with the **1 / 2** (or 1 / 2 / 3)
   buttons. Gameplay is signed by the session key — **zero popups**.
7. **CASH OUT** after ≥1 blind step, or keep walking. When you are done,
   click **Withdraw (owner)** — this commits your state back to L1, waits for
   settlement, and returns your in-game balance to your wallet.

## Troubleshooting

| What you see | Real cause | Fix |
| --- | --- | --- |
| Phantom popup is red: "Failed to simulate", "Not enough SOL", "You don't have enough tokens" | Simulation failed before signing — almost always a balance shortfall, **not** an app bug. Phantom shows these same warnings for every failed simulation. | Check the two balances below; the app also pre-checks and shows a plain-language message before the popup. |
| Error toast mentions "Account is immutable" | Same simulation-failure family: a transaction tried to spend more Mock USDC than the wallet holds, or pay fees with too little SOL. | Deposit ≤ your Mock USDC balance (top up with **Get 10 Mock USDC**), and keep ≥0.01 devnet SOL in the wallet. |
| Deposit amount 10 fails after one full game cycle | A completed cycle returns less than you deposited — the 1 USDC entry fee was spent in the game (deposit 10 → withdraw 9). | Lower the amount to your balance, or click **Get 10 Mock USDC** again. |
| "Faucet mint failed" | The faucet is a dedicated devnet keypair that pays mint fees itself; a transient RPC failure can surface here. | Wait a few seconds and click again. |
| Phantom warns "This domain is new" | Expected for a freshly deployed demo domain. | Safe to proceed — the app is devnet-only and never touches real funds. |
| **Deposit + Delegate** is disabled, note says "Your account is in the rollup" | Your player account is currently delegated to the rollup; L1 deposits are locked by design while delegated. | Click **Withdraw (owner)** to bring the account home to L1, then deposit again. |
| **CASH OUT** is disabled | Cash out requires at least 1 blind step (a payout of exactly 1.00× is not a cash-out). If the bridge was re-seeded mid-run, the button becomes **REFUND ($1.00)** instead — your entry is safe. | Take one blind step, or use REFUND on a stale round. |
| **Withdraw (owner)** seems to do nothing | With a 0 in-game balance and no active delegation there is nothing to move — your USDC is already in your wallet. | Check your wallet balance; deposit to play again. |

## How it works

- **L1 (Solana devnet)** holds the vault and settles everything:
  `VaultConfig` + its USDC vault ATA, and the player lifecycle endpoints
  `deposit` / `withdraw_l1`.
- **MagicBlock Ephemeral Rollup** runs the game at session-key speed.
  `deposit` + `delegate_player` are bundled into **one L1 transaction**;
  gameplay instructions (`enter_bridge`, `step_tile`, `cash_out`,
  `finalize_rush`, `claim_rush_reward`, …) execute on the ER against the
  delegated accounts; `commit_and_undelegate` settles state back to L1.
  A delegated account is writable **only** on its own validator's endpoint —
  every client (including the VRF oracle) talks to `devnet-as`.
- **State split:** `BridgePublic` (round id, VRF pending flag, revealed
  tiles — safe for anyone to read), `BridgeSecret` (the round's safe column
  per row), `GlobalEconomy` (reserve / event / treasury balances, Rush
  state), `PlayerState` (balance, position, blind steps, native session key
  + expiry).
- **VRF:** stepping onto an unrevealed bridge requests a reseed from the
  Ephemeral VRF oracle; the callback writes the new layout into
  `BridgeSecret` and bumps the round. Play pauses cleanly while
  `vrf_pending` is set.
- **Session keys:** the browser generates an ephemeral keypair per wallet,
  registered on `PlayerState` at deposit time with a 12-hour expiry. The
  owner wallet can always act; the session key can only play.

### A note on privacy (PER)

The frontend **never reads `BridgeSecret`** — it fetches only
`BridgePublic`, `GlobalEconomy` and `PlayerState`, so the hidden layout is
never rendered or leaked through the UI. In this devnet deployment the
separation is architectural: the legacy permission layer does not yet hide
`BridgeSecret` bytes from a raw RPC read. Migrating `BridgeSecret` to
MagicBlock **Ephemeral Permissions** (authenticated reads on the TEE
endpoint) is the planned next step after the hackathon; the account split
was designed for exactly that migration.

## Repository layout

- `programs/abyss-bridge/` — the Anchor program (23 instructions).
- `app/` — the Next.js frontend (this is what is deployed to Vercel).
- `scripts/` — bootstrap, validator migration, smoke tests, faucet keypair
  tooling.
- `SPEC.md` — the design specification the build follows.

## Run it locally

```bash
cd app
cp .env.local.example .env.local   # fill in the faucet secret (see below)
npm install
npm run dev
```

Environment (see `app/.env.local.example` for the full list): the
`NEXT_PUBLIC_*` values point the client at devnet + the Asia ER validator;
`FAUCET_KEYPAIR_SECRET` is a **server-only** base64 secret of a dedicated
devnet keypair that holds the Mock USDC mint authority — it must never be a
wallet that holds anything of value, and on Vercel it should be stored as a
**Sensitive** variable.

## Verification

- Local program test suite: 16/16 passing; TypeScript e2e (LiteSVM): 13/13.
- Live devnet smoke test (25 Nov 2026): deposit+delegate in one transaction
  → session-key gameplay on the ER → cash out at exactly 1.65× for one blind
  step → settle to L1 → withdraw, token balances reconciled to the cent.
- Production verification (26 Nov 2026): a brand-new wallet ran the full
  cycle on the Vercel deployment — faucet → deposit+delegate → enter bridge
  (entry fee paid) → undelegate/settle → withdraw — all confirmed on-chain.
