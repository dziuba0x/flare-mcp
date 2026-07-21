// FTSO Scaling anchor-feed helpers over the Flare Data Availability layer.
//
// Anchor feeds are the per-voting-epoch (~90s) FTSO values published with a
// Merkle proof. Unlike block-latency feeds (a plain on-chain read), an anchor
// feed comes with a proof that can be verified WITHOUT trusting the DA API:
// the feed body is keccak-hashed into a Merkle leaf, folded through the proof
// (sorted pairs), and compared to Relay.merkleRoots(100, votingRoundId) read
// on-chain. Leaf construction and the protocol id (100 = FTSO Scaling) were
// confirmed empirically against FtsoV2Interface.verifyFeedData on Coston2.
//
// Endpoints: https://dev.flare.network/network/overview (DA layer per network);
// schema: <da-host>/api/v0/ftso/{anchor-feed-names,anchor-feeds-with-proof}.
import {
  keccak256,
  encodeAbiParameters,
  getAddress,
  type Hex,
  type AbiParameter,
} from "viem";
import { getClient, type NetworkType } from "./rpc.js";
import { getContractAddress, getInterfaceAbi } from "./contracts.js";
import { daLayerBase, foldMerkleProof } from "./fdc.js";

// FTSO Scaling is protocol id 100 on the Flare Systems Protocol Relay.
export const FTSO_SCALING_PROTOCOL_ID = 100;
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const PUBLIC_API_KEY = "00000000-0000-0000-0000-000000000000";
function daApiKey(): string {
  return process.env.FLARE_DA_API_KEY ?? PUBLIC_API_KEY;
}

export interface AnchorFeedBody {
  votingRoundId: number;
  id: Hex;
  value: number;
  turnoutBIPS: number;
  decimals: number;
}

export interface AnchorFeedWithProof {
  body: AnchorFeedBody;
  proof: Hex[];
}

// The Merkle leaf body struct, per IFtsoFeedPublisher / FtsoV2Interface.
const FEED_BODY_ABI: AbiParameter = {
  type: "tuple",
  components: [
    { name: "votingRoundId", type: "uint32" },
    { name: "id", type: "bytes21" },
    { name: "value", type: "int32" },
    { name: "turnoutBIPS", type: "uint16" },
    { name: "decimals", type: "int8" },
  ],
};

/** keccak256(abi.encode(body)) — the anchor-feed Merkle leaf (single hash). */
export function anchorFeedLeaf(body: AnchorFeedBody): Hex {
  return keccak256(encodeAbiParameters([FEED_BODY_ABI], [body]));
}

export async function latestVotingRound(network: NetworkType): Promise<number> {
  const res = await fetch(
    `${daLayerBase(network)}/api/v0/fsp/latest-voting-round`,
    { headers: { "x-api-key": daApiKey() } },
  );
  if (!res.ok) {
    throw new Error(`DA layer latest-voting-round failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { voting_round_id: number };
  return data.voting_round_id;
}

// Feed-name → id map, cached per network (the anchor-feed catalog is ~100+).
const nameCache = new Map<NetworkType, Map<string, Hex>>();

export async function resolveAnchorFeedId(
  nameOrId: string,
  network: NetworkType,
): Promise<Hex> {
  if (/^0x[0-9a-fA-F]{42}$/.test(nameOrId)) {
    return nameOrId.toLowerCase() as Hex;
  }
  let cache = nameCache.get(network);
  if (!cache) {
    const res = await fetch(
      `${daLayerBase(network)}/api/v0/ftso/anchor-feed-names`,
      { headers: { "x-api-key": daApiKey() } },
    );
    if (!res.ok) {
      throw new Error(`DA layer anchor-feed-names failed (HTTP ${res.status})`);
    }
    const list = (await res.json()) as Array<{ feed_id: string; feed_name: string }>;
    cache = new Map(
      list.map((f) => [f.feed_name.toUpperCase(), f.feed_id.toLowerCase() as Hex]),
    );
    nameCache.set(network, cache);
  }
  const id = cache.get(nameOrId.toUpperCase());
  if (!id) {
    throw new Error(
      `Unknown FTSO feed "${nameOrId}". Use a known name (e.g. "FLR/USD") or a raw bytes21 feed id.`,
    );
  }
  return id;
}

export async function fetchAnchorFeeds(
  feedIds: Hex[],
  votingRoundId: number,
  network: NetworkType,
): Promise<AnchorFeedWithProof[]> {
  const res = await fetch(
    `${daLayerBase(network)}/api/v0/ftso/anchor-feeds-with-proof?voting_round_id=${votingRoundId}`,
    {
      method: "POST",
      headers: { "x-api-key": daApiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ feed_ids: feedIds }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `DA layer anchor-feeds-with-proof failed (HTTP ${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as AnchorFeedWithProof[];
}

/**
 * Local, trust-minimized verification: fold the anchor-feed leaf through the
 * proof and compare to the FTSO Scaling Merkle root read on-chain from the
 * Relay. No trust in the DA API response.
 */
export async function verifyAnchorFeed(
  feed: AnchorFeedWithProof,
  network: NetworkType,
): Promise<{ verified: boolean; merkleRoot: Hex }> {
  const relay = getAddress(await getContractAddress("Relay", network));
  const root = (await getClient(network).readContract({
    address: relay,
    abi: getInterfaceAbi("IRelay", network),
    functionName: "merkleRoots",
    args: [BigInt(FTSO_SCALING_PROTOCOL_ID), BigInt(feed.body.votingRoundId)],
  })) as Hex;
  if (root.toLowerCase() === ZERO_BYTES32) {
    return { verified: false, merkleRoot: root };
  }
  const computed = foldMerkleProof(anchorFeedLeaf(feed.body), feed.proof);
  return {
    verified: computed.toLowerCase() === root.toLowerCase(),
    merkleRoot: root,
  };
}

/** Human-readable price from an anchor-feed body (value scaled by decimals). */
export function anchorFeedPrice(body: AnchorFeedBody): number {
  return Number(body.value) / 10 ** Number(body.decimals);
}

/**
 * Latest finalized round that actually has anchor data for the given feeds.
 * The very latest started round may not be finalized yet, so step back.
 */
export async function fetchLatestFinalizedAnchor(
  feedIds: Hex[],
  network: NetworkType,
): Promise<{ votingRoundId: number; feeds: AnchorFeedWithProof[] }> {
  const latest = await latestVotingRound(network);
  // The current round is not finalized yet; step back until one has data.
  // Tolerate per-round errors (an unfinalized round can return an HTTP error).
  for (let round = latest - 1; round >= latest - 5; round--) {
    try {
      const feeds = await fetchAnchorFeeds(feedIds, round, network);
      if (feeds.length > 0) {
        return { votingRoundId: round, feeds };
      }
    } catch {
      // not finalized / transient — try an earlier round
    }
  }
  throw new Error(
    `No finalized anchor feed found in the last few voting rounds on ${network}.`,
  );
}
