// FAssets tools: get_fassets_status
import { z } from "zod";
import { formatUnits, getAddress } from "viem";
import { getClient, type NetworkType } from "../utils/rpc.js";
import { getContractAddress } from "../utils/contracts.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ContractRegistry names to try per asset. Flare registers the FAsset asset
// managers under names that have varied across releases, so we probe a few
// candidates and use the first that resolves to a non-zero address.
const ASSET_MANAGER_NAMES: Record<string, readonly string[]> = {
  FXRP: ["AssetManagerFXRP", "FXrpAssetManager", "AssetManagerFTestXRP"],
  FBTC: ["AssetManagerFBTC", "FBtcAssetManager", "AssetManagerFTestBTC"],
  FDOGE: ["AssetManagerFDOGE", "FDogeAssetManager", "AssetManagerFTestDOGE"],
};

const ASSET_MANAGER_ABI = [
  {
    name: "getAllAgents",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_start", type: "uint256" },
      { name: "_end", type: "uint256" },
    ],
    outputs: [
      { name: "_agents", type: "address[]" },
      { name: "_totalLength", type: "uint256" },
    ],
  },
  {
    name: "totalMinted",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "fAsset",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const FASSET_TOKEN_ABI = [
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

export const getFassetsStatusInput = {
  asset: z.enum(["FXRP", "FBTC", "FDOGE"]),
  network: z.enum(["mainnet", "coston2"]),
};

async function resolveAssetManager(
  asset: string,
  network: NetworkType,
): Promise<string | null> {
  for (const name of ASSET_MANAGER_NAMES[asset] ?? []) {
    try {
      const addr = await getContractAddress(name, network);
      if (addr && addr.toLowerCase() !== ZERO_ADDRESS) {
        return getAddress(addr);
      }
    } catch {
      // try next candidate name
    }
  }
  return null;
}

async function readOnChain(asset: string, network: NetworkType) {
  const manager = await resolveAssetManager(asset, network);
  if (!manager) {
    throw new Error(
      `No AssetManager found in ContractRegistry for ${asset} on ${network}`,
    );
  }

  const client = getClient(network);

  const [, totalLength] = (await client.readContract({
    address: manager as `0x${string}`,
    abi: ASSET_MANAGER_ABI,
    functionName: "getAllAgents",
    args: [0n, 100n],
  })) as readonly [readonly string[], bigint];

  let totalMinted: string;
  try {
    const minted = (await client.readContract({
      address: manager as `0x${string}`,
      abi: ASSET_MANAGER_ABI,
      functionName: "totalMinted",
    })) as bigint;
    totalMinted = minted.toString();
  } catch {
    // Fall back to the FAsset token total supply.
    const token = getAddress(
      (await client.readContract({
        address: manager as `0x${string}`,
        abi: ASSET_MANAGER_ABI,
        functionName: "fAsset",
      })) as string,
    );
    const [supply, decimals] = (await Promise.all([
      client.readContract({
        address: token,
        abi: FASSET_TOKEN_ABI,
        functionName: "totalSupply",
      }),
      client.readContract({
        address: token,
        abi: FASSET_TOKEN_ABI,
        functionName: "decimals",
      }),
    ])) as [bigint, number];
    totalMinted = formatUnits(supply, decimals);
  }

  return {
    asset,
    total_minted: totalMinted,
    active_agents_count: Number(totalLength),
    asset_manager: manager,
    network,
    source: "on-chain" as const,
    timestamp: Date.now(),
  };
}

// Optional opt-in fallback to an external metrics API, configured via
// FLARE_METRICS_API. The on-chain path is primary and works without it; this
// is only consulted if the on-chain read fails and the env var is set.
async function readFromMetricsApi(asset: string, network: NetworkType) {
  const base = process.env.FLARE_METRICS_API;
  if (!base) {
    return null;
  }
  const res = await fetch(`${base.replace(/\/$/, "")}/fassets/status`);
  if (!res.ok) {
    throw new Error(`metrics API responded HTTP ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  return {
    asset,
    network,
    source: "metrics-api" as const,
    timestamp: Date.now(),
    data,
  };
}

export async function getFassetsStatus(args: {
  asset: "FXRP" | "FBTC" | "FDOGE";
  network: NetworkType;
}) {
  const { asset, network } = args;
  try {
    const result = await readOnChain(asset, network);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (onChainErr) {
    const onChainMsg =
      onChainErr instanceof Error ? onChainErr.message : String(onChainErr);
    try {
      const fallback = await readFromMetricsApi(asset, network);
      if (fallback) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(fallback, null, 2) },
          ],
        };
      }
    } catch (fallbackErr) {
      const fallbackMsg =
        fallbackErr instanceof Error
          ? fallbackErr.message
          : String(fallbackErr);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch FAssets status for ${asset} on ${network}. On-chain error: ${onChainMsg}. Fallback (FLARE_METRICS_API) error: ${fallbackMsg}`,
          },
        ],
      };
    }
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch FAssets status for ${asset} on ${network}: ${onChainMsg}`,
        },
      ],
    };
  }
}
