use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::math::calc_capped_payout;
use crate::state::*;

// ---------------------------------------------------------------------------
// Shared settlement helpers
// ---------------------------------------------------------------------------

/// Credit a finished / cashed-out run (money movement only; callers
/// clear `is_on_bridge` and the runner slot). The entry fee was
/// escrowed from the player's balance at `enter_bridge` (the "pot");
/// settlement moves `entry_fee - payout` into the house reserve
/// (negative when the house pays the difference — the 25% solvency
/// cap guarantees the reserve always covers it).
pub fn settle_win(
    economy: &mut GlobalEconomy,
    player: &mut PlayerState,
    bridge_pub: &BridgePublic,
) -> Result<()> {
    let payout = calc_capped_payout(
        ENTRY_FEE,
        bridge_pub.cols,
        player.blind_steps,
        economy.house_reserve_bal,
    )?;
    if payout >= ENTRY_FEE {
        economy.house_reserve_bal = economy
            .house_reserve_bal
            .checked_sub(payout - ENTRY_FEE)
            .ok_or(ErrorCode::MathOverflow)?;
    } else {
        economy.house_reserve_bal = economy
            .house_reserve_bal
            .checked_add(ENTRY_FEE - payout)
            .ok_or(ErrorCode::MathOverflow)?;
    }
    player.balance = player
        .balance
        .checked_add(payout)
        .ok_or(ErrorCode::MathOverflow)?;
    Ok(())
}

/// Rush progress accounting (Batch 1 rule 3): counts each player at
/// most once per improvement of their best row in the current Rush, so
/// `rush_finishers_count` / `rush_highest_count` can never double-count.
pub fn record_rush_progress(
    economy: &mut GlobalEconomy,
    player: &mut PlayerState,
    rows: u8,
) {
    if player.last_rush_id != economy.rush_round_id {
        return;
    }
    let best = player.current_row; // rows completed so far
    if best <= player.last_rush_best_row {
        return;
    }
    player.last_rush_best_row = best;
    if best == rows {
        economy.rush_finishers_count = economy.rush_finishers_count.saturating_add(1);
    }
    if best > economy.rush_highest_row {
        economy.rush_highest_row = best;
        economy.rush_highest_count = 1;
    } else if best == economy.rush_highest_row {
        economy.rush_highest_count = economy.rush_highest_count.saturating_add(1);
    }
}

/// Auto-trigger Resurrection Rush (SPEC.md §3.4) once the event vault
/// reaches its target. Only flags the Rush bridge's VRF reseed — no VRF
/// CPI inside gameplay (Batch 1 rule 2). The pending flag is written
/// to BOTH the secret and its public mirror (Batch 2 patch).
pub fn maybe_trigger_rush(
    economy: &mut GlobalEconomy,
    rush_bridge_sec: &mut BridgeSecret,
    rush_bridge_pub: Option<&mut BridgePublic>,
) -> Result<()> {
    if economy.rush_active || economy.event_vault_bal < economy.event_target {
        return Ok(());
    }
    let now = Clock::get()?.unix_timestamp;
    // Unclaimed leftovers from a previous Rush roll into the new pool.
    economy.rush_prize_pool = economy
        .rush_prize_pool
        .checked_add(economy.event_vault_bal)
        .ok_or(ErrorCode::MathOverflow)?;
    economy.event_vault_bal = 0;
    economy.rush_active = true;
    economy.rush_round_id = economy
        .rush_round_id
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;
    economy.rush_end_ts = now
        .checked_add(economy.rush_duration_secs)
        .ok_or(ErrorCode::MathOverflow)?;
    economy.rush_highest_row = 0;
    economy.rush_highest_count = 0;
    economy.rush_finishers_count = 0;
    rush_bridge_sec.vrf_pending = true;
    if let Some(rush_pub) = rush_bridge_pub {
        rush_pub.vrf_pending = true;
    }
    msg!("Resurrection Rush #{} triggered!", economy.rush_round_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// enter_bridge (SPEC.md §5.4) [ER]
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(diff: u8)]
pub struct EnterBridge<'info> {
    #[account(mut, seeds = [PLAYER_SEED, owner.key().as_ref()], bump)]
    pub player: Account<'info, PlayerState>,
    /// CHECK: seed source only; equality with player.owner is constrained.
    #[account(constraint = owner.key() == player.owner @ ErrorCode::Unauthorized)]
    pub owner: UncheckedAccount<'info>,
    pub signer: Signer<'info>,

    #[account(mut, seeds = [ECONOMY_SEED], bump)]
    pub economy: Account<'info, GlobalEconomy>,

    #[account(mut, seeds = [BRIDGE_PUB_SEED, &[diff]], bump)]
    pub bridge_pub: Account<'info, BridgePublic>,
    #[account(seeds = [BRIDGE_SEC_SEED, &[diff]], bump)]
    pub bridge_sec: Account<'info, BridgeSecret>,
}

