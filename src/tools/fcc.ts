// FCC tool: songbird_fcc_registry
//
// Flare Confidential Compute (FCC) status per
// https://dev.flare.network/fcc/overview (checked 2026-07-15): "it is not yet
// publicly available". Accordingly, this tool reads the live
// FlareContractRegistry and scans it for FCC-related deployments (PMW, TEE,
// FDC-V2 registries), so it reports them the moment they become publicly
// addressable — and states clearly that they are not there yet.
import { z } from "zod";
import { getAllContracts } from "../utils/contracts.js";
import type { NetworkType } from "../utils/rpc.js";

// Name fragments associated with FCC system applications (PMW, TEE machines,
// compute extensions) per https://dev.flare.network/fcc/overview terminology.
const FCC_NAME_PATTERNS: readonly RegExp[] = [
  /fcc/i,
  /confidential/i,
  /tee/i,
  /pmw/i,
  /protocolmanagedwallet/i,
  /computeextension/i,
  /fce/i,
];

// Pre-FCC contracts that merely *relate* to the newer stack (FDC, smart
// accounts), reported separately so the FCC match list stays honest.
const ADJACENT_NAMES: readonly string[] = [
  "FdcHub",
  "FdcVerification",
  "FdcRequestFeeConfigurations",
  "FdcInflationConfigurations",
  "Relay",
  "MasterAccountController",
];

export function classifyRegistry(
  contracts: ReadonlyArray<{ name: string; address: string }>,
) {
  const fccMatches = contracts.filter((c) =>
    FCC_NAME_PATTERNS.some((p) => p.test(c.name)),
  );
  const adjacent = contracts.filter((c) => ADJACENT_NAMES.includes(c.name));
  return { fccMatches, adjacent };
}

export const songbirdFccRegistryInput = {
  network: z.enum(["songbird", "coston", "mainnet", "coston2"]).default("songbird"),
};

export async function songbirdFccRegistry(args: { network?: NetworkType }) {
  const network = args.network ?? "songbird";
  try {
    const contracts = await getAllContracts(network);
    const { fccMatches, adjacent } = classifyRegistry(contracts);

    const result = {
      network,
      fcc_status:
        fccMatches.length > 0
          ? "fcc_contracts_found"
          : "not_yet_publicly_addressable",
      note:
        fccMatches.length > 0
          ? "FCC-related contracts detected in the FlareContractRegistry."
          : "No FCC/PMW/TEE contracts are registered in the FlareContractRegistry yet. Per https://dev.flare.network/fcc/overview, FCC is in final development and not yet publicly available; STP.13 deployment has not yet surfaced public contract addresses.",
      fcc_contracts: fccMatches,
      related_contracts: adjacent,
      registry_size: contracts.length,
      all_contracts: contracts,
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
          text: `Failed to read the ${network} contract registry: ${message}`,
        },
      ],
    };
  }
}
