use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::anchor::{commit, delegate, DelegationProgram};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::state::*;

// ---------------------------------------------------------------------------
// initialize_protocol (SPEC.md §5.1) [L1]
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [VAULT_CFG_SEED],
        bump
    )]
    pub vault_cfg: Account<'info, VaultConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + GlobalEconomy::INIT_SPACE,
        seeds = [ECONOMY_SEED],
        bump
    )]
    pub economy: Account<'info, GlobalEconomy>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_cfg
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = authority
    )]
    pub authority_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_protocol_handler(
    mut ctx: Context<InitializeProtocol>,
    event_target: u64,
    rush_duration_secs: i64,
    initial_house_reserve: u64,
) -> Result<()> {
    if initial_house_reserve > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.authority_ata.to_account_info(),
                    to: ctx.accounts.vault_ata.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            initial_house_reserve,
        )?;
    }

    let vault_cfg = &mut ctx.accounts.vault_cfg;
    vault_cfg.authority = ctx.accounts.authority.key();
    vault_cfg.usdc_mint = ctx.accounts.usdc_mint.key();
    vault_cfg.vault_ata = ctx.accounts.vault_ata.key();
    vault_cfg.bump = ctx.bumps.vault_cfg;

    let economy = &mut ctx.accounts.economy;
    economy.house_reserve_bal = initial_house_reserve;
    economy.event_vault_bal = 0;
    economy.treasury_bal = 0;
    economy.event_target = event_target;
    economy.rush_duration_secs = rush_duration_secs;
    economy.rush_active = false;
    economy.rush_round_id = 0;
    economy.rush_end_ts = 0;
    economy.rush_prize_pool = 0;
    economy.rush_highest_row = 0;
    economy.rush_highest_count = 0;
    economy.rush_finishers_count = 0;
    economy.settled_rush_id = 0;
    economy.settled_winning_row = 0;
    economy.settled_payout_per_winner = 0;

    msg!(
        "Abyss Bridge initialized: house={} target={}",
        initial_house_reserve,
        event_target
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// init_bridges (SPEC.md §5.2) [L1] — initializes all 4 pairs. Delegation is
// a separate step (delegate_* below), executed once; the accounts then
// stay resident in the ER (Batch 1 rule 4).
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitBridges<'info> {
    #[account(mut, constraint = authority.key() == vault_cfg.authority @ ErrorCode::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(seeds = [VAULT_CFG_SEED], bump = vault_cfg.bump)]
    pub vault_cfg: Account<'info, VaultConfig>,

    #[account(init, payer = authority, space = 8 + BridgePublic::INIT_SPACE, seeds = [BRIDGE_PUB_SEED, &[0u8]], bump)]
    pub bridge_pub_0: Account<'info, BridgePublic>,
    #[account(init, payer = authority, space = 8 + BridgeSecret::INIT_SPACE, seeds = [BRIDGE_SEC_SEED, &[0u8]], bump)]
    pub bridge_sec_0: Account<'info, BridgeSecret>,
    #[account(init, payer = authority, space = 8 + BridgePublic::INIT_SPACE, seeds = [BRIDGE_PUB_SEED, &[1u8]], bump)]
    pub bridge_pub_1: Account<'info, BridgePublic>,
    #[account(init, payer = authority, space = 8 + BridgeSecret::INIT_SPACE, seeds = [BRIDGE_SEC_SEED, &[1u8]], bump)]
    pub bridge_sec_1: Account<'info, BridgeSecret>,
    #[account(init, payer = authority, space = 8 + BridgePublic::INIT_SPACE, seeds = [BRIDGE_PUB_SEED, &[2u8]], bump)]
    pub bridge_pub_2: Account<'info, BridgePublic>,
    #[account(init, payer = authority, space = 8 + BridgeSecret::INIT_SPACE, seeds = [BRIDGE_SEC_SEED, &[2u8]], bump)]
    pub bridge_sec_2: Account<'info, BridgeSecret>,
    #[account(init, payer = authority, space = 8 + BridgePublic::INIT_SPACE, seeds = [BRIDGE_PUB_SEED, &[3u8]], bump)]
    pub bridge_pub_3: Account<'info, BridgePublic>,
    #[account(init, payer = authority, space = 8 + BridgeSecret::INIT_SPACE, seeds = [BRIDGE_SEC_SEED, &[3u8]], bump)]
    pub bridge_sec_3: Account<'info, BridgeSecret>,

    pub system_program: Program<'info, System>,
}

