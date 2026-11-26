# Abyss Bridge — Technical Specification (`SPEC.md`)

## 1. Overview
**Abyss Bridge** is a real-time **Entertainment Finance** game on Solana built with the **MagicBlock stack** (Ephemeral Rollups, VRF, Session Keys, and Private Ephemeral Rollups / PER).

Players pay a fixed entry fee to cross a shared glass bridge against an **Autonomous House (Bandar)**. Every fall automatically routes 25% of the stake into a **Global Event Vault** shared across all difficulty modes and mints a non-transferable **Fallen Pass** counter. Once the Event Vault reaches its target, **Resurrection Rush** unlocks—a free-entry timed race exclusively for Fallen Pass holders to split 100% of the Event Vault.

### Design Principles
- **Solo-First, Multiplayer-Ready:** Zero lobby or matchmaking delay. A single player (or hackathon judge) can play immediately, while multiple concurrent players share the exact same live bridge state in sub-second latency.
- **Zero-Popup Arcade Loop:** Deposit USDC once on Solana L1 -> delegate `PlayerState` to MagicBlock ER -> play repeatedly with zero gas/popups using Session Keys -> commit & withdraw back to L1 anytime.
- **Strict State Separation (PER-Ready):** Public board visuals (`BridgePublic`) are strictly separated from hidden safe-tile answers (`BridgeSecret`) so MagicBlock PER / TEE read-permissions can lock `BridgeSecret` without breaking frontend subscriptions.

---

## 2. Monorepo Structure

```text
abyss-bridge/
├── SPEC.md
├── Anchor.toml
├── Cargo.toml
├── package.json
├── programs/
│   └── abyss-bridge/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── constants.rs       # Difficulty configs, BPS math constants, seeds
│           ├── errors.rs          # Custom Anchor error codes
│           ├── math.rs            # Pure integer multiplier & payout cap helpers
│           ├── state.rs           # 5 PDA account structs
│           └── instructions/
│               ├── mod.rs
│               ├── admin.rs       # initialize_protocol, init_bridges, seed_house
│               ├── vault_l1.rs    # deposit_and_delegate, commit_and_withdraw
│               ├── gameplay.rs    # enter_bridge, step_tile, cash_out
│               ├── vrf.rs         # request_bridge_vrf, consume_vrf_randomness
│               └── rush.rs        # finalize_rush, claim_rush_reward
├── tests/
│   ├── math.test.ts               # Unit tests for 3 difficulties, caps, 70/25/5 split
│   └── abyss-bridge.test.ts       # End-to-end ER + VRF + Rush flow tests
└── app/                           # Next.js 14+ (App Router) + Tailwind + Wallet Adapter
    ├── package.json
    └── src/
        ├── app/
        │   └── page.tsx           # Single-viewport main game screen
        ├── components/
        │   ├── TopHud.tsx         # House Reserve, Global Event Vault progress, Fallen Passes
        │   ├── DifficultyTabs.tsx # Easy (2x6) | Normal (2x8) | Hard (3x6) | Rush
        │   ├── GlassBridge.tsx    # Perspective tile grid + glass-shatter animations
        │   ├── RunnerAvatar.tsx   # Minimalist wallet-seeded SVG pawn + floating PnL tag
        │   ├── ControlDeck.tsx    # Jump buttons, Cash Out CTA, Deposit/Withdraw modal
        │   └── DemoBotToggle.tsx  # Devnet Traffic Simulator (2 automated runners)
        ├── hooks/
        │   ├── useMagicBlock.ts   # Dual connection (L1 RPC + ER RPC) + Session Key
        │   └── useBridgeState.ts  # WebSocket account subscriptions
        └── idl/                   # Generated Anchor IDL & TypeScript types
```

---

## 3. Game Rules & Exact Economic Specification

### 3.1 Difficulty Tiers & Global Event Bridge
All three standard difficulties share **one** `GlobalEconomy` Event Vault. A dedicated 4th bridge (`diff = 3`) is reserved for **Resurrection Rush** so standard bridges remain uninterrupted.

