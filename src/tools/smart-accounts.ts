// Smart Accounts tools: get_smart_account_info
import { z } from "zod";
import { getAddress, type Address } from "viem";
import { getClient, type NetworkType } from "../utils/rpc.js";
import { getContractAddress } from "../utils/contracts.js";

// Each XRPL account maps deterministically to a Flare address via the
// MasterAccountController. The exact ABI is not yet published in the periphery
// artifacts, so we try the most likely view function and fall back to a
// placeholder response when it is unavailable.
const MASTER_ACCOUNT_CONTROLLER_ABI = [
  {
    name: "getFlareAddress",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_xrplAddress", type: "string" }],
    outputs: [{ type: "address" }],
  },
] as const;

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export const getSmartAccountInfoInput = {
  xrpl_address: z.string().startsWith("r"),
  network: z.enum(["mainnet", "coston2"]),
};

export async function getSmartAccountInfo(args: {
  xrpl_address: string;
  network: NetworkType;
}) {
  const { xrpl_address, network } = args;
  try {
    const client = getClient(network);

    let controller: Address;
    try {
      controller = getAddress(
        await getContractAddress("MasterAccountController", network),
      );
    } catch {
      controller = ZERO_ADDRESS;
    }

    if (controller === ZERO_ADDRESS) {
      const result = {
        xrpl_address,
        flare_address: null,
        has_account: false,
        network,
        note: "Smart Accounts query coming soon — MasterAccountController is not yet resolvable on this network.",
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }

    let flareAddress: Address;
    try {
      flareAddress = getAddress(
        (await client.readContract({
          address: controller,
          abi: MASTER_ACCOUNT_CONTROLLER_ABI,
          functionName: "getFlareAddress",
          args: [xrpl_address],
        })) as string,
      );
    } catch {
      const result = {
        xrpl_address,
        flare_address: null,
        has_account: false,
        network,
        controller,
        note: "Smart Accounts query coming soon — getFlareAddress is unavailable on the MasterAccountController ABI.",
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }

    const mapped = flareAddress !== ZERO_ADDRESS;
    let hasAccount = false;
    if (mapped) {
      const code = await client.getCode({ address: flareAddress });
      hasAccount = code !== undefined && code !== "0x";
    }

    const result = {
      xrpl_address,
      flare_address: mapped ? flareAddress : null,
      has_account: hasAccount,
      network,
      controller,
    };

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
          text: `Failed to fetch smart account info for ${xrpl_address} on ${network}: ${message}`,
        },
      ],
    };
  }
}
