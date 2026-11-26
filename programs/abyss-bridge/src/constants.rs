//! Difficulty configs, BPS math constants, PDA seeds (SPEC.md §3).

/// Mock USDC decimals: 6 (1_000_000 = 1.00 USDC).
pub const USDC_DECIMALS: u8 = 6;

/// Fixed entry fee for normal modes (diff 0, 1, 2): 1.00 Mock USDC.
pub const ENTRY_FEE: u64 = 1_000_000;

/// Loss split (SPEC.md §3.3): 70% house / 25% event vault / 5% treasury.
pub const LOSS_HOUSE_AMOUNT: u64 = 700_000;
pub const LOSS_EVENT_AMOUNT: u64 = 250_000;
pub const LOSS_TREASURY_AMOUNT: u64 = 50_000;

/// Solvency circuit breaker: max single payout = 25% of house reserve.
pub const MAX_PAYOUT_RESERVE_BPS: u64 = 2_500;

/// Devnet defaults (SPEC.md §3.3): 2,000 USDC house seed; the 25% cap
/// (500 USDC) safely covers the Hard full-blind max of 474.20 USDC.
pub const DEVNET_HOUSE_SEED: u64 = 2_000_000_000;
/// Devnet event target: 1.00 USDC = Rush triggers after 4 losses.
pub const DEVNET_EVENT_TARGET: u64 = 1_000_000;
/// Production event target: 25.00 USDC.
pub const PROD_EVENT_TARGET: u64 = 25_000_000;
/// Resurrection Rush duration: 45 seconds.
pub const RUSH_DURATION_SECS: i64 = 45;

/// PDA seeds (SPEC.md §4).
pub const VAULT_CFG_SEED: &[u8] = b"vault_cfg";
pub const ECONOMY_SEED: &[u8] = b"economy";
pub const BRIDGE_PUB_SEED: &[u8] = b"bridge_pub";
pub const BRIDGE_SEC_SEED: &[u8] = b"bridge_sec";
pub const PLAYER_SEED: &[u8] = b"player";

/// `revealed_safe_col` sentinel: 255 = row still hidden.
pub const HIDDEN_COL: u8 = 255;

/// Maximum rows across all difficulties (Normal is 2x8).
pub const MAX_ROWS: usize = 8;
/// Maximum concurrent runner slots rendered per bridge.
pub const MAX_RUNNERS: usize = 8;

/// Difficulty index of the dedicated Resurrection Rush bridge.
pub const RUSH_DIFF: u8 = 3;

/// Grid dimensions per difficulty (SPEC.md §3.1):
/// returns (cols, rows) or None for an invalid difficulty.
pub fn difficulty_dims(diff: u8) -> Option<(u8, u8)> {
    match diff {
        0 => Some((2, 6)), // Easy
        1 => Some((2, 8)), // Normal
        2 => Some((3, 6)), // Hard
        3 => Some((2, 6)), // Resurrection Rush
        _ => None,
    }
}
