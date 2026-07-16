// Recorded-fixture tests for the FDC tools (fdc_request_attestation,
// fdc_get_attestation_proof). The fixture is the real DA-layer response for
// Coston2 voting round 1397600; EXPECTED_ROOT is the FDC Merkle root for that
// round as read from the Coston2 Relay contract (merkleRoots(200, 1397600))
// on 2026-07-15 — so these tests replay a full local verification offline.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  encodeAttestationName,
  sourceIdName,
  verifierPathSegment,
  stringifyNumbers,
  parseDaJson,
  normalizeForAbi,
  responseAbiParameter,
  computeResponseLeaf,
  foldMerkleProof,
  type DaProofResponse,
} from "../src/utils/fdc.js";
import { fdcRequestAttestation } from "../src/tools/fdc-v2.js";

const EXPECTED_ROOT =
  "0x0994ec1423c623790cdedac5e0a18af68e74f4bf927d5415e60e7a243bd20359";

const fixture = parseDaJson<DaProofResponse[]>(
  readFileSync(
    new URL("./fixtures/coston2-round-1397600.json", import.meta.url),
    "utf8",
  ),
);

function byType(name: string): DaProofResponse {
  const hex =
    "0x" + Buffer.from(name, "utf8").toString("hex").padEnd(64, "0");
  const item = fixture.find((a) => a.response.attestationType === hex);
  if (!item) throw new Error(`fixture is missing ${name}`);
  return item;
}

describe("fdc_get_attestation_proof: local Merkle verification", () => {
  it("verifies a recorded Payment attestation against the Relay root", () => {
    const item = byType("Payment");
    const leaf = computeResponseLeaf(
      responseAbiParameter("Payment", "coston2"),
      item.response,
    );
    expect(foldMerkleProof(leaf, item.proof)).toBe(EXPECTED_ROOT);
  });

  it("verifies a recorded AddressValidity attestation against the Relay root", () => {
    const item = byType("AddressValidity");
    const leaf = computeResponseLeaf(
      responseAbiParameter("AddressValidity", "coston2"),
      item.response,
    );
    expect(foldMerkleProof(leaf, item.proof)).toBe(EXPECTED_ROOT);
  });

  it("rejects a tampered response", () => {
    const item = byType("Payment");
    const tampered = {
      ...item.response,
      responseBody: { ...item.response.responseBody, receivedAmount: "1" },
    };
    const leaf = computeResponseLeaf(
      responseAbiParameter("Payment", "coston2"),
      tampered,
    );
    expect(foldMerkleProof(leaf, item.proof)).not.toBe(EXPECTED_ROOT);
  });

  it("folds an empty proof to the leaf itself", () => {
    const leaf =
      "0x00000000000000000000000000000000000000000000000000000000000000aa";
    expect(foldMerkleProof(leaf, [])).toBe(leaf);
  });
});

describe("fdc_request_attestation: request encoding", () => {
  it("encodes attestation names as UTF-8 hex padded to 32 bytes", () => {
    // Constant from https://dev.flare.network/fdc/guides/fdc-by-hand
    expect(encodeAttestationName("AddressValidity")).toBe(
      "0x4164647265737356616c69646974790000000000000000000000000000000000",
    );
    // Constant from https://dev.flare.network/fdc/getting-started
    expect(encodeAttestationName("EVMTransaction")).toBe(
      "0x45564d5472616e73616374696f6e000000000000000000000000000000000000",
    );
  });

  it("maps source chains to sourceId names and verifier paths", () => {
    expect(sourceIdName("xrp", "coston2")).toBe("testXRP");
    expect(sourceIdName("xrp", "mainnet")).toBe("XRP");
    expect(sourceIdName("eth", "coston2")).toBe("testETH");
    expect(verifierPathSegment("btc", "coston2")).toBe("btc_testnet4");
    expect(verifierPathSegment("btc", "mainnet")).toBe("btc");
    expect(verifierPathSegment("xrp", "coston2")).toBe("xrp");
  });

  it("stringifies numeric requestBody fields for the verifier", () => {
    expect(
      stringifyNumbers({
        transactionId: "0xabc",
        inUtxo: 0,
        utxo: 0,
        provideInput: true,
        logIndices: [1, 2],
      }),
    ).toEqual({
      transactionId: "0xabc",
      inUtxo: "0",
      utxo: "0",
      provideInput: true,
      logIndices: ["1", "2"],
    });
  });

  it("rejects an invalid type/source combination without any network call", async () => {
    const res = await fdcRequestAttestation({
      attestation_type: "Payment",
      source_chain: "eth",
      request_body: {},
      network: "coston2",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not valid for Payment");
  });
});

describe("DA-layer JSON parsing", () => {
  it("preserves uint64 max instead of rounding it", () => {
    const parsed = parseDaJson<{ lowestUsedTimestamp: string }>(
      '{"lowestUsedTimestamp": 18446744073709551615}',
    );
    expect(parsed.lowestUsedTimestamp).toBe("18446744073709551615");
    expect(normalizeForAbi(parsed.lowestUsedTimestamp)).toBe(
      18446744073709551615n,
    );
  });

  it("leaves small numbers, hex strings and booleans intact", () => {
    const parsed = parseDaJson<Record<string, unknown>>(
      '{"votingRound": 1397600, "root": "0xdeadbeef", "ok": true}',
    );
    expect(parsed.votingRound).toBe(1397600);
    expect(parsed.root).toBe("0xdeadbeef");
    expect(normalizeForAbi(parsed.ok)).toBe(true);
  });
});