| `diff` ID | Name | Grid (`cols × rows`) | Safe Tiles / Row | 1 Blind Step | 3 Blind Steps | Full Blind Max |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| `0` | **Easy** | `2 × 6` | 1 | `1.65x` | `5.55x` | `41.95x` |
| `1` | **Normal** | `2 × 8` | 1 | `1.65x` | `5.55x` | `166.75x` |
| `2` | **Hard** | `3 × 6` | 1 | `2.30x` | `17.90x` | `474.20x` |
| `3` | **Rush** | `2 × 6` | 1 | Event Race | Event Race | Splits 100% Event Pool |

### 3.2 Multiplier Formula & Solvency Cap
- **Token Decimals:** Mock USDC SPL token with `6` decimals (`1_000_000` = `1.00 USDC`).
- **Fixed Entry Fee (Normal Modes `0, 1, 2`):** `ENTRY_FEE = 1_000_000` (`1.00 USDC`).
- **Strict Blind Step Rule:** Stepping safely on row `r` increments `blind_steps += 1` **ONLY IF** row `r` was completely untouched before this step (`revealed_safe_col[r] == 255` AND `broken_mask[r] == 0`). Stepping on a row that already has a revealed safe tile or broken trap still lets the player advance safely to deeper rows, but does **not** increment `blind_steps`.
- **Cash Out Eligibility:** Player must have `blind_steps >= 1` to call `cash_out`.
- **Integer BPS Formula (`math.rs`):**
  ```rust
  // M(c, k) = 1 + 0.65 * (c^k - 1), scaled by 10_000 BPS
  pub fn calc_multiplier_bps(cols: u8, blind_steps: u8) -> Result<u64> {
      if blind_steps == 0 {
          return Ok(10_000);
      }
      let power = (cols as u128)
          .checked_pow(blind_steps as u32)
          .ok_or(ErrorCode::MathOverflow)?;
      let bonus = 6_500u128
          .checked_mul(power - 1)
          .ok_or(ErrorCode::MathOverflow)?;
      let bps = 10_000u128
          .checked_add(bonus)
          .ok_or(ErrorCode::MathOverflow)?;
      Ok(u64::try_from(bps).map_err(|_| ErrorCode::MathOverflow)?)
  }

  pub fn calc_capped_payout(entry_fee: u64, cols: u8, blind_steps: u8, house_reserve: u64) -> Result<u64> {
      let mult_bps = calc_multiplier_bps(cols, blind_steps)? as u128;
      let raw_payout = (entry_fee as u128)
          .checked_mul(mult_bps)
          .ok_or(ErrorCode::MathOverflow)?
          / 10_000u128;
      // Solvency Circuit Breaker: Max single payout = 25% of current House Reserve
      let max_payout = (house_reserve as u128) * 25 / 100;
      let final_payout = raw_payout.min(max_payout);
      Ok(u64::try_from(final_payout).map_err(|_| ErrorCode::MathOverflow)?)
  }
  ```

### 3.3 Loss Split (70 / 25 / 5) & Devnet Defaults
Whenever a player falls in modes `0, 1, 2`, their `1_000_000` stake is split atomically inside `GlobalEconomy`:
- **70% (`700_000`)** -> `house_reserve_bal`
- **25% (`250_000`)** -> `event_vault_bal`
- **5% (`50_000`)** -> `treasury_bal`
- Player receives `fallen_passes += 1`.

**Devnet / Hackathon Demo Parameters (Configurable via `GlobalEconomy`):**
- `house_reserve_seed`: `2_000_000_000` (`2,000 Mock USDC` -> 25% cap = `500 USDC`, safely covering Hard 3×6 max `474.20 USDC`).
- `event_target`: `1_000_000` (`1.00 USDC` = triggered after **4 losses** for live judging; production target = `25_000_000`).
- `rush_duration_secs`: `45` seconds.

