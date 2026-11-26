use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::state::*;

// ---------------------------------------------------------------------------
// finalize_rush (SPEC.md §5.8 / §3.4) — anyone may call once the Rush
// timer has expired. Settlement is recorded into GlobalEconomy;
// winners pull their share via claim_rush_reward.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FinalizeRush<'info> {
    pub signer: Signer<'info>,

    #[account(mut, seeds = [ECONOMY_SEED], bump)]
    pub economy: Account<'info, GlobalEconomy>,

    #[account(seeds = [BRIDGE_PUB_SEED, &[RUSH_DIFF]], bump)]
    pub rush_bridge_pub: Account<'info, BridgePublic>,
}

pub fn finalize_rush_handler(mut ctx: Context<FinalizeRush>) -> Result<()> {
    let a = &mut ctx.accounts;
    require!(a.economy.rush_active, ErrorCode::RushNotActive);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= a.economy.rush_end_ts, ErrorCode::RushStillActive);

    let economy = &mut a.economy;
    let (winning_row, winner_count) = if economy.rush_finishers_count > 0 {
        (a.rush_bridge_pub.rows, economy.rush_finishers_count)
    } else if economy.rush_highest_count > 0 && economy.rush_highest_row > 0 {
        (economy.rush_highest_row, economy.rush_highest_count)
    } else {
        (0, 0)
    };

    economy.settled_rush_id = economy.rush_round_id;
    if winner_count == 0 {
        // Nobody scored: the whole pool rolls back into the event vault.
        economy.event_vault_bal = economy
            .event_vault_bal
            .checked_add(economy.rush_prize_pool)
            .ok_or(ErrorCode::MathOverflow)?;
        economy.rush_prize_pool = 0;
        economy.settled_winning_row = 0;
        economy.settled_payout_per_winner = 0;
    } else {
        economy.settled_winning_row = winning_row;
        economy.settled_payout_per_winner =
            economy.rush_prize_pool / winner_count as u64;
    }
    economy.rush_active = false;
    msg!(
        "Rush #{} settled: winning_row={} winners={} payout={}",
        economy.settled_rush_id,
        economy.settled_winning_row,
        winner_count,
        economy.settled_payout_per_winner
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// claim_rush_reward (SPEC.md §5.8) — pull-based. Signer may be the
// owner or a live session key (Batch 1 rule 1).
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClaimRushReward<'info> {
    #[account(mut, seeds = [PLAYER_SEED, owner.key().as_ref()], bump)]
    pub player: Account<'info, PlayerState>,
    /// CHECK: seed source only; equality with player.owner is constrained.
    #[account(constraint = owner.key() == player.owner @ ErrorCode::Unauthorized)]
    pub owner: UncheckedAccount<'info>,
    pub signer: Signer<'info>,

    #[account(mut, seeds = [ECONOMY_SEED], bump)]
    pub economy: Account<'info, GlobalEconomy>,
}

pub fn claim_rush_reward_handler(mut ctx: Context<ClaimRushReward>) -> Result<()> {
    let a = &mut ctx.accounts;
    a.player.authorize(&a.signer.key())?;

    let settled = a.economy.settled_rush_id;
    require!(settled != 0, ErrorCode::NotRushWinner);
    require!(
        a.player.rush_claimed_id != settled,
        ErrorCode::AlreadyClaimed
    );
    require!(
        a.player.last_rush_id == settled
            && a.economy.settled_winning_row > 0
            && a.player.last_rush_best_row == a.economy.settled_winning_row,
        ErrorCode::NotRushWinner
    );

    let payout = a.economy.settled_payout_per_winner;
    require!(
        a.economy.rush_prize_pool >= payout,
        ErrorCode::InsufficientBalance
    );
    a.economy.rush_prize_pool -= payout;
    a.player.balance = a
        .player
        .balance
        .checked_add(payout)
        .ok_or(ErrorCode::MathOverflow)?;
    a.player.rush_claimed_id = settled;
    Ok(())
}