pub fn enter_bridge_handler(mut ctx: Context<EnterBridge>, diff: u8) -> Result<()> {
    let a = &mut ctx.accounts;
    a.player.authorize(&a.signer.key())?;
    require!(!a.player.is_on_bridge, ErrorCode::AlreadyOnBridge);
    require!(
        difficulty_dims(diff).is_some(),
        ErrorCode::InvalidDifficulty
    );
    require!(!a.bridge_sec.vrf_pending, ErrorCode::BridgeSeedPending);
    require!(
        a.bridge_sec.round_id == a.bridge_pub.round_id,
        ErrorCode::BridgeSeedPending
    );

    if diff < RUSH_DIFF {
        require!(
            a.player.balance >= ENTRY_FEE,
            ErrorCode::InsufficientBalance
        );
        a.player.balance -= ENTRY_FEE; // escrowed as this run's pot
    } else {
        require!(a.economy.rush_active, ErrorCode::RushNotActive);
        require!(a.player.fallen_passes >= 1, ErrorCode::InsufficientPasses);
        a.player.fallen_passes -= 1; // burn 1 Fallen Pass
        if a.player.last_rush_id != a.economy.rush_round_id {
            a.player.last_rush_id = a.economy.rush_round_id;
            a.player.last_rush_best_row = 0;
        }
    }

    a.player.is_on_bridge = true;
    a.player.active_diff = diff;
    a.player.entry_round_id = a.bridge_pub.round_id;
    a.player.current_row = 0;
    a.player.blind_steps = 0;
    a.bridge_pub.upsert_runner(a.player.owner, 0, 0, 0)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// step_tile (SPEC.md §5.5) [ER] — never calls the VRF CPI; it only sets
// `vrf_pending` and lets request_bridge_vrf do the oracle call (rule 2).
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct StepTile<'info> {
    #[account(mut, seeds = [PLAYER_SEED, owner.key().as_ref()], bump)]
    pub player: Account<'info, PlayerState>,
    /// CHECK: seed source only; equality with player.owner is constrained.
    #[account(constraint = owner.key() == player.owner @ ErrorCode::Unauthorized)]
    pub owner: UncheckedAccount<'info>,
    pub signer: Signer<'info>,

    #[account(mut, seeds = [ECONOMY_SEED], bump)]
    pub economy: Account<'info, GlobalEconomy>,

    #[account(mut, seeds = [BRIDGE_PUB_SEED, &[player.active_diff]], bump)]
    pub bridge_pub: Account<'info, BridgePublic>,
    #[account(mut, seeds = [BRIDGE_SEC_SEED, &[player.active_diff]], bump)]
    pub bridge_sec: Account<'info, BridgeSecret>,
    /// The Rush bridge secret, so a fall can flag its VRF reseed when
    /// the fall triggers Resurrection Rush. Optional: when the player
    /// is ON the Rush bridge (diff == 3) this is the same account as
    /// bridge_sec, and Anchor rejects duplicate mutable accounts —
    /// clients pass None there (the trigger only fires on falls in
    /// modes 0..2 anyway).
    #[account(mut, seeds = [BRIDGE_SEC_SEED, &[RUSH_DIFF]], bump)]
    pub rush_bridge_sec: Option<Account<'info, BridgeSecret>>,
    /// Public mirror of the Rush bridge, kept in sync with
    /// rush_bridge_sec (Batch 2 patch). Optional for the same
    /// duplicate-account reason as rush_bridge_sec.
    #[account(mut, seeds = [BRIDGE_PUB_SEED, &[RUSH_DIFF]], bump)]
    pub rush_bridge_pub: Option<Account<'info, BridgePublic>>,
}

