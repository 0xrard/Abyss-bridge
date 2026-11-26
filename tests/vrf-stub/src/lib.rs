//! Minimal stand-in for the MagicBlock VRF program, used ONLY by the
//! local LiteSVM tests:
//!  - default (request): logs a marker and returns success, proving
//!    our program's `invoke_signed_vrf` CPI dispatched.
//!  - data[0] == 1 (fulfill): plays the oracle — invoke_signed-CPIs
//!    into the consumer program's VRF callback with this program's
//!    scoped identity PDA as signer, exactly like the real oracle.
//!    Accounts: [identity, consumer_program, bridge_pub(w),
//!    bridge_sec(w)].
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    msg,
    program::invoke_signed,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

/// sha256("global:consume_vrf_randomness")[..8]
const CALLBACK_DISC: [u8; 8] = [51, 186, 112, 30, 158, 165, 198, 207];

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.first() == Some(&1) {
        let identity = &accounts[0];
        let consumer = &accounts[1];
        let bridge_pub = &accounts[2];
        let bridge_sec = &accounts[3];
        let (expected_identity, bump) = Pubkey::find_program_address(
            &[b"identity", consumer.key.as_ref()],
            program_id,
        );
        assert_eq!(*identity.key, expected_identity);
        let mut ix_data = Vec::with_capacity(40);
        ix_data.extend_from_slice(&CALLBACK_DISC);
        ix_data.extend_from_slice(&[7u8; 32]);
        let ix = Instruction {
            program_id: *consumer.key,
            accounts: vec![
                AccountMeta::new_readonly(*identity.key, true),
                AccountMeta::new(*bridge_pub.key, false),
                AccountMeta::new(*bridge_sec.key, false),
            ],
            data: ix_data,
        };
        msg!("STUB FULFILL: invoking callback");
        invoke_signed(
            &ix,
            &[
                identity.clone(),
                bridge_pub.clone(),
                bridge_sec.clone(),
            ],
            &[&[b"identity", consumer.key.as_ref(), &[bump]]],
        )?;
        msg!("STUB FULFILL: callback returned Ok");
        return Ok(());
    }
    msg!(
        "STUB VRF PROGRAM CALLED accounts={} data_len={}",
        accounts.len(),
        data.len()
    );
    Ok(())
}
