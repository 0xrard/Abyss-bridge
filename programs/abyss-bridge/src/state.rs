//! The 5 PDA account structs (SPEC.md §4). `PlayerState` additionally
//! carries the Batch 1 native session-key fields (`session_key`,
//! `session_expiry`) — no external session-keys crate (see
//! BATCH1-REPORT.md for the rationale).

use anchor_lang::prelude::*;

use crate::constants::{HIDDEN_COL, MAX_ROWS, MAX_RUNNERS};
use crate::errors::ErrorCode;

/// L1 protocol configuration. Seeds: `["vault_cfg"]`.
#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault_ata: Pubkey,
    pub bump: u8,
}

/// Shared economy ledger, delegated to the ER once and resident there.
/// Seeds: `["economy"]`.
#[account]
#[derive(InitSpace)]
pub struct GlobalEconomy {
    pub house_reserve_bal: u64,
    pub event_vault_bal: u64,
    pub treasury_bal: u64,
    pub event_target: u64,
    pub rush_duration_secs: i64,
    pub rush_active: bool,
    pub rush_round_id: u32,
    pub rush_end_ts: i64,
    pub rush_prize_pool: u64,
    pub rush_highest_row: u8,
    pub rush_highest_count: u16,
    pub rush_finishers_count: u16,
    pub settled_rush_id: u32,
    pub settled_winning_row: u8,
    pub settled_payout_per_winner: u64,
}

/// Lightweight visual snapshot of one runner on a bridge.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct RunnerSlot {
    pub pubkey: Pubkey,
    pub row: u8,
    pub col: u8,
    pub blind_steps: u8,
    pub active: bool,
}

/// Public board state (frontend-subscribable). Seeds:
/// `["bridge_pub", &[diff]]`.
#[account]
#[derive(InitSpace)]
pub struct BridgePublic {
    pub diff: u8,
    pub cols: u8,
    pub rows: u8,
    pub round_id: u32,
    /// Mirror of BridgeSecret.vrf_pending (Batch 2 micro-patch): the
    /// frontend must NEVER read BridgeSecret (PER will lock it in
    /// Batch 3), so the shuffle state is published here. BridgeSecret
    /// remains the contract-side source of truth; every write path
    /// updates both.
    pub vrf_pending: bool,
    /// Per-row revealed safe column; 255 = hidden.
    pub revealed_safe_col: [u8; MAX_ROWS],
    /// Per-row bitmask of broken (trap) columns.
    pub broken_mask: [u8; MAX_ROWS],
    pub active_runners: [RunnerSlot; MAX_RUNNERS],
}

/// Hidden safe-tile answers. PER/TEE-locked in Batch 3. Seeds:
/// `["bridge_sec", &[diff]]`.
#[account]
#[derive(InitSpace)]
pub struct BridgeSecret {
    pub diff: u8,
    pub round_id: u32,
    pub safe_col: [u8; MAX_ROWS],
    pub vrf_pending: bool,
}

/// Per-player state, the only account that travels L1 <-> ER.
/// Seeds: `["player", owner]`.
#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub owner: Pubkey,
    /// Internal Mock USDC ledger balance (backed by VaultConfig.vault_ata).
    pub balance: u64,
    pub fallen_passes: u16,
    pub is_on_bridge: bool,
    pub active_diff: u8,
    pub entry_round_id: u32,
    pub current_row: u8,
    pub blind_steps: u8,
    /// Last Rush the player entered.
    pub last_rush_id: u32,
    /// Best rows-completed in that Rush (double-count watermark).
    pub last_rush_best_row: u8,
    /// Rush id whose reward this player already claimed.
    pub rush_claimed_id: u32,
    /// Native session key (Batch 1 rule 1): an ephemeral browser
    /// keypair registered by the owner at deposit time.
    pub session_key: Pubkey,
    pub session_expiry: i64,
}

impl PlayerState {
    /// Authorize a gameplay signer: the owner always may; the native
    /// session key may while `now <= session_expiry`.
    pub fn authorize(&self, signer: &Pubkey) -> Result<()> {
        if *signer == self.owner {
            return Ok(());
        }
        if self.session_key != Pubkey::default() && *signer == self.session_key {
            let now = Clock::get()?.unix_timestamp;
            if now <= self.session_expiry {
                return Ok(());
            }
            return err!(ErrorCode::SessionExpired);
        }
        err!(ErrorCode::Unauthorized)
    }
}

impl BridgePublic {
    /// Insert or refresh the runner slot for `who`.
    pub fn upsert_runner(
        &mut self,
        who: Pubkey,
        row: u8,
        col: u8,
        blind_steps: u8,
    ) -> Result<()> {
        if let Some(slot) = self
            .active_runners
            .iter_mut()
            .find(|s| s.active && s.pubkey == who)
        {
            slot.row = row;
            slot.col = col;
            slot.blind_steps = blind_steps;
            return Ok(());
        }
        if let Some(slot) = self.active_runners.iter_mut().find(|s| !s.active) {
            *slot = RunnerSlot {
                pubkey: who,
                row,
                col,
                blind_steps,
                active: true,
            };
            return Ok(());
        }
        err!(ErrorCode::BridgeFull)
    }

    /// Deactivate the runner slot for `who` (no-op if absent, e.g. the
    /// board was reset by a finisher while this player was still out).
    pub fn remove_runner(&mut self, who: &Pubkey) {
        for slot in self.active_runners.iter_mut() {
            if slot.active && slot.pubkey == *who {
                slot.active = false;
            }
        }
    }

    /// Clear all public per-round state (called on VRF reseed).
    pub fn reset_round(&mut self) {
        self.revealed_safe_col = [HIDDEN_COL; MAX_ROWS];
        self.broken_mask = [0; MAX_ROWS];
        self.active_runners = [RunnerSlot::default(); MAX_RUNNERS];
    }
}
