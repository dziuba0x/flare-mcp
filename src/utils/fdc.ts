// FDC (Flare Data Connector) helpers shared by the fdc_* tools.
//
// Endpoints and workflow per official docs:
//   https://dev.flare.network/network/overview        (verifier + DA layer hosts)
//   https://dev.flare.network/fdc/guides/fdc-by-hand  (request → fee → submit → proof → verify)
//   https://dev.flare.network/fdc/getting-started     (verifier path format, EVM sources)
import {
  encodeAbiParameters,
  keccak256,
  concat,
  hexToBigInt,
  type AbiParameter,
  type Hex,
} from "viem";
import { getInterfaceAbi } from "./contracts.js";
import type { NetworkType } from "./rpc.js";

// FDC is protocol id 200 on the Flare Systems Protocol Relay.
// Source: https://dev.flare.network/fdc/overview
export const FDC_PROTOCOL_ID = 200;

export const ATTESTATION_TYPES = [
  "Payment",
  "AddressValidity",
  "EVMTransaction",
] as const;
export type AttestationType = (typeof ATTESTATION_TYPES)[number];

export const SOURCE_CHAINS = ["xrp", "btc", "doge", "eth", "flr", "sgb"] as const;
export type SourceChain = (typeof SOURCE_CHAINS)[number];

// Flare-hosted verifier + Data Availability hosts per network.
// Source: https://dev.flare.network/network/overview (API Resources section)
const VERIFIER_BASE: Record<NetworkType, string> = {
  mainnet: "https://fdc-verifiers-mainnet.flare.network",
  songbird: "https://fdc-verifiers-mainnet.flare.network",
  coston2: "https://fdc-verifiers-testnet.flare.network",
  coston: "https://fdc-verifiers-testnet.flare.network",
};

const DA_LAYER_BASE: Record<NetworkType, string> = {
  mainnet: "https://flr-data-availability.flare.network",
  songbird: "https://sgb-data-availability.flare.network",
  coston2: "https://ctn2-data-availability.flare.network",
  coston: "https://ctn-data-availability.flare.network",
};

// Public API key documented at https://dev.flare.network/network/overview
const PUBLIC_API_KEY = "00000000-0000-0000-0000-000000000000";

function verifierApiKey(): string {
  return process.env.FDC_VERIFIER_API_KEY ?? PUBLIC_API_KEY;
}

function daApiKey(): string {
  return process.env.FLARE_DA_API_KEY ?? PUBLIC_API_KEY;
}

export function daLayerBase(network: NetworkType): string {
  return process.env.FLARE_DA_URL ?? DA_LAYER_BASE[network];
}

function isTestnet(network: NetworkType): boolean {
  return network === "coston" || network === "coston2";
}

/** UTF-8 → hex, right-padded to 32 bytes (attestationType / sourceId format). */
export function encodeAttestationName(name: string): Hex {
  let hex = "";
  for (let i = 0; i < name.length; i++) {
    hex += name.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return `0x${hex.padEnd(64, "0")}` as Hex;
}

// Verifier URL path segment and sourceId string per chain.
// Testnet source names/paths per https://dev.flare.network/fdc/guides/fdc-by-hand
// (testXRP, testBTC on btc_testnet4, testDOGE) and
// https://dev.flare.network/fdc/getting-started (eth path, testETH source).
export function sourceIdName(chain: SourceChain, network: NetworkType): string {
  const map: Record<SourceChain, string> = {
    xrp: "XRP",
    btc: "BTC",
    doge: "DOGE",
    eth: "ETH",
    flr: "FLR",
    sgb: "SGB",
  };
  const base = map[chain];
  return isTestnet(network) ? `test${base}` : base;
}

export function verifierPathSegment(
  chain: SourceChain,
  network: NetworkType,
): string {
  if (chain === "btc" && isTestnet(network)) {
    return "btc_testnet4";
  }
  return chain;
}

/** Which source chains make sense for each attestation type. */
export const TYPE_SOURCES: Record<AttestationType, readonly SourceChain[]> = {
  Payment: ["xrp", "btc", "doge"],
  AddressValidity: ["xrp", "btc", "doge"],
  EVMTransaction: ["eth", "flr", "sgb"],
};

export interface PreparedRequest {
  status: string;
  abiEncodedRequest?: Hex;
}

/**
 * Verifier servers require numeric requestBody fields as decimal strings
 * (e.g. inUtxo: "0", requiredConfirmations: "1"); booleans stay booleans.
 * Convert numbers/bigints so callers can pass natural JSON.
 */
export function stringifyNumbers(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(stringifyNumbers);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stringifyNumbers(v)]),
    );
  }
  return value;
}

