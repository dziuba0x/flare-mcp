// FAssets v2 tools: fassets_agent_status, fassets_system_state
//
// Contract access pattern per official guides:
//   https://dev.flare.network/fassets/developer-guides/fassets-list-agents
//   https://dev.flare.network/fassets/developer-guides/fassets-redemption-queue
//   https://dev.flare.network/fassets/reference/IAssetManager
// AssetManager resolved from the FlareContractRegistry (name AssetManagerFXRP),
// per https://dev.flare.network/fassets/developer-guides/fassets-asset-manager-address-contracts-registry
import { z } from "zod";
import { formatUnits, getAddress, type Address } from "viem";
import { getClient, type NetworkType } from "../utils/rpc.js";
import { getContractAddress, getInterfaceAbi } from "../utils/contracts.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Registry names per asset. FXRP is live (verified on mainnet, coston2 and
// songbird registries, 2026-07); others are probed and reported as absent.
const ASSET_MANAGER_NAMES: Record<string, readonly string[]> = {
  FXRP: ["AssetManagerFXRP"],
  FBTC: ["AssetManagerFBTC"],
  FDOGE: ["AssetManagerFDOGE"],
};

// AgentStatus enum per https://github.com/flare-foundation/fassets
// contracts/userInterfaces/data/AgentInfo.sol
const AGENT_STATUS = [
  "NORMAL",
  "CCB",
  "LIQUIDATION",
  "FULL_LIQUIDATION",
  "DESTROYING",
] as const;

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

