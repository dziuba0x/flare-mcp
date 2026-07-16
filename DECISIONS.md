# DECISIONS.md — flare-mcp v2

Ambiguities and deviations flagged during the build, per the v2 build spec
("Flag anything ambiguous in a DECISIONS.md file instead of guessing
silently"). Dates are 2026-07-15/16 unless noted.

## 1. The spec's "published npm package" does not exist on the registry

The spec calls `@dziubatechnology/flare-mcp` an "existing published package".
`npm view @dziubatechnology/flare-mcp` returns **404** — it was never
published (or was unpublished). The local v1 source at `~/flare-mcp`
(v0.1.0) was used as the base instead. Consequence: the "npm weekly
downloads > 3× v1 baseline" metric has no baseline, and the 0.2.0 release
will effectively be the first publish of the scoped package.

## 2. FCC is not publicly addressable → `songbird_fcc_registry` ships as a watcher

The spec says FCC "just deployed to Songbird via STP.13" and asks tool #5 to
read "whatever FCC contract registry/state is publicly exposed". Findings:

- https://dev.flare.network/fcc/overview states (checked 2026-07-15): FCC
  "is not yet publicly available".
- Live `FlareContractRegistry.getAllContracts()` on Songbird (50 entries)
  contains **no** PMW/TEE/FCC-named contracts (recorded in
  `test/fixtures/songbird-registry.json`).

Per the spec's own contingency ("If FCC contracts are not yet publicly
addressable, ship Phase 1 without tool #5 and add it in a point release"),
the tool ships as a **registry watcher**: it scans the live registry for
FCC-related names, reports `not_yet_publicly_addressable` today, and lights
up automatically once contracts are registered. STP.13's final vote result
was not verified at proposals.flare.network (site not fetched); the
registry state is treated as the ground truth for "publicly exposed".

## 3. v1's "READ-ONLY, no private keys" rule vs. v2's `fdc_request_attestation`

The v1 CLAUDE.md forbids transactions and private keys; the v2 spec requires
submitting attestation requests and allows "user-provided keys locally".
Resolution: `FLARE_PRIVATE_KEY` is optional. Unset → the tool returns the
prepared request + fee + FdcHub address (`mode: "prepared_only"`), keeping
the server fully read-only. Set → the key signs locally via viem and is
never logged or transmitted. No other tool can ever spend funds.

## 4. Phase 2 payment-token gate — already largely resolved by official docs

The spec's blocking Phase 2 question (which Flare token supports gasless
authorization transfers) is answered by
https://dev.flare.network/fxrp/token-interactions/x402-payments (fetched
2026-07-15):

- Flare officially documents an x402 flow using **EIP-3009
  `transferWithAuthorization`**, with a **MockUSDT0** demo token and an
  `X402Facilitator` contract that the developer deploys on Coston2.
- **FXRP does not implement EIP-3009 yet** ("FXRP will be supported once it
  implements the required EIP-3009 standard").
- Whether the *production* USD₮0/USDC.e mainnet deployments implement
  EIP-3009 remains to be verified on-chain in Phase 2 (the docs also have a
  "Gasless USD₮0 Transfers" guide worth checking). For the Coston2 demo
  required by Phase 2 acceptance, the documented MockUSDT0 path (option (a)
  in the spec) works today; the Coston2 faucet even dispenses USDT0.
- Implication: "no x402 facilitator exists for Flare" is now only true for
  *hosted* facilitators; a reference on-chain facilitator contract exists in
  the official flare-hardhat-starter.

## 5. FAssets scope: FXRP only

Only `AssetManagerFXRP` exists in the registries of mainnet, Coston2 and
Songbird (verified live). FBTC/FDOGE inputs are accepted and probed but
return a clear "not live" error. Registry name variants from v1
(`FXrpAssetManager`, etc.) were dropped — the canonical name is confirmed.

## 6. Collateral totals are sampled

`fassets_system_state` aggregates vault/pool collateral by reading
`getAgentInfo` for up to 50 agents (all current networks have ≤ 8), and the
redemption queue is paginated up to 10 × `maxRedeemedTickets` tickets. If
agent counts grow past these caps the numbers become partial; the response
reports `agents_sampled` so consumers can tell.

## 7. Live-network testing of transaction submission

`fdc_request_attestation` was live-tested in `prepared_only` mode (verifier +
fee quote + registry resolution) on Coston2. The actual `FdcHub` submission
path could not be exercised without a funded key; it follows the exact
documented call (`requestAttestation(bytes)` with `value = getRequestFee`)
and is simulated via `eth_call` (viem `simulateContract`) before sending.
Verify end-to-end with a funded Coston2 account before the npm publish.
Local Merkle verification *was* validated end-to-end against real finalized
attestations (round 1397600 on Coston2, Payment + AddressValidity).

## 8a. Phase 2 payment-token gate — RESOLVED (option (a), 2026-07-16)

On-chain probes (see also §4):

- **Mainnet USD₮0** `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` (proxy,
  2227-byte stub): `authorizationState` and `DOMAIN_SEPARATOR` respond →
  EIP-3009 live. Docs confirm the **packed-signature variant**
  `transferWithAuthorization(...,bytes signature)`; the facilitator tries the
  canonical (v,r,s) form first and falls back to the bytes form.
- **Coston2** `0xce13911D4896200b543a61E4ae8E829E661Dd8EB` ("USDT0", 6 dec):
  bytecode contains BOTH transferWithAuthorization selectors,
  receiveWithAuthorization and EIP-2612 permit. `mint` is restricted
  (owner-only), so demo payers need tokens from the faucet/DEX or a
  self-deployed MockUSDT0 (override via `X402_TOKEN_ADDRESS`). This token is
  a community/mock deployment — NOT claimed official. The Coston2 faucet
  labels a token "USDT0" but its address could not be extracted from the
  faucet app; verify which token the faucet dispenses before the demo.
- The spec's fallback (c) (FLR + FDC Payment attestation) is **not needed**
  but remains attractive as a second, fully-native scheme later.

## 8b. x402-for-MCP mapping (stdio has no HTTP status/headers)

x402 is HTTP-native. Over stdio, this server maps: HTTP 402 body → tool
result `{ x402_payment_required, accepts: [...] }`; `X-Payment` header →
optional tool argument `x402_payment` (same base64-JSON encoding);
`X-Payment-Response` → `x402_payment_receipt` attached to the tool result.
Settlement happens BEFORE the tool runs; a failed settlement never releases
the result. This mapping is our own design (no MCP payment standard exists);
documented in README for interop.

## 8c. Settlement path not yet exercised on-chain

Everything up to settlement is live-verified (402 requirements, EIP-712
verification, on-chain nonce check). The final `transferWithAuthorization`
broadcast needs a funded operator key + a payer holding the token — run
`scripts/x402-demo-client.ts` on Coston2 before the hackathon demo. The
in-process settled-nonce cache does not survive restarts; the durable replay
barrier is the on-chain EIP-3009 nonce, which is consumed at settlement.

## 9. EVMTransaction source chains

Verifier docs list Ethereum, Flare and Songbird as EVMTransaction sources
(`eth`, `flr`, `sgb` path segments; `testETH` etc. on testnet). Only the
`eth` path is exercised in the docs; `flr`/`sgb` are exposed by the tool but
unverified against the hosted verifiers.
