// PER privacy hardening for BridgeSecret (Batch 3).
//
// Flow per bridge (diff 0..3), executed on L1 by the vault authority
// BEFORE the bridge secret is delegated:
//   1. create_bridge_sec_permission — CPI into the MagicBlock
//      Permission Program (ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1)
//      creating a PRIVATE permission for the BridgeSecret PDA
//      (MembersArgs { members: None } = restricted: no member can
//      read the account through the TEE RPC, so `safe_col` stays
//      hidden from public RPCs and player wallets, while the program
//      itself keeps full access inside the ER).
//   2. delegate_bridge_sec_permission — delegates that permission
//      account to the SAME ephemeral validator as everything else
//      (Batch 3 same-validator rule), so the ER enforces it.
//   3. delegate_bridge_sec (admin.rs) — delegates the secret itself.
//
// API verified against ephemeral-rollups-sdk 0.18.0 sources
// (access_control/instructions/{create,delegate}_permission.rs).
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CreatePermissionCpiBuilder, DelegatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{MembersArgs, Permission};
use ephemeral_rollups_sdk::anchor::{DelegationProgram, PermissionProgram};

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::state::{BridgeSecret, VaultConfig};

fn expected_permission_pda(permissioned: &Pubkey) -> Pubkey {
    let (pda, _) = Permission::find_pda(permissioned);
    Pubkey::new_from_array(pda.to_bytes())
}

// ---------------------------------------------------------------------------
// create_bridge_sec_permission (Batch 3) [L1]
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(diff: u8)]
pub struct CreateBridgeSecPermission<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [VAULT_CFG_SEED], bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub vault_cfg: Account<'info, VaultConfig>,
    #[account(seeds = [BRIDGE_SEC_SEED, &[diff]], bump)]
    pub bridge_sec: Account<'info, BridgeSecret>,
    /// CHECK: Permission PDA (["permission:", bridge_sec] under the
    /// Permission Program); the address is validated in the handler
    /// and the account is created by the CPI.
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    pub permission_program: Program<'info, PermissionProgram>,
    pub system_program: Program<'info, System>,
}

pub fn create_bridge_sec_permission_handler(
    ctx: Context<CreateBridgeSecPermission>,
    diff: u8,
) -> Result<()> {
    require!(diff <= RUSH_DIFF, ErrorCode::InvalidDifficulty);
    require_keys_eq!(
        ctx.accounts.permission.key(),
        expected_permission_pda(&ctx.accounts.bridge_sec.key()),
        ErrorCode::InvalidPermissionAccount
    );
    let bump = ctx.bumps.bridge_sec;
    let signer_seeds: &[&[u8]] = &[BRIDGE_SEC_SEED, &[diff], &[bump]];
    let permission_program_info = ctx.accounts.permission_program.to_account_info();
    let bridge_sec_info = ctx.accounts.bridge_sec.to_account_info();
    let permission_info = ctx.accounts.permission.to_account_info();
    let authority_info = ctx.accounts.authority.to_account_info();
    let system_info = ctx.accounts.system_program.to_account_info();
    CreatePermissionCpiBuilder::new(&permission_program_info)
        .permissioned_account(&bridge_sec_info)
        .permission(&permission_info)
        .payer(&authority_info)
        .system_program(&system_info)
        // members: None = restricted/private — nobody is granted
        // read access; the layout stays visible only to the program.
        .args(MembersArgs { members: None })
        .invoke_signed(&[signer_seeds])?;
    msg!("PER permission created for BridgeSecret diff {}", diff);
    Ok(())
}

