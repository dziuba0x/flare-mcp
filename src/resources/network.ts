// MCP resources: flare://network/feeds, flare://network/contracts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  FTSO_FEEDS,
  CONTRACT_REGISTRY_ADDRESS,
} from "../utils/contracts.js";

const FEEDS_URI = "flare://network/feeds";
const CONTRACTS_URI = "flare://network/contracts";

const CONTRACTS_PAYLOAD = {
  contract_registry: {
    address: CONTRACT_REGISTRY_ADDRESS,
    note: "Same address on Flare mainnet (chainId 14) and Coston2 testnet (chainId 114).",
  },
  usage:
    "Resolve any Flare contract address at runtime via ContractRegistry.getContractAddressByName(name). " +
    "Examples: FtsoV2, WNat, Relay, MasterAccountController.",
  networks: {
    mainnet: {
      chain_id: 14,
      rpc: "https://flare-api.flare.network/ext/C/rpc",
    },
    coston2: {
      chain_id: 114,
      rpc: "https://coston2-api.flare.network/ext/C/rpc",
    },
  },
} as const;

export function registerNetworkResources(server: McpServer): void {
  server.resource(
    "flare-feeds",
    FEEDS_URI,
    {
      description:
        "List of known FTSO price feeds on Flare (feed id, name, category).",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(FTSO_FEEDS, null, 2),
        },
      ],
    }),
  );

  server.resource(
    "flare-contracts",
    CONTRACTS_URI,
    {
      description:
        "Flare ContractRegistry address and instructions for resolving contract addresses at runtime.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(CONTRACTS_PAYLOAD, null, 2),
        },
      ],
    }),
  );
}