fn init_one_bridge(
    public: &mut BridgePublic,
    secret: &mut BridgeSecret,
    diff: u8,
) -> Result<()> {
    let (cols, rows) = difficulty_dims(diff).ok_or(ErrorCode::InvalidDifficulty)?;
    public.diff = diff;
    public.cols = cols;
    public.rows = rows;
    public.round_id = 0;
    public.reset_round();
    secret.diff = diff;
    secret.round_id = 0;
    secret.safe_col = [0; MAX_ROWS];
    // Initial layout comes from VRF: request_bridge_vrf(diff) next.
    // vrf_pending is mirrored on the public account (Batch 2 patch):
    // the frontend reads ONLY BridgePublic once PER locks the secret.
    secret.vrf_pending = true;
    public.vrf_pending = true;
    Ok(())
}

pub fn init_bridges_handler(mut ctx: Context<InitBridges>) -> Result<()> {
    let a = &mut ctx.accounts;
    init_one_bridge(&mut a.bridge_pub_0, &mut a.bridge_sec_0, 0)?;
    init_one_bridge(&mut a.bridge_pub_1, &mut a.bridge_sec_1, 1)?;
    init_one_bridge(&mut a.bridge_pub_2, &mut a.bridge_sec_2, 2)?;
    init_one_bridge(&mut a.bridge_pub_3, &mut a.bridge_sec_3, 3)?;
    msg!("All 4 bridge pairs initialized (VRF pending)");
    Ok(())
}

// ---------------------------------------------------------------------------
// seed_house [L1] — authority top-up of the house reserve.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SeedHouse<'info> {
    #[account(mut, constraint = authority.key() == vault_cfg.authority @ ErrorCode::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(seeds = [VAULT_CFG_SEED], bump = vault_cfg.bump)]
    pub vault_cfg: Account<'info, VaultConfig>,

    #[account(mut, seeds = [ECONOMY_SEED], bump)]
    pub economy: Account<'info, GlobalEconomy>,

    #[account(mut, token::authority = authority)]
    pub authority_ata: Account<'info, TokenAccount>,

    #[account(mut, address = vault_cfg.vault_ata)]
    pub vault_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn seed_house_handler(mut ctx: Context<SeedHouse>, amount: u64) -> Result<()> {
    transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.authority_ata.to_account_info(),
                to: ctx.accounts.vault_ata.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        amount,
    )?;
    let economy = &mut ctx.accounts.economy;
    economy.house_reserve_bal = economy
        .house_reserve_bal
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Delegation contexts (MagicBlock ER). The `#[delegate]` macro injects
// buffer / delegation record / metadata accounts per `del` field and a
// `delegate_<field>` method. Delegated accounts must be UncheckedAccount:
// Anchor cannot re-serialize a typed account whose owner changed
// mid-instruction.
// ---------------------------------------------------------------------------

#[delegate]
#[derive(Accounts)]
pub struct DelegateEconomy<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: delegated account; validated by seeds, contents handled by the Delegation Program.
    #[account(mut, del, seeds = [ECONOMY_SEED], bump)]
    pub economy: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(diff: u8)]
pub struct DelegateBridgePub<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: delegated account; validated by seeds, contents handled by the Delegation Program.
    #[account(mut, del, seeds = [BRIDGE_PUB_SEED, &[diff]], bump)]
    pub bridge_pub: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(diff: u8)]
pub struct DelegateBridgeSec<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: delegated account; validated by seeds, contents handled by the Delegation Program.
    #[account(mut, del, seeds = [BRIDGE_SEC_SEED, &[diff]], bump)]
    pub bridge_sec: UncheckedAccount<'info>,
}

pub fn delegate_economy_handler(
    mut ctx: Context<DelegateEconomy>,
    validator: Option<Pubkey>,
) -> Result<()> {
    ctx.accounts.delegate_economy(
        &ctx.accounts.payer,
        &[ECONOMY_SEED],
        DelegateConfig {
            commit_frequency_ms: 30_000,
            validator,
        },
    )?;
    Ok(())
}

