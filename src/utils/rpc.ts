import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Chain, PublicClient, WalletClient, Account } from "viem";

// Networks and chain ids per https://dev.flare.network/network/overview
export type NetworkType = "mainnet" | "coston2" | "songbird" | "coston";

export const NETWORKS: readonly NetworkType[] = [
  "mainnet",
  "coston2",
  "songbird",
  "coston",
];

const flareMainnet: Chain = {
  id: 14,
  name: "Flare",
  nativeCurrency: { name: "Flare", symbol: "FLR", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.FLARE_RPC ?? "https://flare-api.flare.network/ext/C/rpc"],
    },
  },
};

const flareCoston2: Chain = {
  id: 114,
  name: "Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.FLARE_RPC_TESTNET ?? "https://coston2-api.flare.network/ext/C/rpc"],
    },
  },
};

const songbird: Chain = {
  id: 19,
  name: "Songbird",
  nativeCurrency: { name: "Songbird", symbol: "SGB", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.FLARE_RPC_SONGBIRD ?? "https://songbird-api.flare.network/ext/C/rpc"],
    },
  },
};

const coston: Chain = {
  id: 16,
  name: "Coston",
  nativeCurrency: { name: "Coston Flare", symbol: "CFLR", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.FLARE_RPC_COSTON ?? "https://coston-api.flare.network/ext/C/rpc"],
    },
  },
};

const chains: Record<NetworkType, Chain> = {
  mainnet: flareMainnet,
  coston2: flareCoston2,
  songbird,
  coston,
};

const clients: Partial<Record<NetworkType, PublicClient>> = {};

export function getClient(network: NetworkType): PublicClient {
  let client = clients[network];
  if (!client) {
    client = createPublicClient({ chain: chains[network], transport: http() });
    clients[network] = client;
  }
  return client;
}

/**
 * Optional local signer for tools that must submit a transaction (e.g. FDC
 * attestation requests). The key is read from FLARE_PRIVATE_KEY, used only to
 * sign locally, and is never logged or sent anywhere except as a signed tx to
 * the configured RPC. Returns null when no key is configured; callers must
 * degrade to a prepare-only mode.
 */
export function getSigner(
  network: NetworkType,
): { wallet: WalletClient; account: Account } | null {
  const key = process.env.FLARE_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    return null;
  }
  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: chains[network],
    transport: http(),
  });
  return { wallet, account };
}
