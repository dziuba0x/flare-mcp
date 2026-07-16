// FDC tools: get_fdc_proof_status
import { z } from "zod";
import { getAddress } from "viem";
import { getClient, type NetworkType } from "../utils/rpc.js";
import { getContractAddress } from "../utils/contracts.js";

// FDC is protocol id 200 on the Flare Systems Protocol / Relay.
const FDC_PROTOCOL_ID = 200n;
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const RELAY_ABI = [
  {
    name: "getProtocolMessageMerkleRoot",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_protocolId", type: "uint256" },
      { name: "_votingRoundId", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    // Older Relay deployments expose the roots via a public mapping instead.
    name: "merkleRoots",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_protocolId", type: "uint256" },
      { name: "_votingRoundId", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

export const getFdcProofStatusInput = {
  voting_round_id: z.number().int().positive(),
  network: z.enum(["mainnet", "coston2", "songbird", "coston"]),
};

export async function getFdcProofStatus(args: {
  voting_round_id: number;
  network: NetworkType;
}) {
  const { voting_round_id, network } = args;
  try {
    const relay = getAddress(await getContractAddress("Relay", network));
    const client = getClient(network);

    let merkleRoot: string;
    try {
      merkleRoot = (await client.readContract({
        address: relay,
        abi: RELAY_ABI,
        functionName: "getProtocolMessageMerkleRoot",
        args: [FDC_PROTOCOL_ID, BigInt(voting_round_id)],
      })) as string;
    } catch {
      merkleRoot = (await client.readContract({
        address: relay,
        abi: RELAY_ABI,
        functionName: "merkleRoots",
        args: [FDC_PROTOCOL_ID, BigInt(voting_round_id)],
      })) as string;
    }

    const finalized = merkleRoot.toLowerCase() !== ZERO_BYTES32;

    const result = {
      voting_round_id,
      merkle_root: merkleRoot,
      security_status: finalized ? "finalized" : "not_finalized",
      network,
      protocol: "FDC",
      protocol_id: Number(FDC_PROTOCOL_ID),
      relay_address: relay,
      timestamp: Date.now(),
      ...(finalized
        ? {}
        : {
            note: "No FDC Merkle root is stored on the Relay for this voting round. It may not be finalized yet, or it predates the Relay's retained history.",
          }),
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
          text: `Failed to fetch FDC proof status for voting round ${voting_round_id} on ${network}: ${message}`,
        },
      ],
    };
  }
}