export async function resolveAssetManager(
  asset: string,
  network: NetworkType,
): Promise<Address | null> {
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

export interface AgentInfoStruct {
  status: number;
  ownerManagementAddress: Address;
  collateralPool: Address;
  underlyingAddressString: string;
  publiclyAvailable: boolean;
  vaultCollateralToken: Address;
  feeBIPS: bigint;
  mintingVaultCollateralRatioBIPS: bigint;
  mintingPoolCollateralRatioBIPS: bigint;
  freeCollateralLots: bigint;
  totalVaultCollateralWei: bigint;
  vaultCollateralRatioBIPS: bigint;
  totalPoolCollateralNATWei: bigint;
  poolCollateralRatioBIPS: bigint;
  mintedUBA: bigint;
  reservedUBA: bigint;
  redeemingUBA: bigint;
  liquidationStartTimestamp: bigint;
  maxLiquidationAmountUBA: bigint;
}

function bips(value: bigint): number {
  return Number(value) / 10_000;
}

/** Shape one on-chain AgentInfo struct into the tool's output row. */
export function shapeAgent(
  vault: string,
  info: AgentInfoStruct,
  assetDecimals: number,
) {
  const status = AGENT_STATUS[info.status] ?? `UNKNOWN(${info.status})`;
  return {
    agent_vault: vault,
    status,
    in_liquidation: info.status === 2 || info.status === 3,
    publicly_available: info.publiclyAvailable,
    underlying_address: info.underlyingAddressString,
    fee_percent: bips(info.feeBIPS) * 100,
    minting_capacity_lots: info.freeCollateralLots.toString(),
    vault_collateral_ratio: bips(info.vaultCollateralRatioBIPS),
    pool_collateral_ratio: bips(info.poolCollateralRatioBIPS),
    minting_vault_cr_target: bips(info.mintingVaultCollateralRatioBIPS),
    minting_pool_cr_target: bips(info.mintingPoolCollateralRatioBIPS),
    minted: formatUnits(info.mintedUBA, assetDecimals),
    reserved: formatUnits(info.reservedUBA, assetDecimals),
    redeeming: formatUnits(info.redeemingUBA, assetDecimals),
    total_vault_collateral_wei: info.totalVaultCollateralWei.toString(),
    total_pool_collateral_nat_wei: info.totalPoolCollateralNATWei.toString(),
    liquidation_start_timestamp:
      info.liquidationStartTimestamp > 0n
        ? Number(info.liquidationStartTimestamp)
        : null,
    max_liquidation_amount: formatUnits(
      info.maxLiquidationAmountUBA,
      assetDecimals,
    ),
  };
}

export const fassetsAgentStatusInput = {
  asset: z.enum(["FXRP", "FBTC", "FDOGE"]),
  network: z.enum(["mainnet", "coston2", "songbird", "coston"]),
  max_agents: z.number().int().positive().max(100).optional(),
};

export async function fassetsAgentStatus(args: {
  asset: "FXRP" | "FBTC" | "FDOGE";
  network: NetworkType;
  max_agents?: number;
}) {
  const { asset, network } = args;
  const maxAgents = args.max_agents ?? 50;
  try {
    const manager = await resolveAssetManager(asset, network);
    if (!manager) {
      return toolError(
        `No AssetManager for ${asset} in the ${network} FlareContractRegistry. As of 2026-07 only FXRP is live.`,
      );
    }
    const client = getClient(network);
    const abi = getInterfaceAbi("IAssetManager", network);

    const settings = (await client.readContract({
      address: manager,
      abi,
      functionName: "getSettings",
    })) as { assetDecimals: bigint };
    const assetDecimals = Number(settings.assetDecimals);

    const [vaults, totalLength] = (await client.readContract({
      address: manager,
      abi,
      functionName: "getAllAgents",
      args: [0n, BigInt(maxAgents)],
    })) as readonly [readonly Address[], bigint];

    // getAgentInfo per vault, in small batches to be gentle on public RPCs.
    const agents: ReturnType<typeof shapeAgent>[] = [];
    const batchSize = 5;
    for (let i = 0; i < vaults.length; i += batchSize) {
      const batch = vaults.slice(i, i + batchSize);
      const infos = await Promise.all(
        batch.map((vault) =>
          client.readContract({
            address: manager,
            abi,
            functionName: "getAgentInfo",
            args: [vault],
          }),
        ),
      );
      for (let j = 0; j < batch.length; j++) {
        agents.push(
          shapeAgent(batch[j], infos[j] as AgentInfoStruct, assetDecimals),
        );
      }
    }

    agents.sort(
      (a, b) => a.vault_collateral_ratio - b.vault_collateral_ratio,
    );

    return toolResult({
      asset,
      network,
      asset_manager: manager,
      total_agents: Number(totalLength),
      agents_returned: agents.length,
      agents_in_liquidation: agents.filter((a) => a.in_liquidation).length,
      agents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(
      `Failed to fetch ${asset} agent status on ${network}: ${message}`,
    );
  }
}

export const fassetsSystemStateInput = {
  asset: z.enum(["FXRP", "FBTC", "FDOGE"]),
  network: z.enum(["mainnet", "coston2", "songbird", "coston"]),
};

const ERC20_ABI = [
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export async function fassetsSystemState(args: {
  asset: "FXRP" | "FBTC" | "FDOGE";
  network: NetworkType;
}) {
  const { asset, network } = args;
  try {
    const manager = await resolveAssetManager(asset, network);
    if (!manager) {
      return toolError(
        `No AssetManager for ${asset} in the ${network} FlareContractRegistry. As of 2026-07 only FXRP is live.`,
      );
    }
    const client = getClient(network);
    const abi = getInterfaceAbi("IAssetManager", network);

    const settings = (await client.readContract({
      address: manager,
      abi,
      functionName: "getSettings",
    })) as {
      fAsset: Address;
      assetDecimals: bigint;
      lotSizeAMG: bigint;
      assetMintingGranularityUBA: bigint;
      mintingCapAMG: bigint;
      maxRedeemedTickets: bigint;
      mintingPausedAt?: bigint;
    };
    const assetDecimals = Number(settings.assetDecimals);

    const [totalSupply, symbol, [, totalAgents], mintingPaused] =
      await Promise.all([
        client.readContract({
          address: settings.fAsset,
          abi: ERC20_ABI,
          functionName: "totalSupply",
        }) as Promise<bigint>,
        client.readContract({
          address: settings.fAsset,
          abi: ERC20_ABI,
          functionName: "symbol",
        }) as Promise<string>,
        client.readContract({
          address: manager,
          abi,
          functionName: "getAllAgents",
          args: [0n, 0n],
        }) as Promise<readonly [readonly Address[], bigint]>,
        client
          .readContract({ address: manager, abi, functionName: "mintingPaused" })
          .then((v) => Boolean(v))
          .catch(() => null),
      ]);

    // Redemption queue, paged via _nextRedemptionTicketId (id 0 = queue head).
    // Per https://dev.flare.network/fassets/developer-guides/fassets-redemption-queue
    const pageSize = settings.maxRedeemedTickets;
    let ticketId = 0n;
    let queueTickets = 0;
    let queueValueUBA = 0n;
    for (let page = 0; page < 10; page++) {
      const [tickets, nextId] = (await client.readContract({
        address: manager,
        abi,
        functionName: "redemptionQueue",
        args: [ticketId, pageSize],
      })) as readonly [
        readonly { ticketValueUBA: bigint }[],
        bigint,
      ];
      queueTickets += tickets.length;
      for (const t of tickets) {
        queueValueUBA += t.ticketValueUBA;
      }
      if (nextId === 0n) {
        break;
      }
      ticketId = nextId;
    }

    // Aggregate collateral across available agents (detailed list is cheap;
    // absolute pool sizes need getAgentInfo, so sample up to 50 agents).
    const [vaults] = (await client.readContract({
      address: manager,
      abi,
      functionName: "getAllAgents",
      args: [0n, 50n],
    })) as readonly [readonly Address[], bigint];
    let totalVaultCollateralWei = 0n;
    let totalPoolCollateralNATWei = 0n;
    const batchSize = 5;
    for (let i = 0; i < vaults.length; i += batchSize) {
      const infos = await Promise.all(
        vaults.slice(i, i + batchSize).map((vault) =>
          client.readContract({
            address: manager,
            abi,
            functionName: "getAgentInfo",
            args: [vault],
          }),
        ),
      );
      for (const info of infos as AgentInfoStruct[]) {
        totalVaultCollateralWei += info.totalVaultCollateralWei;
        totalPoolCollateralNATWei += info.totalPoolCollateralNATWei;
      }
    }

    const lotSizeUBA = settings.lotSizeAMG * settings.assetMintingGranularityUBA;

    return toolResult({
      asset,
      symbol,
      network,
      asset_manager: manager,
      fasset_token: settings.fAsset,
      total_minted: formatUnits(totalSupply, assetDecimals),
      total_agents: Number(totalAgents),
      lot_size: formatUnits(lotSizeUBA, assetDecimals),
      minting_cap:
        settings.mintingCapAMG === 0n
          ? null
          : formatUnits(
              settings.mintingCapAMG * settings.assetMintingGranularityUBA,
              assetDecimals,
            ),
      minting_paused: mintingPaused,
      collateral: {
        agents_sampled: vaults.length,
        total_vault_collateral_wei: totalVaultCollateralWei.toString(),
        total_pool_collateral_nat: formatUnits(totalPoolCollateralNATWei, 18),
      },
      redemption_queue: {
        tickets: queueTickets,
        total_value: formatUnits(queueValueUBA, assetDecimals),
        lots: (lotSizeUBA > 0n ? queueValueUBA / lotSizeUBA : 0n).toString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(
      `Failed to fetch ${asset} system state on ${network}: ${message}`,
    );
  }
}
