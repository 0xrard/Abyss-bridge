use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX");

// Abyss Bridge — Batch 1: full SPEC.md §5 instruction set.
// `#[ephemeral]` injects the MagicBlock `process_undelegation` handler.
#[ephemeral]
#[program]
pub mod abyss_bridge {
    use super::*;

    // --- Admin (admin.rs) -------------------------------------------------
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        event_target: u64,
        rush_duration_secs: i64,
        initial_house_reserve: u64,
    ) -> Result<()> {
        instructions::admin::initialize_protocol_handler(
            ctx,
            event_target,
            rush_duration_secs,
            initial_house_reserve,
        )
    }

    pub fn init_bridges(ctx: Context<InitBridges>) -> Result<()> {
        instructions::admin::init_bridges_handler(ctx)
    }

    pub fn seed_house(ctx: Context<SeedHouse>, amount: u64) -> Result<()> {
        instructions::admin::seed_house_handler(ctx, amount)
    }

    pub fn delegate_economy(
        ctx: Context<DelegateEconomy>,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        instructions::admin::delegate_economy_handler(ctx, validator)
    }

    pub fn delegate_bridge_pub(
        ctx: Context<DelegateBridgePub>,
        diff: u8,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        instructions::admin::delegate_bridge_pub_handler(ctx, diff, validator)
    }

    pub fn delegate_bridge_sec(
        ctx: Context<DelegateBridgeSec>,
        diff: u8,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        instructions::admin::delegate_bridge_sec_handler(ctx, diff, validator)
    }

    pub fn commit_and_undelegate_economy(
        ctx: Context<CommitAndUndelegateEconomy>,
    ) -> Result<()> {
        instructions::admin::commit_and_undelegate_economy_handler(ctx)
    }

    pub fn commit_and_undelegate_bridge_pub(
        ctx: Context<CommitAndUndelegateBridgePub>,
        diff: u8,
    ) -> Result<()> {
        instructions::admin::commit_and_undelegate_bridge_pub_handler(ctx, diff)
    }

    pub fn commit_and_undelegate_bridge_sec(
        ctx: Context<CommitAndUndelegateBridgeSec>,
        diff: u8,
    ) -> Result<()> {
        instructions::admin::commit_and_undelegate_bridge_sec_handler(ctx, diff)
    }

    // --- PER privacy hardening (permissions.rs, Batch 3) ------------------
    pub fn create_bridge_sec_permission(
        ctx: Context<CreateBridgeSecPermission>,
        diff: u8,
    ) -> Result<()> {
        instructions::permissions::create_bridge_sec_permission_handler(ctx, diff)
    }

    pub fn delegate_bridge_sec_permission(
        ctx: Context<DelegateBridgeSecPermission>,
        diff: u8,
    ) -> Result<()> {
        instructions::permissions::delegate_bridge_sec_permission_handler(ctx, diff)
    }

    // --- L1 vault & player lifecycle (vault_l1.rs) ------------------------
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
        session_key: Pubkey,
        session_expiry: i64,
    ) -> Result<()> {
        instructions::vault_l1::deposit_handler(ctx, amount, session_key, session_expiry)
    }

    pub fn delegate_player(
        ctx: Context<DelegatePlayer>,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        instructions::vault_l1::delegate_player_handler(ctx, validator)
    }

    pub fn commit_and_undelegate_player(
        ctx: Context<CommitAndUndelegatePlayer>,
    ) -> Result<()> {
        instructions::vault_l1::commit_and_undelegate_player_handler(ctx)
    }

    pub fn withdraw_l1(ctx: Context<WithdrawL1>, amount: u64) -> Result<()> {
        instructions::vault_l1::withdraw_l1_handler(ctx, amount)
    }

    // --- Gameplay (gameplay.rs) -------------------------------------------
    pub fn enter_bridge(ctx: Context<EnterBridge>, diff: u8) -> Result<()> {
        instructions::gameplay::enter_bridge_handler(ctx, diff)
    }

    pub fn step_tile(ctx: Context<StepTile>, col: u8) -> Result<()> {
        instructions::gameplay::step_tile_handler(ctx, col)
    }

    pub fn cash_out(ctx: Context<CashOut>) -> Result<()> {
        instructions::gameplay::cash_out_handler(ctx)
    }

    // --- VRF (vrf.rs) -------------------------------------------------------
    pub fn request_bridge_vrf(ctx: Context<RequestBridgeVrf>, diff: u8) -> Result<()> {
        instructions::vrf::request_bridge_vrf_handler(ctx, diff)
    }

    pub fn consume_vrf_randomness(
        ctx: Context<ConsumeVrfRandomness>,
        randomness: [u8; 32],
    ) -> Result<()> {
        instructions::vrf::consume_vrf_randomness_handler(ctx, randomness)
    }

    // --- Resurrection Rush (rush.rs) ---------------------------------------
    pub fn finalize_rush(ctx: Context<FinalizeRush>) -> Result<()> {
        instructions::rush::finalize_rush_handler(ctx)
    }

    pub fn claim_rush_reward(ctx: Context<ClaimRushReward>) -> Result<()> {
        instructions::rush::claim_rush_reward_handler(ctx)
    }

    // --- Local-test helper (never in default builds) ------------------------
    #[cfg(feature = "local-test")]
    pub fn dev_seed_bridge(
        ctx: Context<DevSeedBridge>,
        diff: u8,
        safe_col: [u8; 8],
    ) -> Result<()> {
        instructions::vrf::dev_seed_bridge_handler(ctx, diff, safe_col)
    }
}
