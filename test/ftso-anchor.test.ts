// Offline tests for proof-carrying FTSO anchor feeds. The fixture is the real
// DA-layer anchor response for Coston2 voting round 1402667; EXPECTED_ROOT is
// the FTSO Scaling Merkle root for that round read from the Coston2 Relay
// (merkleRoots(100, 1402667)) on 2026-07-21 — so these tests replay the full
// local verification offline (leaf → sorted-pair fold → root), cross-confirmed
// live against FtsoV2Interface.verifyFeedData.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { foldMerkleProof } from "../src/utils/fdc.js";
import {
  anchorFeedLeaf,
  anchorFeedPrice,
  type AnchorFeedWithProof,
} from "../src/utils/ftso-da.js";

const EXPECTED_ROOT =
  "0xcbd47ac500241672c5c05075fba5d902ab625afb27b5c572be4363443d43fe0d";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/coston2-anchor-1402667.json", import.meta.url),
    "utf8",
  ),
) as AnchorFeedWithProof[];

function byName(sub: string): AnchorFeedWithProof {
  const item = fixture.find((a) => a.body.id.toLowerCase().includes(sub));
  if (!item) throw new Error(`fixture missing feed ${sub}`);
  return item;
}

describe("FTSO anchor feed: local Merkle verification", () => {
  it("verifies FLR/USD against the on-chain FTSO Scaling root", () => {
    const flr = byName("464c52"); // "FLR" in hex
    const leaf = anchorFeedLeaf(flr.body);
    expect(foldMerkleProof(leaf, flr.proof)).toBe(EXPECTED_ROOT);
  });

  it("verifies BTC/USD against the same round root", () => {
    const btc = byName("425443"); // "BTC" in hex
    const leaf = anchorFeedLeaf(btc.body);
    expect(foldMerkleProof(leaf, btc.proof)).toBe(EXPECTED_ROOT);
  });

  it("rejects a tampered value (wrong price no longer folds to the root)", () => {
    const flr = byName("464c52");
    const tampered = { ...flr.body, value: flr.body.value + 1 };
    expect(foldMerkleProof(anchorFeedLeaf(tampered), flr.proof)).not.toBe(
      EXPECTED_ROOT,
    );
  });

  it("rejects a tampered voting round", () => {
    const btc = byName("425443");
    const tampered = { ...btc.body, votingRoundId: btc.body.votingRoundId + 1 };
    expect(foldMerkleProof(anchorFeedLeaf(tampered), btc.proof)).not.toBe(
      EXPECTED_ROOT,
    );
  });

  it("scales value by decimals into a human price", () => {
    const flr = byName("464c52");
    expect(anchorFeedPrice(flr.body)).toBeCloseTo(
      flr.body.value / 10 ** flr.body.decimals,
      12,
    );
    expect(anchorFeedPrice(flr.body)).toBeGreaterThan(0);
  });
});
