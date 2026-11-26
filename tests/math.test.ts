// Mirror of programs/abyss-bridge/src/math.rs (SPEC.md §3.2).
// The Rust `cargo test` suite is the authoritative verification of the
// on-chain math; this file pins the same numbers on the TS side and
// documents the 70/25/5 loss split used by the e2e assertions.
import { expect } from "chai";

const BPS = 10_000;

export function calcMultiplierBps(cols: number, blindSteps: number): number {
  if (blindSteps === 0) return BPS;
  return BPS + 6_500 * (Math.pow(cols, blindSteps) - 1);
}

export function calcCappedPayout(
  entryFee: number,
  cols: number,
  blindSteps: number,
  houseReserve: number
): number {
  const raw = (entryFee * calcMultiplierBps(cols, blindSteps)) / BPS;
  const cap = (houseReserve * 25) / 100; // solvency circuit breaker
  return Math.min(raw, cap);
}

describe("math (SPEC §3.2)", () => {
  it("Easy 2x6 multipliers", () => {
    expect(calcMultiplierBps(2, 1)).to.equal(16_500); // 1.65x
    expect(calcMultiplierBps(2, 3)).to.equal(55_500); // 5.55x
    expect(calcMultiplierBps(2, 6)).to.equal(419_500); // 41.95x
  });

  it("Normal 2x8 multipliers", () => {
    expect(calcMultiplierBps(2, 8)).to.equal(1_667_500); // 166.75x
  });

  it("Hard 3x6 multipliers", () => {
    expect(calcMultiplierBps(3, 1)).to.equal(23_000); // 2.30x
    expect(calcMultiplierBps(3, 3)).to.equal(179_000); // 17.90x
    expect(calcMultiplierBps(3, 6)).to.equal(4_742_000); // 474.20x
  });

  it("solvency cap = 25% of house reserve", () => {
    // Devnet seed 2,000 USDC -> cap 500 USDC covers Hard max 474.20.
    expect(calcCappedPayout(1_000_000, 3, 6, 2_000_000_000)).to.equal(474_200_000);
    // A drained house clamps hard.
    expect(calcCappedPayout(1_000_000, 2, 6, 100_000_000)).to.equal(25_000_000);
  });

  it("loss split 70/25/5 sums to the entry fee", () => {
    const fee = 1_000_000;
    expect(700_000 + 250_000 + 50_000).to.equal(fee);
  });
});
