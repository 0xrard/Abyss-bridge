use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::anchor::{vrf, vrf_callback};
use ephemeral_vrf_sdk::consts::{DEFAULT_EPHEMERAL_QUEUE, DEFAULT_QUEUE};
use ephemeral_vrf_sdk::instructions::{
    create_request_randomness_ix_const, RequestRandomnessParams,
};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::state::*;

/// Byte-bridge between Anchor's Pubkey and the VRF SDK's compat Pubkey.
fn compat_pubkey(key: &Pubkey) -> ephemeral_vrf_sdk::compat::Pubkey {
    ephemeral_vrf_sdk::compat::Pubkey::new_from_array(key.to_bytes())
}

/// Shared reseed logic for the VRF callback (and, under the local-test
/// feature only, the dev seed helper): install the layout, clear all
/// public per-round state, advance both round ids in sync, clear the
/// pending flag.
fn apply_seed(
    bridge_pub: &mut BridgePublic,
    bridge_sec: &mut BridgeSecret,
    safe_col: [u8; MAX_ROWS],
) -> Result<()> {
    bridge_sec.safe_col = safe_col;
    bridge_pub.reset_round();
    let new_round = bridge_pub
        .round_id
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;
    bridge_pub.round_id = new_round;
    bridge_sec.round_id = new_round;
    bridge_sec.vrf_pending = false;
    bridge_pub.vrf_pending = false; // public mirror (Batch 2 patch)
    Ok(())
}

// ---------------------------------------------------------------------------
// request_bridge_vrf (SPEC.md §5.7) — the ONLY instruction that talks to
// the VRF oracle. Gameplay merely sets BridgeSecret.vrf_pending
// (Batch 1 rule 2).
// ---------------------------------------------------------------------------

#[vrf]
#[derive(Accounts)]
#[instruction(diff: u8)]
pub struct RequestBridgeVrf<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [BRIDGE_PUB_SEED, &[diff]], bump)]
    pub bridge_pub: Account<'info, BridgePublic>,
    #[account(seeds = [BRIDGE_SEC_SEED, &[diff]], bump)]
    pub bridge_sec: Account<'info, BridgeSecret>,

    /// CHECK: address is validated against the known MagicBlock VRF
    /// queues inside the handler.
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

pub fn request_bridge_vrf_handler(mut ctx: Context<RequestBridgeVrf>, diff: u8) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.bridge_sec.vrf_pending, ErrorCode::BridgeSeedPending);

    let queue_key = a.oracle_queue.key();
    require!(
        queue_key.to_bytes() == DEFAULT_QUEUE.to_bytes()
            || queue_key.to_bytes() == DEFAULT_EPHEMERAL_QUEUE.to_bytes(),
        ErrorCode::InvalidOracleQueue
    );

    // Unique caller seed per (bridge, round, slot). NOTE: round_id is
    // u32 (4 bytes) — an earlier version copied it into an 8-byte slice
    // and panicked on the length mismatch before the VRF CPI.
    let clock = Clock::get()?;
    let mut caller_seed = [0u8; 32];
    caller_seed[0] = diff;
    caller_seed[1..5].copy_from_slice(&a.bridge_sec.round_id.to_le_bytes());
    caller_seed[5..13].copy_from_slice(&clock.slot.to_le_bytes());

    // Anchor discriminator of `consume_vrf_randomness`:
    // sha256("global:consume_vrf_randomness")[..8], precomputed.
    const CONSUME_VRF_DISCRIMINATOR: [u8; 8] = [51, 186, 112, 30, 158, 165, 198, 207];
    let callback_discriminator = CONSUME_VRF_DISCRIMINATOR.to_vec();
    let accounts_metas = vec![
        SerializableAccountMeta {
            pubkey: compat_pubkey(&a.bridge_pub.key()),
            is_signer: false,
            is_writable: true,
        },
        SerializableAccountMeta {
            pubkey: compat_pubkey(&a.bridge_sec.key()),
            is_signer: false,
            is_writable: true,
        },
    ];

    let (program_identity, _) =
        Pubkey::find_program_address(&[b"identity"], &crate::ID);
    let ix = create_request_randomness_ix_const(
        RequestRandomnessParams {
            payer: compat_pubkey(&a.payer.key()),
            oracle_queue: compat_pubkey(&queue_key),
            callback_program_id: compat_pubkey(&crate::ID),
            callback_discriminator,
            accounts_metas: Some(accounts_metas),
            caller_seed,
            callback_args: None,
        },
        compat_pubkey(&program_identity),
    );

    a.invoke_signed_vrf(&a.payer.to_account_info(), &ix)?;
    msg!("VRF requested for bridge diff={}", diff);
    Ok(())
}

