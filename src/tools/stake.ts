// Portfolio tool: get_flr_stake_info — a one-call "Flare portfolio" read.
//
// Aggregates a holder's on-chain position across the Flare Systems Protocol:
// native FLR + wrapped WFLR, FTSO vote power and delegation (WNat / VPToken),
// claimable protocol rewards (RewardManager.getStateOfRewards — amounts only,
// no claim proofs needed for reading), and FlareDrops (DistributionToDelegators,
// best-effort — the monthly program may be inactive on a given network).
//
// Reward/FlareDrop amounts and balances are FLR-denominated (18 decimals).
import { z } from "zod";
import { formatEther, getAddress, type Address } from "viem";
import { getClient, type NetworkType } from "../utils/rpc.js";
import { getContractAddress, getInterfaceAbi } from "../utils/contracts.js";

const ZERO = "0x0000000000000000000000000000000000000000";

// Minimal VPToken (WNat) delegation reads — not in the periphery IWNat
// interface, but these are stable Flare VPToken functions.
const WNAT_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "votePowerOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    name: "delegatesOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { name: "_delegateAddresses", type: "address[]" },
      { name: "_bips", type: "uint256[]" },
      { name: "_count", type: "uint256" },
      { name: "_delegationMode", type: "uint256" },
    ],
  },
] as const;

// RewardsV2 ClaimType (source of a reward). Order per the Flare RewardsV2 enum.
const CLAIM_TYPE = ["DIRECT", "FEE", "WNAT", "MIRROR", "CCHAIN"] as const;

function delegationModeLabel(mode: bigint): string {
  // 0 = not delegating, 1 = percentage (bips), 2 = explicit (amount)
  return mode === 0n ? "none" : mode === 1n ? "percentage" : mode === 2n ? "explicit" : `unknown(${mode})`;
}

function toolError(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function toolResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          data,
          (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
          2,
        ),
      },
    ],
  };
}

async function resolveOptional(
  name: string,
  network: NetworkType,
): Promise<Address | null> {
  try {
    const addr = await getContractAddress(name, network);
    return addr && addr.toLowerCase() !== ZERO ? getAddress(addr) : null;
  } catch {
    return null;
  }
}

interface RewardState {
  rewardEpochId: number;
  beneficiary: string;
  amount: bigint;
  claimType: number;
  initialised: boolean;
}

/** Aggregate getStateOfRewards output into totals and a per-source breakdown. */
export function aggregateRewards(states: readonly (readonly RewardState[])[]) {
  let totalWei = 0n;
  let claimableNowWei = 0n; // initialised entries are claimable without extra steps
  const byType: Record<string, bigint> = {};
  for (const perEpoch of states) {
    for (const r of perEpoch) {
      totalWei += r.amount;
      if (r.initialised) claimableNowWei += r.amount;
      const label = CLAIM_TYPE[r.claimType] ?? `TYPE_${r.claimType}`;
      byType[label] = (byType[label] ?? 0n) + r.amount;
    }
  }
  return { totalWei, claimableNowWei, byType };
}

export const getFlrStakeInfoInput = {
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  network: z.enum(["mainnet", "coston2", "songbird", "coston"]),
};

export async function getFlrStakeInfo(args: {
  address: string;
  network: NetworkType;
}) {
  const { network } = args;
  try {
    const account = getAddress(args.address);
    const client = getClient(network);

    // --- Native + wrapped balance, vote power, delegation (WNat) ---
    const wnat = getAddress(await getContractAddress("WNat", network));
    const [native, wflr, votePower, del] = await Promise.all([
      client.getBalance({ address: account }),
      client.readContract({ address: wnat, abi: WNAT_ABI, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
      client.readContract({ address: wnat, abi: WNAT_ABI, functionName: "votePowerOf", args: [account] }) as Promise<bigint>,
      client.readContract({ address: wnat, abi: WNAT_ABI, functionName: "delegatesOf", args: [account] }) as Promise<
        readonly [readonly Address[], readonly bigint[], bigint, bigint]
      >,
    ]);
    const delegates = del[0].map((addr, i) => ({
      address: addr,
      bips: Number(del[1][i]),
      percent: Number(del[1][i]) / 100,
    }));

    // --- Claimable protocol rewards (best-effort per network) ---
    let rewards: Record<string, unknown> = { available: false };
    const rmAddr = await resolveOptional("RewardManager", network);
    if (rmAddr) {
      try {
        const rmAbi = getInterfaceAbi("IRewardManager", network);
        const [range, states] = await Promise.all([
          client.readContract({ address: rmAddr, abi: rmAbi, functionName: "getRewardEpochIdsWithClaimableRewards" }) as Promise<readonly [number, number]>,
          client.readContract({ address: rmAddr, abi: rmAbi, functionName: "getStateOfRewards", args: [account] }) as Promise<readonly (readonly RewardState[])[]>,
        ]);
        const agg = aggregateRewards(states);
        rewards = {
          available: true,
          claimable_epoch_range: [Number(range[0]), Number(range[1])],
          total: formatEther(agg.totalWei),
          claimable_now: formatEther(agg.claimableNowWei),
          by_source: Object.fromEntries(
            Object.entries(agg.byType).map(([k, v]) => [k, formatEther(v)]),
          ),
          note: "`claimable_now` = initialised entries (claimable directly). Weight-based rewards (WNAT/MIRROR/CCHAIN) may need initialisation before claiming; claiming requires Merkle proofs (out of scope for this read tool).",
        };
      } catch (e) {
        rewards = { available: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
      }
    }

    // --- FlareDrops (best-effort; the monthly program may be inactive) ---
    let flaredrops: Record<string, unknown> = { available: false };
    const distAddr = await resolveOptional("DistributionToDelegators", network);
    if (distAddr) {
      try {
        const dAbi = getInterfaceAbi("IDistributionToDelegators", network);
        const [start, end] = (await client.readContract({ address: distAddr, abi: dAbi, functionName: "getClaimableMonths" })) as readonly [bigint, bigint];
        let total = 0n;
        const months: number[] = [];
        for (let m = start; m <= end; m++) {
          const amt = (await client.readContract({ address: distAddr, abi: dAbi, functionName: "getClaimableAmountOf", args: [account, m] })) as bigint;
          if (amt > 0n) months.push(Number(m));
          total += amt;
        }
        flaredrops = { available: true, claimable: formatEther(total), claimable_months: months };
      } catch {
        flaredrops = { available: false, note: "No claimable FlareDrops (the monthly distribution program is inactive or concluded on this network)." };
      }
    }

    return toolResult({
      address: account,
      network,
      flr_balance: formatEther(native),
      wflr_balance: formatEther(wflr),
      vote_power: formatEther(votePower),
      delegation: {
        mode: delegationModeLabel(del[3]),
        delegate_count: Number(del[2]),
        delegates,
      },
      rewards,
      flaredrops,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to fetch stake info for ${args.address} on ${network}: ${message}`);
  }
}
