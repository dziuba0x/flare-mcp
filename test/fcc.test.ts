// Recorded-fixture test for songbird_fcc_registry. The fixture is the full
// FlareContractRegistry.getAllContracts() result from Songbird, 2026-07-15
// (post-STP.13 vote; FCC contracts not yet publicly addressable).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { classifyRegistry } from "../src/tools/fcc.js";

interface Fixture {
  contracts: Array<{ name: string; address: string }>;
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/songbird-registry.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

describe("songbird_fcc_registry: registry classification", () => {
  it("finds no FCC contracts in the recorded post-STP.13 registry", () => {
    const { fccMatches } = classifyRegistry(fixture.contracts);
    expect(fccMatches).toEqual([]);
  });

  it("finds the FDC/Relay contracts as related infrastructure", () => {
    const { adjacent } = classifyRegistry(fixture.contracts);
    const names = adjacent.map((c) => c.name);
    expect(names).toContain("FdcHub");
    expect(names).toContain("FdcVerification");
    expect(names).toContain("Relay");
  });

  it("detects FCC contracts once they appear in the registry", () => {
    const future = [
      ...fixture.contracts,
      { name: "ProtocolManagedWalletRegistry", address: "0x0000000000000000000000000000000000000001" },
      { name: "TeeV2Registry", address: "0x0000000000000000000000000000000000000002" },
    ];
    const { fccMatches } = classifyRegistry(future);
    expect(fccMatches.map((c) => c.name)).toEqual([
      "ProtocolManagedWalletRegistry",
      "TeeV2Registry",
    ]);
  });
});
