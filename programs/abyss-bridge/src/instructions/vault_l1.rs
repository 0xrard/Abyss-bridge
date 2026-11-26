use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::anchor::{commit, delegate};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::state::*;

// ---------------------------------------------------------------------------
// deposit (SPEC.md §5.3, deposit half) [L1]
//
// SPEC names a single `deposit_and_delegate`; it is split into `deposit`
// + `delegate_player` because Anchor cannot re-serialize a typed account
// whose ownership moved to the Delegation Program mid-instruction (the
// SDK's #[delegate] macro enforces UncheckedAccount for this reason).
// The client calls the two back-to-back; the UX is identical.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_SEED, owner.key().as_ref()],
        bump
    )]
    pub player: Account<'info, PlayerState>,

    #[account(seeds = [VAULT_CFG_SEED], bump = vault_cfg.bump)]
    pub vault_cfg: Account<'info, VaultConfig>,

    #[account(address = vault_cfg.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    #[account(mut, token::mint = usdc_mint, token::authority = owner)]
    pub user_ata: Account<'info, TokenAccount>,

    #[account(mut, address = vault_cfg.vault_ata)]
    pub vault_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn deposit_handler(
    mut ctx: Context<Deposit>,
    amount: u64,
    session_key: Pubkey,
    session_expiry: i64,
) -> Result<()> {
    // Fresh accounts arrive zeroed; claim ownership on first deposit.
    if ctx.accounts.player.owner == Pubkey::default() {
        ctx.accounts.player.owner = ctx.accounts.owner.key();
    }
    require!(
        ctx.accounts.player.owner == ctx.accounts.owner.key(),
        ErrorCode::Unauthorized
    );

    transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_ata.to_account_info(),
                to: ctx.accounts.vault_ata.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    let player = &mut ctx.accounts.player;
    player.balance = player
        .balance
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    // Native session key registration (Batch 1 rule 1): the owner
    // registers the ephemeral browser keypair here, on L1, so ER
    // gameplay needs no wallet popups until expiry.
    player.session_key = session_key;
    player.session_expiry = session_expiry;
    Ok(())
}

// ---------------------------------------------------------------------------
// delegate_player (SPEC.md §5.3, delegation half) [L1 -> ER]
// ---------------------------------------------------------------------------

#[delegate]
#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: delegated account; validated by seeds, contents handled by the Delegation Program.
    #[account(mut, del, seeds = [PLAYER_SEED, payer.key().as_ref()], bump)]
    pub player: UncheckedAccount<'info>,
}

pub fn delegate_player_handler(
    mut ctx: Context<DelegatePlayer>,
    validator: Option<Pubkey>,
) -> Result<()> {
    let payer_key = ctx.accounts.payer.key();
    ctx.accounts.delegate_player(
        &ctx.accounts.payer,
        &[PLAYER_SEED, payer_key.as_ref()],
        DelegateConfig {
            commit_frequency_ms: 30_000,
            validator,
        },
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// commit_and_undelegate_player (SPEC.md §5.9) [ER -> L1]
// Signer may be the owner OR a live session key (Batch 1 rule 1).
// ---------------------------------------------------------------------------

#[commit]
#[derive(Accounts)]
pub struct CommitAndUndelegatePlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: seed source only; matched against the deserialized
    /// PlayerState.owner inside the handler.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: account being committed/undelegated; validated by seeds and manually deserialized in the handler for authorization.
    #[account(mut, seeds = [PLAYER_SEED, owner.key().as_ref()], bump)]
    pub player: UncheckedAccount<'info>,
}

pub fn commit_and_undelegate_player_handler(
    mut ctx: Context<CommitAndUndelegatePlayer>,
) -> Result<()> {
    // Authorize against the player's stored owner/session key. The
    // account is UncheckedAccount because its ownership is about to
    // move; deserialize manually for the check.
    {
        let data = ctx.accounts.player.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        let state = PlayerState::try_deserialize(&mut slice)?;
        require!(
            state.owner == ctx.accounts.owner.key(),
            ErrorCode::Unauthorized
        );
        state.authorize(&ctx.accounts.payer.key())?;
    }

    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.player.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// withdraw_l1 (SPEC.md §5.9) [L1] — owner signature ONLY (rule 1). Reads
// only PlayerState + VaultConfig; GlobalEconomy is never undelegated
// (Batch 1 rule 4).
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct WithdrawL1<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [PLAYER_SEED, owner.key().as_ref()],
        bump,
        constraint = player.owner == owner.key() @ ErrorCode::Unauthorized
    )]
    pub player: Account<'info, PlayerState>,

    #[account(seeds = [VAULT_CFG_SEED], bump = vault_cfg.bump)]
    pub vault_cfg: Account<'info, VaultConfig>,

    #[account(address = vault_cfg.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    #[account(mut, address = vault_cfg.vault_ata)]
    pub vault_ata: Account<'info, TokenAccount>,

    #[account(mut, token::mint = usdc_mint, token::authority = owner)]
    pub user_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn withdraw_l1_handler(mut ctx: Context<WithdrawL1>, amount: u64) -> Result<()> {
    require!(
        !ctx.accounts.player.is_on_bridge,
        ErrorCode::PlayerOnBridge
    );
    require!(
        amount <= ctx.accounts.player.balance,
        ErrorCode::InsufficientBalance
    );

    let bump = ctx.accounts.vault_cfg.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_CFG_SEED, &[bump]]];
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault_ata.to_account_info(),
                to: ctx.accounts.user_ata.to_account_info(),
                authority: ctx.accounts.vault_cfg.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    let player = &mut ctx.accounts.player;
    player.balance = player
        .balance
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    Ok(())
}
