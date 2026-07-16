import { interfaceToAbi } from "@flarenetwork/flare-periphery-contract-artifacts";
import type { Abi } from "viem";
import { getClient, type NetworkType } from "./rpc.js";

// FlareContractRegistry, same address on all Flare networks.
// Source: https://dev.flare.network/network/guides/flare-contracts-registry
export const CONTRACT_REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const;

export const CONTRACT_REGISTRY_ABI = [
  {
    name: "getContractAddressByName",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getAllContracts",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_names", type: "string[]" },
      { name: "_addresses", type: "address[]" },
    ],
  },
] as const;

// The artifacts package keys networks as flare/songbird/coston/coston2.
const ARTIFACT_NETWORK: Record<NetworkType, string> = {
  mainnet: "flare",
  coston2: "coston2",
  songbird: "songbird",
  coston: "coston",
};

/**
 * Official Flare interface ABI from
 * @flarenetwork/flare-periphery-contract-artifacts (flare-foundation).
 */
export function getInterfaceAbi(name: string, network: NetworkType): Abi {
  return interfaceToAbi(name, ARTIFACT_NETWORK[network]) as Abi;
}

export async function getAllContracts(
  network: NetworkType,
): Promise<Array<{ name: string; address: string }>> {
  const client = getClient(network);
  const [names, addresses] = await client.readContract({
    address: CONTRACT_REGISTRY_ADDRESS,
    abi: CONTRACT_REGISTRY_ABI,
    functionName: "getAllContracts",
  });
  return names.map((name, i) => ({ name, address: addresses[i] }));
}

export async function getContractAddress(
  name: string,
  network: NetworkType,
): Promise<string> {
  const client = getClient(network);
  const address = await client.readContract({
    address: CONTRACT_REGISTRY_ADDRESS,
    abi: CONTRACT_REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: [name],
  });
  return address as string;
}

export async function getWNatAddress(network: NetworkType): Promise<string> {
  return getContractAddress("WNat", network);
}

export const FTSO_FEEDS: ReadonlyArray<{
  id: string;
  name: string;
  category: number;
}> = [
  { name: "FLR/USD",  id: "0x01464c522f55534400000000000000000000000000", category: 1 },
  { name: "BTC/USD",  id: "0x014254432f55534400000000000000000000000000", category: 1 },
  { name: "ETH/USD",  id: "0x014554482f55534400000000000000000000000000", category: 1 },
  { name: "XRP/USD",  id: "0x015852502f55534400000000000000000000000000", category: 1 },
  { name: "DOGE/USD", id: "0x01444f47452f555344000000000000000000000000", category: 1 },
  { name: "ADA/USD",  id: "0x014144412f55534400000000000000000000000000", category: 1 },
  { name: "SOL/USD",  id: "0x01534f4c2f55534400000000000000000000000000", category: 1 },
  { name: "AVAX/USD", id: "0x01415641582f555344000000000000000000000000", category: 1 },
  { name: "MATIC/USD",id: "0x014d415449432f5553440000000000000000000000", category: 1 },
  { name: "DOT/USD",  id: "0x01444f542f55534400000000000000000000000000", category: 1 },
  { name: "LINK/USD", id: "0x014c494e4b2f555344000000000000000000000000", category: 1 },
  { name: "ALGO/USD", id: "0x01414c474f2f555344000000000000000000000000", category: 1 },
  { name: "ATOM/USD", id: "0x0141544f4d2f555344000000000000000000000000", category: 1 },
  { name: "LTC/USD",  id: "0x014c54432f55534400000000000000000000000000", category: 1 },
  { name: "UNI/USD",  id: "0x01554e492f55534400000000000000000000000000", category: 1 },
] as const;
