// x402 payment layer configuration. Everything is env-driven and the whole
// module is inert unless X402_ENABLED=true — premium tools then run free.
//
// Token defaults were verified on-chain on 2026-07-16:
// - Flare mainnet USD₮0 (TetherTokenOFTExtension) implements EIP-3009
//   (authorizationState + DOMAIN_SEPARATOR respond; address from
//   https://dev.flare.network/network/guides/gasless-usdt0-transfers and
//   https://docs.usdt0.to/technical-documentation/developer#flare).
// - Coston2 token 0xce13…D8EB exposes both transferWithAuthorization
//   variants, receiveWithAuthorization and EIP-2612 permit (bytecode
//   selector check; see DECISIONS.md — community/mock deployment, override
//   with X402_TOKEN_ADDRESS if you deploy your own MockUSDT0 per
//   https://dev.flare.network/fxrp/token-interactions/x402-payments).
import type { NetworkType } from "../utils/rpc.js";

export interface X402Config {
  enabled: boolean;
  network: NetworkType;
  tokenAddress: `0x${string}`;
  payTo: `0x${string}`;
  /** EIP-712 domain version of the token (USDT0/MockUSDT0 use "1"). */
  eip712Version: string;
  /** Token decimals used to express prices. */
  tokenDecimals: number;
  /** Default price per paid call, in whole-token units (e.g. "0.001"). */
  defaultPrice: string;
  /** Per-tool overrides, in whole-token units. */
  toolPrices: Record<string, string>;
}

const DEFAULT_TOKENS: Partial<Record<NetworkType, `0x${string}`>> = {
  mainnet: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
  coston2: "0xce13911D4896200b543a61E4ae8E829E661Dd8EB",
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read x402 config from the environment. Returns null when the paywall is
 * disabled or misconfigured (a misconfiguration is reported on stderr, and
 * the tools stay free — never lock users out silently).
 */
export function loadX402Config(): X402Config | null {
  if (process.env.X402_ENABLED !== "true") {
    return null;
  }

  const network = (process.env.X402_NETWORK ?? "coston2") as NetworkType;
  if (!["mainnet", "coston2", "songbird", "coston"].includes(network)) {
    process.stderr.write(`x402: invalid X402_NETWORK "${network}", paywall disabled\n`);
    return null;
  }
  // Per the v2 spec, mainnet settlement stays behind an extra flag.
  if (network === "mainnet" && process.env.X402_ALLOW_MAINNET !== "true") {
    process.stderr.write(
      "x402: X402_NETWORK=mainnet requires X402_ALLOW_MAINNET=true, paywall disabled\n",
    );
    return null;
  }

  const payTo = process.env.X402_PAY_TO;
  if (!payTo || !ADDRESS_RE.test(payTo)) {
    process.stderr.write("x402: X402_PAY_TO (payee address) missing/invalid, paywall disabled\n");
    return null;
  }

  const tokenAddress = process.env.X402_TOKEN_ADDRESS ?? DEFAULT_TOKENS[network];
  if (!tokenAddress || !ADDRESS_RE.test(tokenAddress)) {
    process.stderr.write(
      `x402: no default payment token for ${network}; set X402_TOKEN_ADDRESS. Paywall disabled\n`,
    );
    return null;
  }

  const toolPrices: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    const m = /^X402_PRICE_([A-Z0-9_]+)$/.exec(key);
    if (m && value && m[1] !== "DEFAULT") {
      toolPrices[m[1].toLowerCase()] = value;
    }
  }

  return {
    enabled: true,
    network,
    tokenAddress: tokenAddress as `0x${string}`,
    payTo: payTo as `0x${string}`,
    eip712Version: process.env.X402_TOKEN_EIP712_VERSION ?? "1",
    tokenDecimals: Number(process.env.X402_TOKEN_DECIMALS ?? "6"),
    defaultPrice: process.env.X402_PRICE_DEFAULT ?? "0.001",
    toolPrices,
  };
}

export function priceFor(config: X402Config, toolName: string): string {
  return config.toolPrices[toolName.toLowerCase()] ?? config.defaultPrice;
}