pub fn step_tile_handler(mut ctx: Context<StepTile>, col: u8) -> Result<()> {
    let a = &mut ctx.accounts;
    a.player.authorize(&a.signer.key())?;
    require!(a.player.is_on_bridge, ErrorCode::NotOnBridge);
    // Stale-round protection (rule 3): the bridge was reset by another
    // finisher — stepping is blocked; cash_out remains the exit.
    require!(
        a.player.entry_round_id == a.bridge_pub.round_id,
        ErrorCode::BridgeRoundReset
    );
    require!(col < a.bridge_pub.cols, ErrorCode::InvalidColumn);

    let diff = a.player.active_diff;
    let rows = a.bridge_pub.rows;
    let r = a.player.current_row as usize;
    require!(r < rows as usize, ErrorCode::InvalidColumn);
    let safe_col = a.bridge_sec.safe_col[r];

    if col == safe_col {
        // Safe step. Strict Untouched Row rule (SPEC.md §3.2): the
        // blind step counts ONLY if the row was fully untouched.
        let untouched =
            a.bridge_pub.revealed_safe_col[r] == HIDDEN_COL && a.bridge_pub.broken_mask[r] == 0;
        if untouched {
            a.player.blind_steps += 1;
        }
        a.bridge_pub.revealed_safe_col[r] = col;
        a.player.current_row += 1;

        if diff == RUSH_DIFF {
            record_rush_progress(&mut a.economy, &mut a.player, rows);
        }

        if a.player.current_row >= rows {
            // Finished the bridge.
            if diff < RUSH_DIFF {
                settle_win(&mut a.economy, &mut a.player, &a.bridge_pub)?;
                // Flag the round reset (secret + public mirror);
                // request_bridge_vrf reseeds.
                a.bridge_sec.vrf_pending = true;
                a.bridge_pub.vrf_pending = true;
            }
            // Rush finishers were already counted by
            // record_rush_progress (best row == rows).
            a.player.is_on_bridge = false;
            a.bridge_pub.remove_runner(&a.player.owner);
        } else {
            let (row, blind) = (a.player.current_row, a.player.blind_steps);
            a.bridge_pub.upsert_runner(a.player.owner, row, col, blind)?;
        }
    } else {
        // Trap: glass breaks, run ends.
        a.bridge_pub.broken_mask[r] |= 1 << col;
        a.player.is_on_bridge = false;
        a.bridge_pub.remove_runner(&a.player.owner);

        if diff < RUSH_DIFF {
            // Atomic 70/25/5 loss split of the escrowed pot (§3.3).
            a.economy.house_reserve_bal = a
                .economy
                .house_reserve_bal
                .checked_add(LOSS_HOUSE_AMOUNT)
                .ok_or(ErrorCode::MathOverflow)?;
            a.economy.event_vault_bal = a
                .economy
                .event_vault_bal
                .checked_add(LOSS_EVENT_AMOUNT)
                .ok_or(ErrorCode::MathOverflow)?;
            a.economy.treasury_bal = a
                .economy
                .treasury_bal
                .checked_add(LOSS_TREASURY_AMOUNT)
                .ok_or(ErrorCode::MathOverflow)?;
            a.player.fallen_passes = a.player.fallen_passes.saturating_add(1);
            if let Some(rush_sec) = a.rush_bridge_sec.as_mut() {
                let rush_pub = a.rush_bridge_pub.as_mut().map(|p| &mut **p);
                maybe_trigger_rush(&mut a.economy, rush_sec, rush_pub)?;
            }
        } else {
            record_rush_progress(&mut a.economy, &mut a.player, rows);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// cash_out (SPEC.md §5.6) [ER]
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CashOut<'info> {
    #[account(mut, seeds = [PLAYER_SEED, owner.key().as_ref()], bump)]
    pub player: Account<'info, PlayerState>,
    /// CHECK: seed source only; equality with player.owner is constrained.
    #[account(constraint = owner.key() == player.owner @ ErrorCode::Unauthorized)]
    pub owner: UncheckedAccount<'info>,
    pub signer: Signer<'info>,

    #[account(mut, seeds = [ECONOMY_SEED], bump)]
    pub economy: Account<'info, GlobalEconomy>,

    #[account(mut, seeds = [BRIDGE_PUB_SEED, &[player.active_diff]], bump)]
    pub bridge_pub: Account<'info, BridgePublic>,
}

pub fn cash_out_handler(mut ctx: Context<CashOut>) -> Result<()> {
    let a = &mut ctx.accounts;
    a.player.authorize(&a.signer.key())?;
    require!(a.player.is_on_bridge, ErrorCode::NotOnBridge);
    require!(
        a.player.active_diff < RUSH_DIFF,
        ErrorCode::InvalidDifficulty
    );

    if a.player.entry_round_id != a.bridge_pub.round_id {
        // Stale round (rule 3): never trap the player. With at least
        // one blind step the normal payout applies; with zero, the
        // full entry fee is refunded from the escrowed pot.
        if a.player.blind_steps >= 1 {
            settle_win(&mut a.economy, &mut a.player, &a.bridge_pub)?;
        } else {
            a.player.balance = a
                .player
                .balance
                .checked_add(ENTRY_FEE)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        a.player.is_on_bridge = false;
        a.bridge_pub.remove_runner(&a.player.owner);
        return Ok(());
    }

    require!(a.player.blind_steps >= 1, ErrorCode::NoBlindSteps);
    settle_win(&mut a.economy, &mut a.player, &a.bridge_pub)?;
    a.player.is_on_bridge = false;
    a.bridge_pub.remove_runner(&a.player.owner);
    Ok(())
}
