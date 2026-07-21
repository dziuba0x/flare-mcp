# Changelog

## Unreleased — ZK-ready settlement receipts (organ 3)

- **`x402_receipt`**: every settled payment now emits a fixed-schema,
  self-describing, portable receipt (`src/x402/receipt.ts`,
  [`RECEIPT_SPEC.md`](RECEIPT_SPEC.md)). The payer appears only as a
  **Poseidon (BN254) commitment**, never in plaintext; a keccak256
  `receipt_hash` gives any holder tamper-evidence; `fdc_attestation_ref` is
  reserved for the FDC-verified path (null for now). Payers may blind the
  commitment with an optional `commitment_salt` in the payment payload (not
  part of the EIP-712 authorization — it cannot affect fund movement).
- Additive and backward-compatible: `x402_payment_receipt` (settlement
  summary) is unchanged; `x402_receipt` is emitted alongside it on both the
  MCP and HTTP transports. Live-verified end-to-end on Coston2.
- New dependency: `poseidon-lite` (small, dependency-free Poseidon).

## 0.4.0 — 2026-07-17 — hub mode (hosted HTTP + spec-style x402)

- **`--http [port]` / `FLARE_MCP_HTTP_PORT`**: run flare-mcp as a hostable
  service — MCP over Streamable HTTP at `POST /mcp` (stateless, all 15
  tools) plus REST premium endpoints paid via **standard HTTP x402**
  (`402` + `accepts[]` → `X-Payment` header → result +
  `X-Payment-Response` with the settlement tx). Wire-compatible with the
  existing x402 client ecosystem; no new runtime dependencies (plain
  `node:http`).
- `GET /` discovery document (endpoints, x402 config), `GET /healthz`.
- `Dockerfile` + `.dockerignore` for one-command deployment; binds
  `127.0.0.1` by default, `FLARE_MCP_HTTP_HOST=0.0.0.0` to expose.
- stdio mode unchanged and still the default.

## 0.3.0 — 2026-07-17 — x402 payment layer

- **x402 payments over MCP** (`src/x402/`): paid tools reply with payment
  requirements; the client signs an EIP-3009 `TransferWithAuthorization`
  off-chain and retries with `x402_payment` (base64 JSON); the built-in
  facilitator verifies the EIP-712 signature locally, checks the nonce
  on-chain, settles `transferWithAuthorization` on Flare and attaches the
  settlement tx hash to the result. The facilitator never holds funds.
  Disabled by default (`X402_ENABLED=true` to enable; mainnet additionally
  behind `X402_ALLOW_MAINNET=true`). Prices per tool via env.
- **`fassets_liquidation_scanner`** (premium): joins FAssets agent state with
  live FTSOv2 prices — per agent: CR headroom against the collateral-type
  minimums, the underlying price at which liquidation starts, and the % move
  away from it.
- **`fdc_bulk_proof_bundle`** (premium): batch retrieval of up to 20 FDC
  proofs, each Merkle-verified locally against the on-chain Relay root.
- Demo agent: `scripts/x402-demo-client.ts` (MCP stdio client that pays and
  retries autonomously).
- Payment tokens verified on-chain: mainnet USD₮0 has EIP-3009 (docs +
  functional probe); Coston2 default is a verified EIP-3009 test USDT0.

## 0.2.0 — 2026-07-15

flare-mcp v2: FDC attestation workflows, deep FAssets state, Songbird/Coston
support, FCC registry watcher.

### Added

- **`fdc_request_attestation`** — prepare an FDC attestation request
  (`Payment`, `AddressValidity`, `EVMTransaction`) via the Flare-hosted
  verifiers, quote the request fee from `FdcRequestFeeConfigurations`, and —
  when `FLARE_PRIVATE_KEY` is set — submit it to `FdcHub` and return the tx
  hash and voting round id. Without a key, returns the prepared request for
  submission with your own signer.
- **`fdc_get_attestation_proof`** — fetch an attestation proof from the Data
  Availability layer and verify it **locally**: the response struct is
  ABI-encoded and keccak-hashed into a Merkle leaf, folded through the proof,
  and compared to `Relay.merkleRoots(200, round)` read on-chain. A DA-layer
  response that does not match the on-chain root is rejected.
- **`fassets_agent_status`** — per-agent view (FXRP live on mainnet, Coston2,
  Songbird): collateral ratios, minting capacity in free lots,
  minted/reserved/redeeming amounts, liquidation status; sorted riskiest
  first.
- **`fassets_system_state`** — global stats: total minted, agent count, lot
  size, minting cap and pause flag, aggregated vault + pool collateral, and
  the redemption queue (tickets, value, lots) with pagination.
- **`songbird_fcc_registry`** — scans the live FlareContractRegistry for
  Flare Confidential Compute contracts (PMW / TEE / compute extensions).
  Reports `not_yet_publicly_addressable` today (per dev.flare.network/fcc,
  FCC is not yet public) and will surface the contracts the moment they are
  registered.
- **Songbird (chain 19) and Coston (chain 16)** network support; existing
  tools `get_flr_balance`, `get_ftso_feed`, `get_ftso_feeds_all` and
  `get_fdc_proof_status` now accept them too.
- Offline test suite (`npm test`, vitest) with recorded on-chain fixtures,
  plus `scripts/live-check.ts` acceptance checks against public RPCs.

### Changed

- Contract ABIs now come from the official
  `@flarenetwork/flare-periphery-contract-artifacts` package at runtime
  instead of being hand-written, for the large FDC/FAssets interfaces.
- DA-layer JSON is parsed with 64-bit-safe number handling
  (`lowestUsedTimestamp = 2^64-1` no longer loses precision).

### Migration notes (0.1.x → 0.2.0)

- **No breaking changes** to existing tools: names, inputs and outputs are
  unchanged. The `network` enum on the four tools listed above now
  *additionally* accepts `"songbird"` and `"coston"`.
- The server is no longer strictly read-only **only if you opt in**: setting
  `FLARE_PRIVATE_KEY` lets `fdc_request_attestation` submit transactions
  (attestation requests cost a small fee, e.g. 1000 wei on Coston2, plus
  gas). Leave it unset for the previous read-only behaviour — every other
  tool remains read-only regardless.
- New optional env vars: `FLARE_RPC_SONGBIRD`, `FLARE_RPC_COSTON`,
  `FLARE_PRIVATE_KEY`, `FDC_VERIFIER_API_KEY`, `FLARE_DA_API_KEY`,
  `FLARE_DA_URL`.

## 0.1.0 — 2026-05-28

Initial release: `get_flr_balance`, `get_ftso_feed`, `get_ftso_feeds_all`,
`get_ftso_providers`, `get_ftso_history`, `get_fassets_status`,
`get_fdc_proof_status`, `get_smart_account_info`; mainnet + Coston2; stdio
transport.