// ---------------------------------------------------------------------------
// delegate_bridge_sec_permission (Batch 3) [L1 -> ER]
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(diff: u8)]
pub struct DelegateBridgeSecPermission<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [VAULT_CFG_SEED], bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub vault_cfg: Account<'info, VaultConfig>,
    #[account(seeds = [BRIDGE_SEC_SEED, &[diff]], bump)]
    pub bridge_sec: Account<'info, BridgeSecret>,
    /// CHECK: Permission PDA; validated in the handler.
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Delegation buffer PDA (["buffer", permission] under the
    /// Permission Program, the permission account's owner program).
    #[account(mut)]
    pub buffer_permission: UncheckedAccount<'info>,
    /// CHECK: Delegation record PDA (["delegation", permission] under
    /// the Delegation Program).
    #[account(mut)]
    pub delegation_record_permission: UncheckedAccount<'info>,
    /// CHECK: Delegation metadata PDA (["delegation-metadata",
    /// permission] under the Delegation Program).
    #[account(mut)]
    pub delegation_metadata_permission: UncheckedAccount<'info>,
    pub permission_program: Program<'info, PermissionProgram>,
    pub delegation_program: Program<'info, DelegationProgram>,
    /// CHECK: target validator (optional). Must match the validator
    /// every other account is delegated to (same-validator rule).
    pub validator: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
}

pub fn delegate_bridge_sec_permission_handler(
    ctx: Context<DelegateBridgeSecPermission>,
    diff: u8,
) -> Result<()> {
    require!(diff <= RUSH_DIFF, ErrorCode::InvalidDifficulty);
    let permission_key = ctx.accounts.permission.key();
    require_keys_eq!(
        permission_key,
        expected_permission_pda(&ctx.accounts.bridge_sec.key()),
        ErrorCode::InvalidPermissionAccount
    );
    let permission_program_id = ctx.accounts.permission_program.key();
    let delegation_program_id = ctx.accounts.delegation_program.key();
    let (buffer, _) = Pubkey::find_program_address(
        &[b"buffer", permission_key.as_ref()],
        &permission_program_id,
    );
    require_keys_eq!(
        ctx.accounts.buffer_permission.key(),
        buffer,
        ErrorCode::InvalidPermissionAccount
    );
    let (record, _) = Pubkey::find_program_address(
        &[b"delegation", permission_key.as_ref()],
        &delegation_program_id,
    );
    require_keys_eq!(
        ctx.accounts.delegation_record_permission.key(),
        record,
        ErrorCode::InvalidPermissionAccount
    );
    let (metadata, _) = Pubkey::find_program_address(
        &[b"delegation-metadata", permission_key.as_ref()],
        &delegation_program_id,
    );
    require_keys_eq!(
        ctx.accounts.delegation_metadata_permission.key(),
        metadata,
        ErrorCode::InvalidPermissionAccount
    );

    let bump = ctx.bumps.bridge_sec;
    let signer_seeds: &[&[u8]] = &[BRIDGE_SEC_SEED, &[diff], &[bump]];
    let permission_program_info = ctx.accounts.permission_program.to_account_info();
    let bridge_sec_info = ctx.accounts.bridge_sec.to_account_info();
    let permission_info = ctx.accounts.permission.to_account_info();
    let authority_info = ctx.accounts.authority.to_account_info();
    let system_info = ctx.accounts.system_program.to_account_info();
    let buffer_info = ctx.accounts.buffer_permission.to_account_info();
    let record_info = ctx.accounts.delegation_record_permission.to_account_info();
    let metadata_info = ctx.accounts.delegation_metadata_permission.to_account_info();
    let delegation_program_info = ctx.accounts.delegation_program.to_account_info();
    let validator_info = ctx
        .accounts
        .validator
        .as_ref()
        .map(|v| v.to_account_info());
    let mut builder = DelegatePermissionCpiBuilder::new(&permission_program_info);
    builder
        .payer(&authority_info)
        // The permissioned account (BridgeSecret PDA) signs via our
        // program's seeds; it is the controlling authority here.
        .authority(&bridge_sec_info, false)
        .permissioned_account(&bridge_sec_info, true)
        .permission(&permission_info)
        .system_program(&system_info)
        .owner_program(&permission_program_info)
        .delegation_buffer(&buffer_info)
        .delegation_record(&record_info)
        .delegation_metadata(&metadata_info)
        .delegation_program(&delegation_program_info)
        .validator(validator_info.as_ref());
    builder.invoke_signed(&[signer_seeds])?;
    msg!("PER permission delegated for BridgeSecret diff {}", diff);
    Ok(())
}
