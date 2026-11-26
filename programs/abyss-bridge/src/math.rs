//! Pure integer multiplier & payout-cap helpers (SPEC.md §3.2).
//! Implemented exactly as specified; verified by the unit tests below
//! and mirrored in tests/math.test.ts.

use crate::errors::ErrorCode;
use anchor_lang::prelude::*;

/// M(c, k) = 1 + 0.65 * (c^k - 1), scaled by 10_000 BPS.
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

/// Raw payout for a run, clamped by the solvency circuit breaker:
/// a single payout never exceeds 25% of the current house reserve.
pub fn calc_capped_payout(
    entry_fee: u64,
    cols: u8,
    blind_steps: u8,
    house_reserve: u64,
) -> Result<u64> {
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

#[cfg(test)]
mod tests {
    use super::*;

    // SPEC.md §3.1 / Batch 1 required exact values (in BPS, 10_000 = 1.00x).
    #[test]
    fn easy_multipliers() {
        assert_eq!(calc_multiplier_bps(2, 0).unwrap(), 10_000); // 1.00x
        assert_eq!(calc_multiplier_bps(2, 1).unwrap(), 16_500); // 1.65x
        assert_eq!(calc_multiplier_bps(2, 3).unwrap(), 55_500); // 5.55x
        assert_eq!(calc_multiplier_bps(2, 6).unwrap(), 419_500); // 41.95x
    }

    #[test]
    fn normal_multipliers() {
        assert_eq!(calc_multiplier_bps(2, 1).unwrap(), 16_500); // 1.65x
        assert_eq!(calc_multiplier_bps(2, 3).unwrap(), 55_500); // 5.55x
        assert_eq!(calc_multiplier_bps(2, 8).unwrap(), 1_667_500); // 166.75x
    }

    #[test]
    fn hard_multipliers() {
        assert_eq!(calc_multiplier_bps(3, 1).unwrap(), 23_000); // 2.30x
        assert_eq!(calc_multiplier_bps(3, 3).unwrap(), 179_000); // 17.90x
        assert_eq!(calc_multiplier_bps(3, 6).unwrap(), 4_742_000); // 474.20x
    }

    #[test]
    fn payout_amounts_at_devnet_seed() {
        // House reserve 2,000 USDC -> 25% cap = 500 USDC, never binds here.
        let house = 2_000_000_000u64;
        assert_eq!(
            calc_capped_payout(1_000_000, 2, 6, house).unwrap(),
            41_950_000 // Easy full blind: 41.95 USDC
        );
        assert_eq!(
            calc_capped_payout(1_000_000, 2, 8, house).unwrap(),
            166_750_000 // Normal full blind: 166.75 USDC
        );
        assert_eq!(
            calc_capped_payout(1_000_000, 3, 6, house).unwrap(),
            474_200_000 // Hard full blind: 474.20 USDC < 500 USDC cap
        );
    }

    #[test]
    fn solvency_cap_binds() {
        // House reserve 100 USDC -> cap = 25 USDC; Easy full-blind raw
        // payout of 41.95 USDC is clamped to exactly the cap.
        assert_eq!(
            calc_capped_payout(1_000_000, 2, 6, 100_000_000).unwrap(),
            25_000_000
        );
        // Zero blind steps pays back exactly the entry fee (before cap).
        assert_eq!(
            calc_capped_payout(1_000_000, 2, 0, 2_000_000_000).unwrap(),
            1_000_000
        );
    }
}
