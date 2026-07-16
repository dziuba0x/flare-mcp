// Phase 1 acceptance: exercise every new tool against live public RPCs.
// Run: npx tsx scripts/live-check.ts
import { readFileSync } from "node:fs";
import { getClient } from "../src/utils/rpc.js";
import { getContractAddress, getInterfaceAbi } from "../src/utils/contracts.js";
import {
  responseAbiParameter,
  computeResponseLeaf,
  foldMerkleProof,
  parseDaJson,
  FDC_PROTOCOL_ID,
  type AttestationType,
  type DaProofResponse,
} from "../src/utils/fdc.js";
import {
  fdcRequestAttestation,
  fdcGetAttestationProof,
} from "../src/tools/fdc-v2.js";
import {
  fassetsAgentStatus,
  fassetsSystemState,
} from "../src/tools/fassets-v2.js";
import { songbirdFccRegistry } from "../src/tools/fcc.js";
import { getAddress, type Hex } from "viem";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) failures++;
}

function parseTool(res: { isError?: boolean; content: Array<{ text: string }> }): Record<string, unknown> {
  if (res.isError) throw new Error(res.content[0].text);
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

const ROUND = 1397600;
const fixture = parseDaJson<DaProofResponse[]>(
  readFileSync(new URL("../test/fixtures/coston2-round-1397600.json", import.meta.url), "utf8"),
);

// 1. Local Merkle verification of recorded Payment + AddressValidity
//    attestations against the on-chain Coston2 Relay root.
const client = getClient("coston2");
const relay = getAddress(await getContractAddress("Relay", "coston2"));
const root = (await client.readContract({
  address: relay,
  abi: getInterfaceAbi("IRelay", "coston2"),
  functionName: "merkleRoots",
  args: [BigInt(FDC_PROTOCOL_ID), BigInt(ROUND)],
})) as Hex;
check("relay root nonzero", !/^0x0+$/.test(root), root);

for (const typeName of ["Payment", "AddressValidity"] as AttestationType[]) {
  const hex = "0x" + Buffer.from(typeName, "utf8").toString("hex").padEnd(64, "0");
  const item = fixture.find((a) => a.response.attestationType === hex);
  if (!item) { check(`${typeName} in fixture`, false); continue; }
  const leaf = computeResponseLeaf(responseAbiParameter(typeName, "coston2"), item.response);
  const computed = foldMerkleProof(leaf, item.proof);
  check(`${typeName} local merkle verify`, computed.toLowerCase() === root.toLowerCase(), computed);
}

// 2. fdc_request_attestation in prepared_only mode (verifier + fee + registry).
const payment = fixture[0].response;
const reqRes = parseTool(await fdcRequestAttestation({
  attestation_type: "Payment",
  source_chain: "xrp",
  request_body: payment.requestBody,
  network: "coston2",
}));
check("fdc_request_attestation prepared_only", reqRes.mode === "prepared_only" && typeof reqRes.abi_encoded_request === "string", `fee=${String(reqRes.request_fee_wei)} wei`);

// 3. fdc_get_attestation_proof full path: DA fetch + local verification.
const proofRes = parseTool(await fdcGetAttestationProof({
  voting_round_id: ROUND,
  abi_encoded_request: reqRes.abi_encoded_request as string,
  network: "coston2",
}));
check("fdc_get_attestation_proof verified", proofRes.verified === true, `root=${String(proofRes.merkle_root).slice(0, 18)}…`);

// 4. FAssets tools on all three target networks.
for (const network of ["mainnet", "coston2", "songbird"] as const) {
  try {
    const sys = parseTool(await fassetsSystemState({ asset: "FXRP", network }));
    check(`fassets_system_state ${network}`, Number(sys.total_agents) > 0,
      `minted=${String(sys.total_minted)} agents=${String(sys.total_agents)} queue=${JSON.stringify(sys.redemption_queue)}`);
  } catch (e) { check(`fassets_system_state ${network}`, false, (e as Error).message.slice(0, 120)); }
  try {
    const ag = parseTool(await fassetsAgentStatus({ asset: "FXRP", network, max_agents: 8 }));
    const agents = ag.agents as Array<Record<string, unknown>>;
    check(`fassets_agent_status ${network}`, agents.length > 0,
      `returned=${agents.length}/${String(ag.total_agents)} riskiest CR=${String(agents[0]?.vault_collateral_ratio)}`);
  } catch (e) { check(`fassets_agent_status ${network}`, false, (e as Error).message.slice(0, 120)); }
}

// 5. songbird_fcc_registry.
const fcc = parseTool(await songbirdFccRegistry({ network: "songbird" }));
check("songbird_fcc_registry", typeof fcc.fcc_status === "string" && Number(fcc.registry_size) > 0,
  `status=${String(fcc.fcc_status)} registry=${String(fcc.registry_size)} related=${(fcc.related_contracts as unknown[]).length}`);

process.stdout.write(failures ? `\n${failures} FAILURES\n` : "\nALL LIVE CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