/**
 * Ask a Flare-hosted verifier to validate the request body and produce the
 * abiEncodedRequest accepted by FdcHub.requestAttestation.
 */
export async function prepareAttestationRequest(
  type: AttestationType,
  chain: SourceChain,
  requestBody: Record<string, unknown>,
  network: NetworkType,
): Promise<PreparedRequest> {
  const url = `${VERIFIER_BASE[network]}/verifier/${verifierPathSegment(chain, network)}/${type}/prepareRequest`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-KEY": verifierApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      attestationType: encodeAttestationName(type),
      sourceId: encodeAttestationName(sourceIdName(chain, network)),
      requestBody: stringifyNumbers(requestBody),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Verifier prepareRequest failed (HTTP ${res.status}) at ${url}: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as PreparedRequest;
}

export interface DaProofResponse {
  response: {
    attestationType: Hex;
    sourceId: Hex;
    votingRound: string | number;
    lowestUsedTimestamp: string | number;
    requestBody: Record<string, unknown>;
    responseBody: Record<string, unknown>;
  };
  proof: Hex[];
}

/**
 * JSON.parse loses precision on uint64 values like lowestUsedTimestamp =
 * 2^64-1 (a documented pitfall: https://dev.flare.network/fdc/guides/fdc-by-hand).
 * Quote any bare integer of 16+ digits before parsing so it survives as a
 * string; normalizeForAbi turns those back into bigints for encoding.
 */
export function parseDaJson<T>(text: string): T {
  const quoted = text.replace(
    /([:[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
    '$1"$2"',
  );
  return JSON.parse(quoted) as T;
}

/** Recursively convert pure-digit strings into bigints for ABI encoding. */
export function normalizeForAbi(value: unknown): unknown {
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForAbi);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeForAbi(v)]),
    );
  }
  return value;
}

/**
 * Fetch the attestation response + Merkle proof from the Data Availability
 * layer for a finalized voting round.
 */
export async function fetchProofFromDaLayer(
  votingRoundId: number,
  requestBytes: Hex,
  network: NetworkType,
): Promise<DaProofResponse> {
  const url = `${daLayerBase(network)}/api/v1/fdc/proof-by-request-round`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": daApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ votingRoundId, requestBytes }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `DA layer proof request failed (HTTP ${res.status}) at ${url}: ${text.slice(0, 300)}`,
    );
  }
  return parseDaJson<DaProofResponse>(text);
}

/**
 * ABI parameter describing the attestation Response struct, extracted from
 * the official IFdcVerification interface (verify<Type> takes a Proof struct
 * of { bytes32[] merkleProof, Response data }).
 */
export function responseAbiParameter(
  type: AttestationType,
  network: NetworkType,
): AbiParameter {
  const abi = getInterfaceAbi("IFdcVerification", network);
  const fn = abi.find(
    (e) => e.type === "function" && e.name === `verify${type}`,
  );
  if (!fn || fn.type !== "function") {
    throw new Error(`IFdcVerification has no verify${type} function`);
  }
  const proofParam = fn.inputs[0];
  if (!("components" in proofParam) || !proofParam.components) {
    throw new Error(`verify${type} proof parameter has no components`);
  }
  const data = proofParam.components.find((c) => c.name === "data");
  if (!data) {
    throw new Error(`verify${type} proof struct has no data component`);
  }
  return data;
}

/**
 * Merkle leaf for an FDC attestation response:
 * keccak256(abi.encode(Response)) — mirrors FdcVerification.sol.
 */
export function computeResponseLeaf(
  responseAbi: AbiParameter,
  response: DaProofResponse["response"],
): Hex {
  return keccak256(
    encodeAbiParameters([responseAbi], [normalizeForAbi(response)]),
  );
}

/**
 * OpenZeppelin-style sorted-pair Merkle proof fold, as used by
 * FdcVerification via MerkleProof.verifyCalldata.
 */
export function foldMerkleProof(leaf: Hex, proof: readonly Hex[]): Hex {
  let computed = leaf;
  for (const sibling of proof) {
    computed =
      hexToBigInt(computed) < hexToBigInt(sibling)
        ? keccak256(concat([computed, sibling]))
        : keccak256(concat([sibling, computed]));
  }
  return computed;
}
