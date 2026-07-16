// Recorded-fixture tests for fassets_agent_status / fassets_system_state.
// The fixture is a real AgentInfo struct read from AssetManagerFXRP on Flare
// mainnet (getAgentInfo) on 2026-07-15.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { shapeAgent } from "../src/tools/fassets-v2.js";

interface Fixture {
  vault: string;
  assetDecimals: number;
  info: Record<string, string | number | boolean>;
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/mainnet-fxrp-agent-info.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

// The fixture serialized bigints as strings; rebuild the struct shape the
// viem client returns.
function rebuild(info: Fixture["info"]) {
  return Object.fromEntries(
    Object.entries(info).map(([k, v]) => [
      k,
      typeof v === "string" && /^-?\d+$/.test(v) && k !== "underlyingAddressString"
        ? BigInt(v)
        : v,
    ]),
  );
}

describe("fassets_agent_status: agent shaping", () => {
  const struct = rebuild(fixture.info) as Parameters<typeof shapeAgent>[1];
  const shaped = shapeAgent(fixture.vault, struct, fixture.assetDecimals);

  it("maps the status enum and liquidation flag", () => {
    expect(["NORMAL", "CCB", "LIQUIDATION", "FULL_LIQUIDATION", "DESTROYING"]).toContain(
      shaped.status,
    );
    expect(shaped.in_liquidation).toBe(
      shaped.status === "LIQUIDATION" || shaped.status === "FULL_LIQUIDATION",
    );
  });

  it("converts BIPS ratios to plain numbers", () => {
    const expected =
      Number(BigInt(fixture.info.vaultCollateralRatioBIPS as string)) / 10_000;
    expect(shaped.vault_collateral_ratio).toBeCloseTo(expected, 6);
    expect(shaped.vault_collateral_ratio).toBeGreaterThan(1);
  });

  it("formats minted UBA with asset decimals", () => {
    const mintedUBA = BigInt(fixture.info.mintedUBA as string);
    const expected = Number(mintedUBA) / 10 ** fixture.assetDecimals;
    expect(Number(shaped.minted)).toBeCloseTo(expected, 3);
  });

  it("exposes minting capacity as free collateral lots", () => {
    expect(shaped.minting_capacity_lots).toBe(
      String(fixture.info.freeCollateralLots),
    );
  });

  it("reports no liquidation timestamp for a healthy agent", () => {
    if (BigInt(fixture.info.liquidationStartTimestamp as string) === 0n) {
      expect(shaped.liquidation_start_timestamp).toBeNull();
    }
  });
});