### 3.4 Resurrection Rush Rules
1. Triggered automatically inside `step_tile` when `event_vault_bal >= event_target` and `!rush_active`.
2. Snapshots `rush_prize_pool = event_vault_bal`, resets `event_vault_bal = 0`, sets `rush_active = true`, `rush_round_id += 1`, `rush_end_ts = now + rush_duration_secs`, and requests fresh VRF for `diff = 3`.
3. Entry costs `0 USDC` and burns `1` `fallen_passes`. One attempt per player per `rush_round_id` (or re-enterable if they hold extra passes).
4. Anyone (or frontend timer) calls `finalize_rush` once `now >= rush_end_ts`.
5. Winning condition: All players who finished row 6 (`last_rush_row == 6`) split `rush_prize_pool` equally. If zero players finished, all players tied at `rush_highest_row` (> 0) split the pool. If zero players scored, pool rolls back into `event_vault_bal`.
6. Winners call `claim_rush_reward` (pull-based) to credit `PlayerState.balance`.

---

## 4. Account Architecture (5 PDAs)

| Account | Execution Layer | PDA Seeds | Key Fields |
| :--- | :---: | :--- | :--- |
| **`VaultConfig`** | Solana L1 | `["vault_cfg"]` | `authority: Pubkey`, `usdc_mint: Pubkey`, `vault_ata: Pubkey`, `bump: u8` |
| **`GlobalEconomy`** | ER (Delegated) | `["economy"]` | `house_reserve_bal: u64`, `event_vault_bal: u64`, `treasury_bal: u64`, `event_target: u64`, `rush_duration_secs: i64`, `rush_active: bool`, `rush_round_id: u32`, `rush_end_ts: i64`, `rush_prize_pool: u64`, `rush_highest_row: u8`, `rush_highest_count: u16`, `rush_finishers_count: u16`, `settled_rush_id: u32`, `settled_winning_row: u8`, `settled_payout_per_winner: u64` |
| **`BridgePublic`** *(4 PDAs: diff 0..3)* | ER (Delegated) | `["bridge_pub", &[diff]]` | `diff: u8`, `cols: u8`, `rows: u8`, `round_id: u32`, `revealed_safe_col: [u8; 8]` (`255` = hidden), `broken_mask: [u8; 8]` (bitmask per row), `active_runners: [RunnerSlot; 8]` (lightweight visual snapshot: pubkey, row, col, blind_steps, active) |
| **`BridgeSecret`** *(4 PDAs: diff 0..3)* | PER / TEE (Locked) | `["bridge_sec", &[diff]]` | `diff: u8`, `round_id: u32`, `safe_col: [u8; 8]`, `vrf_pending: bool` |
| **`PlayerState`** *(per user)* | L1 <-> ER | `["player", user.key()]` | `owner: Pubkey`, `balance: u64`, `fallen_passes: u16`, `is_on_bridge: bool`, `active_diff: u8`, `entry_round_id: u32`, `current_row: u8`, `blind_steps: u8`, `last_rush_id: u32`, `last_rush_best_row: u8`, `rush_claimed_id: u32` |

---

## 5. Instruction Specification

1. **`initialize_protocol(event_target, rush_duration_secs, initial_house_reserve)` [L1]** — Initializes `VaultConfig`, `GlobalEconomy`, and creates Mock USDC vault ATA (devnet faucet helper allowed).
2. **`init_bridges()` [L1 -> ER/PER]** — Initializes all 4 pairs of `BridgePublic` + `BridgeSecret` (`diff = 0, 1, 2, 3`), triggers initial VRF seed, and delegates `GlobalEconomy`, `BridgePublic`, and `BridgeSecret` to MagicBlock ER/PER.
3. **`deposit_and_delegate(amount)` [L1 -> ER]** — Transfers Mock USDC from user ATA to `VaultConfig.vault_ata`, credits `PlayerState.balance`, and delegates `PlayerState` to MagicBlock ER.
4. **`enter_bridge(diff)` [ER]** — Validates player is not currently on a bridge and `BridgeSecret.vrf_pending == false`. Deducts `1_000_000` (if `diff < 3`) OR burns `1 fallen_passes` (if `diff == 3` and `rush_active`). Places player at `current_row = 0`, `blind_steps = 0`, updates `BridgePublic.active_runners`.
5. **`step_tile(col)` [ER / PER]** — Reads `BridgeSecret.safe_col[current_row]`.
   - **Safe:** Checks untouched row (`revealed_safe_col[r] == 255 && broken_mask[r] == 0`) -> increments `blind_steps`. Sets `revealed_safe_col[r] = col`. Advances `current_row += 1`. If `current_row == rows`: auto-payout (modes `0..2`) or record finisher (mode `3`), mark `is_on_bridge = false`, and request VRF reset for normal bridges.
   - **Trap:** Sets `broken_mask[r] |= (1 << col)`, sets `is_on_bridge = false`. For modes `0..2`: splits `1_000_000` (`70/25/5`), increments `fallen_passes`, and triggers Resurrection Rush if `event_vault_bal >= event_target`. For mode `3`: records best row reached in Rush.
