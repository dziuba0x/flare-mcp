// Wallet tools: get_flr_balance
import { z } from "zod";
import { formatEther, getAddress } from "viem";
import { getClient, type NetworkType } from "../utils/rpc.js";
import { getWNatAddress } from "../utils/contracts.js";

const ERC20_ABI = [
  {
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    type: "function",
    stateMutability: "view",
  },
] as const;

export const getFlrBalanceInput = {
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  network: z.enum(["mainnet", "coston2", "songbird", "coston"]),
};

export async function getFlrBalance(args: {
  address: string;
  network: NetworkType;
}) {
  const { address, network } = args;
  try {
    const client = getClient(network);
    const account = getAddress(address);

    const native = await client.getBalance({ address: account });

    const wnat = getAddress(await getWNatAddress(network));
    const wflr = (await client.readContract({
      address: wnat,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account],
    })) as bigint;

    const result = {
      address: account,
      flr_balance: formatEther(native),
      wflr_balance: formatEther(wflr),
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
          text: `Failed to fetch balance for ${address} on ${network}: ${message}`,
        },
      ],
    };
  }
}
