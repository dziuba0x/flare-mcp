// FTSO tools: get_ftso_feed, get_ftso_feeds_all
import { z } from "zod";
import { getClient, type NetworkType } from "../utils/rpc.js";
import { getContractAddress, FTSO_FEEDS } from "../utils/contracts.js";

const FTSO_V2_ABI = [
  {
    name: "getFeedById",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "_feedId", type: "bytes21" }],
    outputs: [
      { name: "_value", type: "uint256" },
      { name: "_decimals", type: "int8" },
      { name: "_timestamp", type: "uint64" },
    ],
  },
] as const;

// Resolve a user-supplied feed identifier ("FLR/USD" name or raw hex id) to
// its on-chain bytes21 feed id and canonical display name.
function resolveFeed(feedId: string): { id: `0x${string}`; name: string } {
  if (/^0x[a-fA-F0-9]{42}$/.test(feedId)) {
    const known = FTSO_FEEDS.find(
      (f) => f.id.toLowerCase() === feedId.toLowerCase(),
    );
    return { id: feedId as `0x${string}`, name: known?.name ?? feedId };
  }
  const match = FTSO_FEEDS.find(
    (f) => f.name.toLowerCase() === feedId.toLowerCase(),
  );
  if (!match) {
    throw new Error(
      `Unknown feed "${feedId}". Use a known feed name (e.g. "FLR/USD") or a raw bytes21 feed id.`,
    );
  }
  return { id: match.id as `0x${string}`, name: match.name };
}

export const getFtsoFeedInput = {
  feed_id: z.string(),
  network: z.enum(["mainnet", "coston2", "songbird", "coston"]),
};

export async function getFtsoFeed(args: {
  feed_id: string;
  network: NetworkType;
}) {
  const { feed_id, network } = args;
  try {
    const { id, name } = resolveFeed(feed_id);
    const client = getClient(network);
    const ftsoV2 = await getContractAddress("FtsoV2", network);

    const [value, decimals, timestamp] = (await client.readContract({
      address: ftsoV2 as `0x${string}`,
      abi: FTSO_V2_ABI,
      functionName: "getFeedById",
      args: [id],
    })) as [bigint, number, bigint];

    const price = Number(value) / 10 ** Number(decimals);

    const result = {
      feed_id: id,
      name,
      price,
      decimals: Number(decimals),
      timestamp: Number(timestamp),
      network,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch FTSO feed "${feed_id}" on ${network}: ${message}`,
        },
      ],
    };
  }
}

export const getFtsoProvidersInput = {
  network: z.enum(["mainnet", "coston2", "songbird", "coston"]),
};

export async function getFtsoProviders(args: { network: NetworkType }) {
  const { network } = args;

  // FTSO provider rankings come from an off-chain indexer — the fully on-chain
  // aggregation (VoterRegistry + FlareSystemsManager + reward managers) is too
  // heavy for a read-only stdio server, and no stable free public REST API
  // ships by default. The endpoint is therefore operator-configurable.
  const endpoint = process.env.FLARE_PROVIDERS_API;
  if (!endpoint) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            `get_ftso_providers needs an external FTSO indexer endpoint, which is not bundled with flare-mcp. ` +
            `Set the FLARE_PROVIDERS_API env var to an endpoint that returns a JSON array of providers ` +
            `(or { "providers": [...] }) to enable it. In the meantime you can browse providers for ` +
            `${network} at https://flare-systems-explorer.flare.network/providers.`,
        },
      ],
    };
  }

  try {
    const url = endpoint.includes("?")
      ? `${endpoint}&network=${encodeURIComponent(network)}`
      : `${endpoint}?network=${encodeURIComponent(network)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`provider API responded with HTTP ${res.status}`);
    }

    const raw = (await res.json()) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { providers?: unknown }).providers)
        ? (raw as { providers: unknown[] }).providers
        : [];

    const providers = list.map((p) => {
      const r = p as Record<string, unknown>;
      return {
        name: r.name ?? r.providerName ?? null,
        address: r.address ?? r.providerAddress ?? null,
        vote_power: r.vote_power ?? r.votePower ?? null,
        fee_percent: r.fee_percent ?? r.feePercent ?? r.fee ?? null,
        reward_rate: r.reward_rate ?? r.rewardRate ?? null,
      };
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ network, providers }, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch FTSO providers for ${network} from ${endpoint}: ${message}`,
        },
      ],
    };
  }
}

export const getFtsoHistoryInput = {
  feed_id: z.string(),
  rounds: z.number().min(1).max(100).default(10),
  network: z.enum(["mainnet", "coston2"]),
};

export async function getFtsoHistory(args: {
  feed_id: string;
  rounds?: number;
  network: NetworkType;
}) {
  const { feed_id, rounds = 10, network } = args;
  try {
    const { id, name } = resolveFeed(feed_id);

    // Historical anchor-feed results are not queryable on-chain; they require
    // the Flare Data Availability (DA) Layer or an equivalent indexer. The base
    // URL is operator-configurable; none ships by default.
    const base = process.env.FLARE_DA_LAYER_API;
    if (!base) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              `get_ftso_history needs the Flare Data Availability (DA) Layer, which is not bundled with flare-mcp. ` +
              `Set the FLARE_DA_LAYER_API env var to a DA Layer base URL to enable historical results for ` +
              `"${name}" (${id}). Live values are available now via get_ftso_feed and get_ftso_feeds_all.`,
          },
        ],
      };
    }

    const res = await fetch(
      `${base.replace(/\/$/, "")}/api/v1/ftso/results?feed_id=${encodeURIComponent(id)}&limit=${rounds}`,
    );
    if (!res.ok) {
      throw new Error(`DA Layer API responded with HTTP ${res.status}`);
    }

    const raw = (await res.json()) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { results?: unknown }).results)
        ? (raw as { results: unknown[] }).results
        : [];

    const history = list.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        round_id: o.round_id ?? o.votingRoundId ?? o.voting_round_id ?? null,
        price: o.price ?? o.value ?? null,
        decimals: o.decimals ?? null,
        timestamp: o.timestamp ?? null,
        turnout_bips: o.turnout_bips ?? o.turnoutBIPS ?? null,
      };
    });

    const result = { feed_id: id, name, network, rounds, history };

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch FTSO history for "${feed_id}" on ${network}: ${message}`,
        },
      ],
    };
  }
}

export const getFtsoFeedsAllInput = {
  network: z.enum(["mainnet", "coston2"]),
};

export async function getFtsoFeedsAll(args: { network: NetworkType }) {
  const { network } = args;
  try {
    const results = await Promise.all(
      FTSO_FEEDS.map(async (feed) => {
        const res = await getFtsoFeed({ feed_id: feed.name, network });
        const text = res.content[0]?.text ?? "{}";
        if (res.isError) {
          return { feed_id: feed.id, name: feed.name, error: text };
        }
        return JSON.parse(text);
      }),
    );

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(results, null, 2) },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch all FTSO feeds on ${network}: ${message}`,
        },
      ],
    };
  }
}