6. **`cash_out()` [ER]** — Allowed only for modes `0..2` when `is_on_bridge && blind_steps >= 1`. Calculates `calc_capped_payout`, transfers from `GlobalEconomy.house_reserve_bal` to `PlayerState.balance`, clears `is_on_bridge`.
7. **`request_bridge_vrf(diff)` & `consume_vrf_randomness(randomness)` [ER / VRF]** — Uses MagicBlock VRF plugin to generate `safe_col[r] = randomness[r] % cols` for `r in 0..rows`, clears `revealed_safe_col` (`[255; 8]`) and `broken_mask` (`[0; 8]`), increments `round_id`, sets `vrf_pending = false`.
8. **`finalize_rush()` & `claim_rush_reward()` [ER]** — Ends expired Rush, computes `settled_payout_per_winner`, and lets eligible winners pull rewards into `PlayerState.balance`.
9. **`commit_and_undelegate_player()` & `withdraw_l1(amount)` [ER -> L1]** — Commits `PlayerState` back to Solana L1 and transfers Mock USDC from `vault_ata` to user's wallet ATA.

---

## 6. Frontend UX & Demo Requirements
- **Single-Viewport Layout (No Scroll):**
  - Top HUD: Live `House Reserve`, animated **Global Event Vault Progress Bar** (`X / 1.00 USDC -> Resurrection Rush!`), and `Fallen Pass` counter.
  - Center Stage: Perspective glass bridge with clickable panels, minimalist neon SVG **Runner Avatars** (color-hashed from wallet pubkey) with parabolic jump animation, floating `multiplier / payout` tags, glass-shatter + subtle screen-shake on fall, and skull/crack markers on broken tiles.
  - Bottom Deck: Difficulty selector (`Easy 2×6`, `Normal 2×8`, `Hard 3×6`, plus glowing `RESURRECTION RUSH` banner when active), quick Jump buttons, prominent green `CASH OUT` CTA, and Devnet Faucet / Deposit / Withdraw controls.
- **Devnet Traffic Simulator (`[Demo Mode: Simulate 2 Bots]`):** Optional toggle clearly labeled *"Devnet Traffic Simulator"* using ephemeral keypairs on devnet that jump on the same shared bridge in real time so a solo judge immediately witnesses shared tile reveals, broken glass, live Event Vault charging, and Resurrection Rush triggering.

---

## 7. Phased Execution Plan (Mandatory Order)
- **Batch 0 (Setup & Verification):** Verify exact compatible versions of Anchor, Solana CLI, and MagicBlock crates (`ephemeral-rollups-sdk`, VRF plugin, PER/permission SDK) against `docs.magicblock.gg`. Scaffold monorepo folders and confirm clean `anchor build`.
- **Batch 1 (Smart Contract + Tests + IDL):** Implement `constants.rs`, `math.rs`, `state.rs`, and all instructions (Phase 1: ER + VRF + Session Keys). Pass unit & integration tests, generate IDL.
- **Batch 2 (Frontend + Simulator):** Build `app/` using generated IDL, MagicBlock dual-RPC + Session Keys, animations, and Demo Bot Simulator.
- **Batch 3 (PER Privacy Hardening & Devnet Polish):** Attach MagicBlock PER read-permissions strictly to `BridgeSecret` PDAs, deploy to devnet, seed House Reserve with 2,000 Mock USDC, and verify full E2E demo flow.
