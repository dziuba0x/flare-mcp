// Offline tests for the x402 payment layer: a payer key generated in-test
// signs real EIP-712 TransferWithAuthorization payloads; verification runs
// with injected chain deps (no network).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { toHex } from "viem";
import {
  EIP3009_TYPES,
  buildRequirements,
  verifyPayment,
  resetSettledNonces,
  markSettledForTest,
  type PaymentPayload,
  type VerifyDeps,
} from "../src/x402/facilitator.js";
import type { X402Config } from "../src/x402/config.js";
import { loadX402Config, priceFor } from "../src/x402/config.js";
import { withX402, x402PaymentInput } from "../src/x402/paywall.js";

const TOKEN = "0xce13911D4896200b543a61E4ae8E829E661Dd8EB" as const;
const PAYEE = "0x00000000000000000000000000000000000000A1" as const;

const config: X402Config = {
  enabled: true,
  network: "coston2",
  tokenAddress: TOKEN,
  payTo: PAYEE,
  eip712Version: "1",
  tokenDecimals: 6,
  defaultPrice: "0.001",
  toolPrices: { fassets_liquidation_scanner: "0.005" },
};

const payer = privateKeyToAccount(generatePrivateKey());
const NOW = 1_784_300_000;

const deps: VerifyDeps = {
  nonceUsedOnChain: async () => false,
  tokenName: async () => "USDT0",
  nowSeconds: () => NOW,
};

async function signPayment(
  overrides: Partial<PaymentPayload> = {},
  signer = payer,
): Promise<PaymentPayload> {
  const message = {
    from: payer.address,
    to: PAYEE,
    value: 1000n, // 0.001 with 6 decimals
    validAfter: BigInt(NOW - 60),
    validBefore: BigInt(NOW + 300),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  const signature = await signer.signTypedData({
    domain: {
      name: "USDT0",
      version: "1",
      chainId: 114,
      verifyingContract: TOKEN,
    },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });
  const r = signature.slice(0, 66) as `0x${string}`;
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
  const v = parseInt(signature.slice(130, 132), 16);
  return {
    from: message.from,
    to: message.to,
    value: message.value.toString(),
    validAfter: message.validAfter.toString(),
    validBefore: message.validBefore.toString(),
    nonce: message.nonce,
    v,
    r,
    s,
    ...overrides,
  };
}

beforeEach(() => resetSettledNonces());

describe("x402 verifyPayment", () => {
  it("accepts a correctly signed authorization", async () => {
    const payload = await signPayment();
    await expect(
      verifyPayment(config, "fdc_bulk_proof_bundle", payload, deps),
    ).resolves.toBeUndefined();
  });

  it("rejects a signature from a different key", async () => {
    const attacker = privateKeyToAccount(generatePrivateKey());
    const payload = await signPayment({}, attacker); // signed by attacker, from=payer
    await expect(
      verifyPayment(config, "fdc_bulk_proof_bundle", payload, deps),
    ).rejects.toThrow(/signature does not match/);
  });

  it("rejects a payment to the wrong payee", async () => {
    const payload = await signPayment({
      to: "0x00000000000000000000000000000000000000B2",
    });
    await expect(
      verifyPayment(config, "fdc_bulk_proof_bundle", payload, deps),
    ).rejects.toThrow(/not the configured payee/);
  });

  it("rejects an underpayment against a per-tool price", async () => {
    // 0.001 signed, but the scanner costs 0.005
    const payload = await signPayment();
    await expect(
      verifyPayment(config, "fassets_liquidation_scanner", payload, deps),
    ).rejects.toThrow(/below the required/);
  });

  it("rejects an expired authorization", async () => {
    const payload = await signPayment();
    await expect(
      verifyPayment(config, "fdc_bulk_proof_bundle", payload, {
        ...deps,
        nowSeconds: () => NOW + 3600,
      }),
    ).rejects.toThrow(/expired/);
  });

  it("rejects a nonce already used on-chain", async () => {
    const payload = await signPayment();
    await expect(
      verifyPayment(config, "fdc_bulk_proof_bundle", payload, {
        ...deps,
        nonceUsedOnChain: async () => true,
      }),
    ).rejects.toThrow(/already used on-chain/);
  });

  it("rejects a replay of a payload settled by this server", async () => {
    const payload = await signPayment();
    await verifyPayment(config, "fdc_bulk_proof_bundle", payload, deps);
    markSettledForTest(payload);
    await expect(
      verifyPayment(config, "fdc_bulk_proof_bundle", payload, deps),
    ).rejects.toThrow(/already settled by this server/);
  });
});

describe("x402 requirements + config", () => {
  it("builds x402 requirements with per-tool pricing", () => {
    const req = buildRequirements(config, "fassets_liquidation_scanner");
    expect(req.scheme).toBe("exact");
    expect(req.asset).toBe(TOKEN);
    expect(req.payTo).toBe(PAYEE);
    expect(req.maxAmountRequired).toBe("5000"); // 0.005 @ 6 decimals
    expect(req.extra.chainId).toBe(114);
    expect(req.extra.standard).toBe("EIP-3009");
    expect(priceFor(config, "fdc_bulk_proof_bundle")).toBe("0.001");
  });
});

describe("x402 paywall (MCP adapter)", () => {
  const envKeys = [
    "X402_ENABLED",
    "X402_PAY_TO",
    "X402_NETWORK",
    "X402_ALLOW_MAINNET",
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of envKeys) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const echoTool = withX402("echo_tool", async (args: { q: string }) => ({
    content: [{ type: "text" as const, text: JSON.stringify({ echoed: args.q }) }],
  }));

  it("is a passthrough when X402_ENABLED is unset", async () => {
    delete process.env.X402_ENABLED;
    const res = await echoTool({ q: "hi" });
    expect(JSON.parse(res.content[0].text)).toEqual({ echoed: "hi" });
  });

  it("returns payment requirements when enabled and unpaid", async () => {
    process.env.X402_ENABLED = "true";
    process.env.X402_NETWORK = "coston2";
    process.env.X402_PAY_TO = PAYEE;
    const res = await echoTool({ q: "hi" });
    const body = JSON.parse(res.content[0].text);
    expect(body.x402_payment_required).toBe(true);
    expect(body.accepts[0].payTo).toBe(PAYEE);
    expect(body.accepts[0].network).toBe("coston2");
  });

  it("rejects a malformed x402_payment without touching the network", async () => {
    process.env.X402_ENABLED = "true";
    process.env.X402_NETWORK = "coston2";
    process.env.X402_PAY_TO = PAYEE;
    const res = await echoTool({
      q: "hi",
      x402_payment: Buffer.from('{"from":"0x1"}').toString("base64"),
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("missing");
  });

  it("refuses mainnet without the explicit allow flag", () => {
    process.env.X402_ENABLED = "true";
    process.env.X402_NETWORK = "mainnet";
    process.env.X402_PAY_TO = PAYEE;
    delete process.env.X402_ALLOW_MAINNET;
    expect(loadX402Config()).toBeNull();
  });

  it("exposes the optional x402_payment input", () => {
    expect(Object.keys(x402PaymentInput)).toEqual(["x402_payment"]);
  });
});
