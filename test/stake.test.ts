// Unit test for the reward-aggregation logic in get_flr_stake_info.
import { describe, it, expect } from "vitest";
import { aggregateRewards } from "../src/tools/stake.js";
import { formatEther } from "viem";

function r(amount: bigint, claimType: number, initialised: boolean) {
  return { rewardEpochId: 400, beneficiary: "0x", amount, claimType, initialised };
}

describe("aggregateRewards", () => {
  it("sums total and counts only initialised as claimable now", () => {
    // 2D: outer per-epoch, inner per claim source
    const states = [
      [r(10n ** 18n, 0, true), r(2n * 10n ** 18n, 2, false)], // DIRECT initialised, WNAT not
      [r(3n * 10n ** 18n, 2, true)], // WNAT initialised
    ];
    const agg = aggregateRewards(states);
    expect(formatEther(agg.totalWei)).toBe("6"); // 1+2+3
    expect(formatEther(agg.claimableNowWei)).toBe("4"); // 1 + 3 (initialised only)
  });

  it("breaks down by claim source label", () => {
    const states = [[r(5n * 10n ** 18n, 0, true), r(7n * 10n ** 18n, 2, true)]];
    const agg = aggregateRewards(states);
    expect(formatEther(agg.byType.DIRECT)).toBe("5");
    expect(formatEther(agg.byType.WNAT)).toBe("7");
  });

  it("handles empty reward state", () => {
    const agg = aggregateRewards([]);
    expect(agg.totalWei).toBe(0n);
    expect(agg.claimableNowWei).toBe(0n);
    expect(Object.keys(agg.byType)).toHaveLength(0);
  });

  it("labels unknown claim types without throwing", () => {
    const agg = aggregateRewards([[r(10n ** 18n, 9, true)]]);
    expect(formatEther(agg.byType.TYPE_9)).toBe("1");
  });
});
