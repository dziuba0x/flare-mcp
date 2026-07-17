// Tool/resource registration shared by the stdio entry and the HTTP hub.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getFlrBalance,
  getFlrBalanceInput,
} from "./tools/wallet.js";
import {
  getFtsoFeed,
  getFtsoFeedInput,
  getFtsoFeedsAll,
  getFtsoFeedsAllInput,
  getFtsoProviders,
  getFtsoProvidersInput,
  getFtsoHistory,
  getFtsoHistoryInput,
} from "./tools/ftso.js";
import {
  getFassetsStatus,
  getFassetsStatusInput,
} from "./tools/fassets.js";
import {
  getFdcProofStatus,
  getFdcProofStatusInput,
} from "./tools/fdc.js";
import {
  getSmartAccountInfo,
  getSmartAccountInfoInput,
} from "./tools/smart-accounts.js";
import {
  fdcRequestAttestation,
  fdcRequestAttestationInput,
  fdcGetAttestationProof,
  fdcGetAttestationProofInput,
} from "./tools/fdc-v2.js";
import {
  fassetsAgentStatus,
  fassetsAgentStatusInput,
  fassetsSystemState,
  fassetsSystemStateInput,
} from "./tools/fassets-v2.js";
import {
  songbirdFccRegistry,
  songbirdFccRegistryInput,
} from "./tools/fcc.js";
import {
  fassetsLiquidationScanner,
  fassetsLiquidationScannerInput,
  fdcBulkProofBundle,
  fdcBulkProofBundleInput,
} from "./tools/premium.js";
import { registerNetworkResources } from "./resources/network.js";


export const SERVER_INFO = { name: "flare-mcp", version: "0.4.0" } as const;

export function buildServer(): McpServer {
  const server = new McpServer({ ...SERVER_INFO });

server.tool(
  "get_flr_balance",
  "Get native FLR balance and wrapped WFLR (WNat) balance for an EVM address on Flare mainnet or Coston2 testnet.",
  getFlrBalanceInput,
  getFlrBalance,
);

server.tool(
  "get_ftso_feed",
  "Get the latest FTSO price feed (value, decimals, timestamp) for a feed by name (e.g. \"FLR/USD\") or raw bytes21 feed id.",
  getFtsoFeedInput,
  getFtsoFeed,
);

server.tool(
  "get_ftso_feeds_all",
  "Get the latest FTSO price for all known feeds on the given network.",
  getFtsoFeedsAllInput,
  getFtsoFeedsAll,
);

server.tool(
  "get_ftso_providers",
  "Get the list of active FTSO data providers (name, address, vote power, fee, reward rate) for the given network.",
  getFtsoProvidersInput,
  getFtsoProviders,
);

server.tool(
  "get_ftso_history",
  "Get recent historical FTSO results for a feed (by name or bytes21 id) from the Flare Data Availability layer.",
  getFtsoHistoryInput,
  getFtsoHistory,
);

server.tool(
  "get_fassets_status",
  "Get FAssets status (total minted, active agent count) for FXRP, FBTC or FDOGE on the given network, via the on-chain AssetManager with a flaremetrics.io fallback.",
  getFassetsStatusInput,
  getFassetsStatus,
);

server.tool(
  "get_fdc_proof_status",
  "Get the FDC (protocol id 200) Merkle root and finalization status for a voting round from the Flare Relay contract.",
  getFdcProofStatusInput,
  getFdcProofStatus,
);

server.tool(
  "get_smart_account_info",
  "Resolve the deterministic Flare address for an XRPL account (r... format) via the MasterAccountController, and report whether the Smart Account exists on-chain.",
  getSmartAccountInfoInput,
  getSmartAccountInfo,
);

server.tool(
  "fdc_request_attestation",
  "Submit an FDC attestation request (Payment, AddressValidity or EVMTransaction). Prepares the request via a Flare-hosted verifier, queries the request fee, and — if FLARE_PRIVATE_KEY is set — submits it to FdcHub, returning the tx hash and voting round id. Without a key it returns the prepared request for external submission.",
  fdcRequestAttestationInput,
  fdcRequestAttestation,
);

server.tool(
  "fdc_get_attestation_proof",
  "Retrieve an FDC attestation proof from the Data Availability layer for a finalized voting round and verify the Merkle proof locally against the on-chain Relay root (no trust in the DA response).",
  fdcGetAttestationProofInput,
  fdcGetAttestationProof,
);

server.tool(
  "fassets_agent_status",
  "List FAssets agents (FXRP first) with collateral ratios, minting capacity (free lots), minted/reserved amounts and liquidation status, sorted by vault collateral ratio (riskiest first).",
  fassetsAgentStatusInput,
  fassetsAgentStatus,
);

server.tool(
  "fassets_system_state",
  "Global FAssets system state for an asset: total minted, agent count, lot size, minting cap/pause, aggregated vault+pool collateral, and the redemption queue (tickets, value, lots).",
  fassetsSystemStateInput,
  fassetsSystemState,
);

server.tool(
  "fassets_liquidation_scanner",
  "PREMIUM (x402): FAssets agents ranked by liquidation risk, joined with live FTSOv2 prices — per agent: CR headroom, the underlying price at which liquidation starts, and the % price move away from it. Free when the operator has not enabled x402.",
  fassetsLiquidationScannerInput,
  fassetsLiquidationScanner,
);

server.tool(
  "fdc_bulk_proof_bundle",
  "PREMIUM (x402): batch retrieval of up to 20 FDC attestation proofs with local Merkle verification of each against the on-chain Relay root. Free when the operator has not enabled x402.",
  fdcBulkProofBundleInput,
  fdcBulkProofBundle,
);

server.tool(
  "songbird_fcc_registry",
  "Scan the live FlareContractRegistry (Songbird by default) for Flare Confidential Compute contracts (PMW, TEE, compute extensions). Reports FCC deployment status post-STP.13 and lists FDC/Relay contracts plus the full registry.",
  songbirdFccRegistryInput,
  songbirdFccRegistry,
);

registerNetworkResources(server);

  return server;
}