pub fn delegate_bridge_pub_handler(
    mut ctx: Context<DelegateBridgePub>,
    diff: u8,
    validator: Option<Pubkey>,
) -> Result<()> {
    ctx.accounts.delegate_bridge_pub(
        &ctx.accounts.payer,
        &[BRIDGE_PUB_SEED, &[diff]],
        DelegateConfig {
            commit_frequency_ms: 30_000,
            validator,
        },
    )?;
    Ok(())
}

pub fn delegate_bridge_sec_handler(
    mut ctx: Context<DelegateBridgeSec>,
    diff: u8,
    validator: Option<Pubkey>,
) -> Result<()> {
    ctx.accounts.delegate_bridge_sec(
        &ctx.accounts.payer,
        &[BRIDGE_SEC_SEED, &[diff]],
        DelegateConfig {
            commit_frequency_ms: 30_000,
            validator,
        },
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// commit_and_undelegate_* [ER -> L1] — admin migration path: returns
// the shared game accounts to L1 so they can be re-delegated (e.g.
// to a different validator). Added 2026-11-25: the bridges were
// originally delegated to the TEE validator, whose accounts are
// writable ONLY through the TEE endpoint — the VRF oracle delivers
// callbacks on the generic validator, where those accounts are
// immutable replicas, so every callback failed at commit with
// "Account is immutable". Re-delegation target: any-validator.
// Authority: payer must be VaultConfig.authority.
// ---------------------------------------------------------------------------

#[commit]
#[derive(Accounts)]
pub struct CommitAndUndelegateEconomy<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [VAULT_CFG_SEED], bump)]
    pub vault_cfg: Account<'info, VaultConfig>,
    /// CHECK: committed/undelegated by the Magic program; seeds validated.
    #[account(mut, seeds = [ECONOMY_SEED], bump)]
    pub economy: UncheckedAccount<'info>,
}

pub fn commit_and_undelegate_economy_handler(
    mut ctx: Context<CommitAndUndelegateEconomy>,
) -> Result<()> {
    require!(
        ctx.accounts.vault_cfg.authority == ctx.accounts.payer.key(),
        ErrorCode::Unauthorized
    );
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.economy.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[commit]
#[derive(Accounts)]
#[instruction(diff: u8)]
pub struct CommitAndUndelegateBridgePub<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [VAULT_CFG_SEED], bump)]
    pub vault_cfg: Account<'info, VaultConfig>,
    /// CHECK: committed/undelegated by the Magic program; seeds validated.
    #[account(mut, seeds = [BRIDGE_PUB_SEED, &[diff]], bump)]
    pub bridge_pub: UncheckedAccount<'info>,
}

pub fn commit_and_undelegate_bridge_pub_handler(
    mut ctx: Context<CommitAndUndelegateBridgePub>,
    _diff: u8,
) -> Result<()> {
    require!(
        ctx.accounts.vault_cfg.authority == ctx.accounts.payer.key(),
        ErrorCode::Unauthorized
    );
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.bridge_pub.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[commit]
#[derive(Accounts)]
#[instruction(diff: u8)]
pub struct CommitAndUndelegateBridgeSec<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [VAULT_CFG_SEED], bump)]
    pub vault_cfg: Account<'info, VaultConfig>,
    /// CHECK: committed/undelegated by the Magic program; seeds validated.
    #[account(mut, seeds = [BRIDGE_SEC_SEED, &[diff]], bump)]
    pub bridge_sec: UncheckedAccount<'info>,
}

pub fn commit_and_undelegate_bridge_sec_handler(
    mut ctx: Context<CommitAndUndelegateBridgeSec>,
    _diff: u8,
) -> Result<()> {
    require!(
        ctx.accounts.vault_cfg.authority == ctx.accounts.payer.key(),
        ErrorCode::Unauthorized
    );
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.bridge_sec.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

// Referenced so the DelegationProgram type is part of the IDL surface
// the macro expects clients to pass.
#[allow(dead_code)]
fn _delegation_program_type(_: Program<'_, DelegationProgram>) {}
