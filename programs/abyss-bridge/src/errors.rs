use anchor_lang::prelude::*;

// Custom Anchor error codes (SPEC.md §2).
#[error_code]
pub enum ErrorCode {
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Signer is neither the owner nor a live session key")]
    Unauthorized,
    #[msg("Session key has expired")]
    SessionExpired,
    #[msg("Invalid difficulty")]
    InvalidDifficulty,
    #[msg("Invalid column for this bridge")]
    InvalidColumn,
    #[msg("Player is already on a bridge")]
    AlreadyOnBridge,
    #[msg("Player is not on a bridge")]
    NotOnBridge,
    #[msg("Bridge layout is not seeded yet (VRF pending)")]
    BridgeSeedPending,
    #[msg("Bridge round was reset by another finisher; cash out to exit")]
    BridgeRoundReset,
    #[msg("Insufficient PlayerState balance")]
    InsufficientBalance,
    #[msg("No Fallen Pass available")]
    InsufficientPasses,
    #[msg("Cash out requires at least 1 blind step")]
    NoBlindSteps,
    #[msg("Bridge runner slots are full")]
    BridgeFull,
    #[msg("Resurrection Rush is not active")]
    RushNotActive,
    #[msg("Resurrection Rush is still running")]
    RushStillActive,
    #[msg("Player did not win the settled Rush")]
    NotRushWinner,
    #[msg("Rush reward already claimed")]
    AlreadyClaimed,
    #[msg("Oracle queue is not a recognised MagicBlock VRF queue")]
    InvalidOracleQueue,
    #[msg("Player is on a bridge; cash out or finish first")]
    PlayerOnBridge,
    #[msg("Dev seed helper is disabled in this build")]
    DevSeedDisabled,
    #[msg("Permission account does not match the expected Permission PDA")]
    InvalidPermissionAccount,
}