// ---------------------------------------------------------------------------
// consume_vrf_randomness (SPEC.md §5.7) — VRF callback. The
// #[vrf_callback] macro injects `vrf_program_identity`, a signer bound
// to this program's scoped VRF identity PDA, so only the real VRF
// program can invoke this handler.
// ---------------------------------------------------------------------------

/// Scoped VRF identity PDA for this program:
/// PDA(["identity", crate::ID], VRF_PROGRAM_ID), derived off-chain
/// and pinned here (see ConsumeVrfRandomness for why it is not
/// computed through the SDK macro).
const SCOPED_VRF_IDENTITY: Pubkey =
    pubkey!("6bER7MefkEDrsWYQp3u4j93BWhDpsLg6JVhYHW7o3VVv");

#[derive(Accounts)]
pub struct ConsumeVrfRandomness<'info> {
    // The scoped VRF identity PDA for this program, declared
    // manually with a hardcoded address. The SDK's `#[vrf_callback]`
    // macro injects the same check as
    // `address = Pubkey::new_from_array(scoped_vrf_identity_const(&crate::ID).0)`,
    // but that const-expr constraint makes Anchor 1.2.2's generated
    // try_accounts loop forever in SBF (reproduced + bisected in
    // LiteSVM, 2026-11-25: macro on = full CU burn before the
    // handler; this form = works, wrong signer still rejected).
    #[account(address = SCOPED_VRF_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut, seeds = [BRIDGE_PUB_SEED, &[bridge_pub.diff]], bump)]
    pub bridge_pub: Account<'info, BridgePublic>,
    #[account(
        mut,
        seeds = [BRIDGE_SEC_SEED, &[bridge_pub.diff]],
        bump,
        constraint = bridge_sec.diff == bridge_pub.diff,
    )]
    pub bridge_sec: Account<'info, BridgeSecret>,
}

pub fn consume_vrf_randomness_handler(
    mut ctx: Context<ConsumeVrfRandomness>,
    randomness: [u8; 32],
) -> Result<()> {
    let a = &mut ctx.accounts;
    require!(a.bridge_sec.vrf_pending, ErrorCode::BridgeSeedPending);

    let (cols, rows) = (a.bridge_pub.cols, a.bridge_pub.rows);
    let mut safe_col = [0u8; MAX_ROWS];
    for r in 0..MAX_ROWS {
        if (r as u8) < rows {
            safe_col[r] = randomness[r] % cols;
        }
    }
    apply_seed(&mut a.bridge_pub, &mut a.bridge_sec, safe_col)?;
    msg!(
        "Bridge diff={} reseeded, round {}",
        a.bridge_pub.diff,
        a.bridge_pub.round_id
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// dev_seed_bridge — LOCAL TESTS ONLY. Compiled in exclusively under the
// Cargo feature `local-test`; the default `anchor build` does not
// contain this instruction at all (verified against the shipped IDL).
// ---------------------------------------------------------------------------

#[cfg(feature = "local-test")]
#[derive(Accounts)]
#[instruction(diff: u8)]
pub struct DevSeedBridge<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [BRIDGE_PUB_SEED, &[diff]], bump)]
    pub bridge_pub: Account<'info, BridgePublic>,
    #[account(mut, seeds = [BRIDGE_SEC_SEED, &[diff]], bump)]
    pub bridge_sec: Account<'info, BridgeSecret>,
}

#[cfg(feature = "local-test")]
pub fn dev_seed_bridge_handler(
    mut ctx: Context<DevSeedBridge>,
    diff: u8,
    safe_col: [u8; MAX_ROWS],
) -> Result<()> {
    let a = &mut ctx.accounts;
    let mut layout = [0u8; MAX_ROWS];
    for r in 0..MAX_ROWS {
        if (r as u8) < a.bridge_pub.rows {
            layout[r] = safe_col[r] % a.bridge_pub.cols;
        }
    }
    apply_seed(&mut a.bridge_pub, &mut a.bridge_sec, layout)?;
    msg!("DEV SEED bridge diff={} (local-test build only)", diff);
    Ok(())
}
