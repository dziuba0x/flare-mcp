# Flario — the agent MCP server for Flare Network (FTSO · FDC · FAssets · x402)

[![npm version](https://img.shields.io/npm/v/flario.svg)](https://www.npmjs.com/package/flario)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933.svg)](https://nodejs.org)
[![Model Context Protocol](https://img.shields.io/badge/Model_Context_Protocol-server-6E56CF.svg)](https://modelcontextprotocol.io)

**Flario** is the agent-native [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for [Flare Network](https://flare.network). It gives AI agents — in Claude, Cursor, VS Code or any MCP client — direct, natural-language access to Flare's enshrined protocols (**FTSO** price feeds, **FDC** cross-chain attestations, **FAssets**) **and an agent wallet**: pay-per-call tools via **[x402](https://www.x402.org/)** settled on Flare, with chain-verified receipts. Install with `npx flario`, or run it as a hosted HTTP hub.

Flario covers the full enshrined stack — FTSO price feeds, FDC attestation workflows (request + **locally-verified** Merkle proofs), deep FAssets state (per-agent collateral, liquidation risk, system totals, redemption queue), Songbird/Coston support, and an FCC (Flare Confidential Compute) registry watcher. Reads are trust-minimized: FDC proofs are verified locally against the on-chain Relay root, never trusted from an API. The one optional write, `fdc_request_attestation`, submits only if you set `FLARE_PRIVATE_KEY`; otherwise it returns a prepared request for your own signer. **Flario never holds or forwards funds.**

Beyond reads, Flario gives agents a **wallet**: premium tools are payable per call via [x402](https://www.x402.org/) settled on Flare, and every paid call returns a portable, chain-verified **receipt** (see [`RECEIPT_SPEC.md`](RECEIPT_SPEC.md)) — provable via Flare's enshrined FDC, not the facilitator's word.

> **Complementary to the official Flare MCP server.** Flare's own MCP server (`dev.flare.network/mcp`) is documentation search/fetch — it gives agents *knowledge*. Flario gives agents *hands and a wallet*: it calls the enshrined protocols (FTSO/FDC/FAssets/FCC) and lets agents **pay** for computed results, with **chain-verified receipts**. Use both.

---

## Why Flario

- **Depth on Flare's enshrined protocols, by design.** FTSO, FDC and FAssets are built into the chain — so are Flario's 19 tools. Generic multi-chain MCP servers can't reach this; the depth isn't portable to other chains.
- **Proof-carrying, not "trust us."** Prices and cross-chain facts come with a Merkle proof that Flario verifies **locally** against the on-chain root — so an agent, or a smart contract, can rely on the answer without trusting any API.
- **Agents can pay — and get a receipt.** Premium tools settle per call via [x402](https://www.x402.org/) on Flare, and every payment returns a portable receipt **provable by Flare's enshrined FDC**, not the facilitator's word. No other chain in the x402 ecosystem can do that.
- **Self-hostable, zero custody.** Works against public RPCs out of the box, needs no account or key for reads, and **never holds or forwards funds**.

---

## Examples

Once Flario is added to your MCP client (see [Quickstart](#quick-start--claude-desktop)), just ask in natural language:

| Ask your agent… | Flario runs |
| --- | --- |
| *"What's the FLR/USD price on Flare, with a proof I can verify?"* | `get_ftso_anchor_feed` |
| *"Which FXRP agents are closest to liquidation right now?"* | `fassets_liquidation_scanner` |
| *"Show the FLR portfolio for `0x…` — balance, delegation, claimable rewards."* | `get_flr_stake_info` |
| *"Who runs FXRP agent `0x…`?"* | `fassets_agent_details` |
| *"Prove this settlement really happened, via Flare's FDC."* | `fdc_verify_settlement` |

A proof-carrying price answer looks like this — the value **and** a proof the agent can verify itself (trimmed):

```json
{
  "verified": true,
  "verification": "Local: keccak256(abi.encode(feed body)) folded through the Merkle proof equals Relay.merkleRoots(100, round) read on-chain.",
  "name": "FLR/USD",
  "price": 0.006786,
  "voting_round_id": 1402671,
  "merkle_root": "0x…",
  "proof": ["0x…", "0x…"]
}
```

---

## Features

- **`get_flr_balance`** — Native FLR and wrapped WFLR (WNat) balance for any EVM address.
- **`get_flr_stake_info`** — One-call Flare portfolio for an address: FLR + WFLR, FTSO vote power and delegation, claimable protocol rewards (by source), and FlareDrops.
- **`get_ftso_feed`** — Latest FTSO v2 price for a single feed, by name (`FLR/USD`) or raw `bytes21` id.
- **`get_ftso_feeds_all`** — Latest FTSO v2 prices for all bundled feeds in one call.
- **`get_ftso_providers`** — Active FTSO data providers (vote power, fee, reward rate). *Needs an indexer endpoint — see [Environment Variables](#environment-variables).*
- **`get_ftso_anchor_feed`** — Proof-carrying FTSO Scaling price: the value **plus a Merkle proof verified locally** against the on-chain Relay root. Trust-minimized — usable by an agent or a smart contract without trusting the API.
- **`get_ftso_history`** — Recent FTSO Scaling anchor-feed history for a feed, from the public Data Availability layer (no external indexer needed); each point Merkle-verified.
- **`get_fassets_status`** — FAssets status (total minted, active agents) for FXRP, FBTC or FDOGE, read on-chain.
- **`get_fdc_proof_status`** — FDC (protocol id 200) Merkle root and finalization status for a voting round.
- **`get_smart_account_info`** — Resolve the deterministic Flare address for an XRPL (`r...`) account via the MasterAccountController.

Enshrined-stack & settlement tools:

- **`fdc_request_attestation`** — Submit an FDC attestation request (`Payment`, `AddressValidity`, `EVMTransaction`): prepares it via a Flare-hosted verifier, quotes the request fee, and submits to `FdcHub` (or returns the prepared request if no key is configured).
- **`fdc_get_attestation_proof`** — Fetch an attestation proof from the Data Availability layer and **verify the Merkle proof locally** against the Relay root read on-chain.
- **`fassets_agent_status`** — Every FAssets agent with collateral ratios, minting capacity, minted/reserved amounts and liquidation status, sorted riskiest-first.
- **`fassets_system_state`** — Global FAssets stats: total minted, lot size, minting cap/pause, aggregated vault+pool collateral, redemption queue.
- **`fassets_agent_details`** — Human-facing agent info (name, description, logo, terms-of-use, whitelist status) from the AgentOwnerRegistry.
- **`songbird_fcc_registry`** — Live FlareContractRegistry scan for Flare Confidential Compute (PMW/TEE) deployments post-STP.13.
- **`fdc_verify_settlement`** — Prove an x402 settlement via Flare's **enshrined FDC**, not the facilitator's word: an EVMTransaction attestation over the settlement tx, locally Merkle-verified and *bound* to the payment (the attested tx must contain the ERC-20 Transfer of the asset to the payee for ≥ the amount).

It also exposes two MCP **resources**: `flare://network/feeds` (the bundled FTSO feed list) and `flare://network/contracts` (the ContractRegistry address and runtime-resolution guide).

---

## Quick Start — Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and add:

```json
{
  "mcpServers": {
    "flario": {
      "command": "npx",
      "args": ["-y", "flario"],
      "env": {
        "FLARE_RPC": "https://flare-api.flare.network/ext/C/rpc",
        "FLARE_RPC_TESTNET": "https://coston2-api.flare.network/ext/C/rpc"
      }
    }
  }
}
```

Restart Claude Desktop. You can then ask things like *"What's the FLR/USD price on Flare?"* or *"How much FXRP is minted right now?"*.

---

## Quick Start — Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project) and add:

```json
{
  "mcpServers": {
    "flario": {
      "command": "npx",
      "args": ["-y", "flario"]
    }
  }
}
```

The same block works in any MCP client that supports stdio servers (VS Code, Windsurf, Zed, etc.). The `env` section is optional — the public Flare RPC endpoints are used by default.

### Verify it works (no client, ~10 s)

```bash
# List all 19 tools straight from the published package:
npx -y @modelcontextprotocol/inspector --cli npx -y flario --method tools/list

# Or call one — a proof-carrying FLR/USD price on mainnet:
npx -y @modelcontextprotocol/inspector --cli npx -y flario \
  --method tools/call --tool-name get_ftso_anchor_feed \
  --tool-arg feed_id=FLR/USD --tool-arg network=mainnet
```

---

## Tools Reference

Every tool validates its input with [zod](https://zod.dev) and returns a clear error message (rather than crashing) when an RPC call or data source is unavailable. Seventeen tools are **free**; the two premium computed tools settle via [x402 micropayments on Flare](#x402-payments-premium-tools) when the operator enables it (and are free otherwise).

| Tool | Networks | Tier | Description |
| --- | --- | --- | --- |
| `get_flr_balance` | mainnet, coston2, songbird, coston | Free | Native + wrapped (WNat) balance for an address |
| `get_flr_stake_info` | mainnet, coston2, songbird, coston | Free | Portfolio: FLR+WFLR, vote power, delegation, claimable rewards (by source), FlareDrops |
| `get_ftso_feed` | mainnet, coston2, songbird, coston | Free | Latest price for one FTSO feed (`"FLR/USD"` or `bytes21` id) |
| `get_ftso_feeds_all` | mainnet, coston2, songbird, coston | Free | Latest price for every bundled feed |
| `get_ftso_providers` | mainnet, coston2 † | Free | Active FTSO data providers |
| `get_ftso_anchor_feed` | mainnet, coston2, songbird, coston | Free | Proof-carrying FTSO Scaling price + Merkle proof, verified locally vs the on-chain Relay root |
| `get_ftso_history` | mainnet, coston2, songbird, coston | Free | Recent FTSO Scaling anchor-feed history from the public DA layer; each point Merkle-verified |
| `get_fassets_status` | mainnet, coston2 | Free | FAssets minted total and agent count (v1 summary; see `fassets_system_state`) |
| `get_fdc_proof_status` | mainnet, coston2, songbird, coston | Free | FDC Merkle root + finalization for a round |
| `get_smart_account_info` | mainnet, coston2 ‡ | Free | Resolve the Flare address of an XRPL account |
| `fdc_request_attestation` | mainnet, coston2, songbird, coston | Free | Prepare (and optionally submit) an FDC attestation request; returns tx hash + voting round id |
| `fdc_get_attestation_proof` | mainnet, coston2, songbird, coston | Free | Retrieve a proof from the DA layer and verify it locally against the on-chain Relay root |
| `fassets_agent_status` | mainnet, coston2, songbird | Free | Per-agent collateral ratios, minting capacity, liquidation status (riskiest first) |
| `fassets_system_state` | mainnet, coston2, songbird | Free | Total minted, lot size, minting cap/pause, aggregate collateral, redemption queue |
| `fassets_agent_details` | mainnet, coston2, songbird | Free | Agent name, description, logo, terms-of-use, whitelist status (AgentOwnerRegistry) |
| `songbird_fcc_registry` | songbird (default), all | Free | Scan the live contract registry for FCC (PMW/TEE) deployments |
| `fdc_verify_settlement` | mainnet, coston2, songbird, coston | Free | Prove an x402 settlement via enshrined FDC (EVMTransaction attestation) and bind it to the payment claim |
| `fassets_liquidation_scanner` | mainnet, coston2, songbird | **Premium (x402)** § | FAssets agents × live FTSO prices: per-agent liquidation price and distance to it |
| `fdc_bulk_proof_bundle` | mainnet, coston2, songbird, coston | **Premium (x402)** § | Batch retrieval + local verification of up to 20 FDC proofs |

> § Premium tools run **free** unless the server operator sets `X402_ENABLED=true` — see [x402 payments](#x402-payments-premium-tools).

> † Requires an external data source configured via an environment variable (see below); on-chain aggregation of providers/history is impractical for a read-only stdio server.
> ‡ Best-effort: the MasterAccountController ABI is not yet published in the periphery artifacts, so this returns a `has_account: false` notice when it cannot resolve.

### FDC attestation workflow

```text
1. fdc_request_attestation  (type: Payment | AddressValidity | EVMTransaction,
                             source_chain: xrp | btc | doge | eth | flr | sgb)
     → verifier prepareRequest → fee quote → FdcHub.requestAttestation
     → { tx_hash, voting_round_id, abi_encoded_request }
2. wait ~90–180 s for the voting round to finalize
3. fdc_get_attestation_proof (voting_round_id, abi_encoded_request)
     → DA-layer proof → local keccak256 Merkle fold → must equal
       Relay.merkleRoots(200, round) read on-chain → verified response
```

Without `FLARE_PRIVATE_KEY`, step 1 returns `mode: "prepared_only"` with the encoded request, fee and FdcHub address so you can submit it with your own signer. The key, when provided, is only ever used to sign locally.

### x402 payments (premium tools)

Flario implements the [x402 payment protocol](https://www.x402.org/) adapted to MCP over stdio — the first MCP server whose paid tools settle **on the chain they serve**. HTTP's 402 status and `X-Payment` header map to tool results and a tool argument:

```text
1. call a paid tool                → result: { x402_payment_required: true,
                                               accepts: [requirements] }
2. sign an EIP-3009 TransferWithAuthorization off-chain (gasless for payer)
3. retry the SAME call with        → x402_payment: base64(JSON payload)
4. server verifies the EIP-712 signature locally, checks the nonce on-chain,
   settles transferWithAuthorization on Flare, runs the tool
   → result includes x402_payment_receipt (settlement summary) and
     x402_receipt (portable, ZK-ready receipt — see RECEIPT_SPEC.md)
```

The built-in facilitator **never holds funds**: `transferWithAuthorization` moves tokens directly payer → payee; the operator key only pays gas to broadcast the client-signed authorization. Replay is blocked twice: EIP-3009 nonces are consumed on-chain, and settled nonces are additionally cached in-process.

Every paid call returns a portable `x402_receipt`: a fixed-schema, self-describing record where the payer appears only as a Poseidon commitment (never in plaintext), with a keccak256 `receipt_hash` any holder can recompute for tamper-evidence. Payers can blind their commitment with an optional `commitment_salt` in the payment payload. Full contract: [`RECEIPT_SPEC.md`](RECEIPT_SPEC.md).

### FDC-verified settlement — the differentiator

A receipt says a payment settled; **Flare can prove it with the chain's own enshrined data connector**. `fdc_verify_settlement` takes a settlement tx and obtains an FDC **EVMTransaction** attestation over it, verifies the Merkle proof locally against the on-chain Relay root, and then *binds* the attestation to the payment — confirming the attested transaction actually contains an ERC-20 `Transfer` of the asset to the payee for at least the amount. The result is a receipt whose `fdc_attestation_ref` makes the settlement provable **without trusting the facilitator**. No other chain in the x402 ecosystem can produce a protocol-level receipt like this. The tool never submits on-chain itself (the attestation request is permissionless — the holder submits it), so a hosted hub cannot be griefed into spending gas.

Server-side setup (operator):

```bash
X402_ENABLED=true
X402_NETWORK=coston2            # mainnet additionally needs X402_ALLOW_MAINNET=true
X402_PAY_TO=0xYourPayeeAddress
FLARE_PRIVATE_KEY=0x...          # operator gas key for settlements
# optional: X402_TOKEN_ADDRESS, X402_PRICE_DEFAULT=0.001,
#           X402_PRICE_FASSETS_LIQUIDATION_SCANNER=0.005 (whole-token units)
```

Payment tokens (EIP-3009, verified on-chain 2026-07): Coston2 defaults to `0xce13911D4896200b543a61E4ae8E829E661Dd8EB` (test USDT0); mainnet defaults to the official [USD₮0](https://docs.usdt0.to/technical-documentation/developer#flare) `0xe7cd86e13AC4309349F30B3435a9d337750fC82D`. Try the full agent flow with `npx tsx scripts/x402-demo-client.ts`.

### Hub mode (hosted HTTP service)

Run Flario as a network service instead of a local stdio process:

```bash
npx flario --http 8402         # or FLARIO_HTTP_PORT=8402
# expose beyond localhost:
FLARIO_HTTP_HOST=0.0.0.0 npx flario --http 8402
```

| Endpoint | What it serves |
| --- | --- |
| `POST /mcp` | Full MCP server over Streamable HTTP (stateless) — all 19 tools, x402 in-band |
| `GET /api/premium/liquidation-scanner?asset=FXRP&network=mainnet` | Spec-style **HTTP x402**: `402` + `accepts[]` → retry with `X-Payment` header → result + `X-Payment-Response` (settlement tx) |
| `POST /api/premium/proof-bundle` | Same x402 flow; body `{"requests":[{"voting_round_id":N,"abi_encoded_request":"0x…"}],"network":"…"}` |
| `GET /` | Discovery: endpoints, x402 config, pricing |
| `GET /healthz` | Liveness |

The REST endpoints use the standard x402 wire format (base64 JSON payload in `X-Payment`), so non-MCP agents and existing x402 clients can pay too. A `Dockerfile` ships in the repo:

```bash
docker build -t flario-hub . && docker run -p 8402:8402 \
  -e X402_ENABLED=true -e X402_PAY_TO=0xYou -e FLARE_PRIVATE_KEY=0x... flario-hub
```

---

## Network Support

| Network | Chain ID | Default RPC | Override env var |
| --- | --- | --- | --- |
| Flare Mainnet | `14` | `https://flare-api.flare.network/ext/C/rpc` | `FLARE_RPC` |
| Coston2 Testnet | `114` | `https://coston2-api.flare.network/ext/C/rpc` | `FLARE_RPC_TESTNET` |
| Songbird Canary | `19` | `https://songbird-api.flare.network/ext/C/rpc` | `FLARE_RPC_SONGBIRD` |
| Coston Testnet | `16` | `https://coston-api.flare.network/ext/C/rpc` | `FLARE_RPC_COSTON` |

Contract addresses are **never hardcoded** — they are resolved at runtime through the Flare `ContractRegistry` at `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` (the same address on all four networks). FDC verifier and Data Availability endpoints default to the Flare-hosted public services documented at [dev.flare.network/network/overview](https://dev.flare.network/network/overview).

### Environment Variables

All are optional; the server runs against the public RPCs and Flare-hosted FDC services with no configuration.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `FLARE_RPC` | all mainnet calls | Override the mainnet RPC endpoint. |
| `FLARE_RPC_TESTNET` | all Coston2 calls | Override the Coston2 RPC endpoint. |
| `FLARE_RPC_SONGBIRD` | all Songbird calls | Override the Songbird RPC endpoint. |
| `FLARE_RPC_COSTON` | all Coston calls | Override the Coston RPC endpoint. |
| `FLARE_PRIVATE_KEY` | `fdc_request_attestation` | Local signing key for submitting attestation requests. Never logged, never leaves the process except as a signed tx. Omit for prepared-only mode. |
| `FDC_VERIFIER_API_KEY` | `fdc_request_attestation` | Verifier API key; defaults to the public key `00000000-0000-0000-0000-000000000000`. |
| `FLARE_DA_API_KEY` | `fdc_get_attestation_proof` | DA-layer API key; defaults to the public key. |
| `FLARE_DA_URL` | `fdc_get_attestation_proof` | Override the DA-layer base URL (e.g. a self-hosted instance). |
| `X402_ENABLED` | premium tools | `true` turns on the x402 paywall for premium tools (default: off — premium tools are free). |
| `X402_NETWORK` | x402 | Settlement network (default `coston2`; `mainnet` also needs `X402_ALLOW_MAINNET=true`). |
| `X402_PAY_TO` | x402 | Payee address receiving payments (required when enabled). |
| `X402_TOKEN_ADDRESS` | x402 | EIP-3009 payment token override (defaults: Coston2 test USDT0, mainnet USD₮0). |
| `X402_PRICE_DEFAULT` / `X402_PRICE_<TOOL>` | x402 | Prices in whole-token units (default `0.001`). |
| `FLARE_PROVIDERS_API` | `get_ftso_providers` | An indexer endpoint returning a JSON array of providers (or `{ "providers": [...] }`). |
| `FLARE_METRICS_API` | `get_fassets_status` | Optional fallback metrics API, used only if the on-chain read fails. |

See [`.env.example`](.env.example) for a copy-paste template.

---

## Development

```bash
# clone
git clone https://github.com/dziuba0x/flario.git
cd flario

# install
npm install

# run in watch/dev mode (no build step, via tsx)
npm run dev

# type-check and compile to dist/
npm run build

# offline test suite (recorded fixtures, no network needed)
npm test

# live acceptance checks against public RPCs (mainnet, Coston2, Songbird)
npx tsx scripts/live-check.ts

# run the compiled server
npm start

# open the MCP Inspector against the built server
npm run inspect
```

**Stack:** TypeScript (ESM, Node ≥ 18) · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) · [`viem`](https://viem.sh) · [`zod`](https://zod.dev) · [`@flarenetwork/flare-periphery-contract-artifacts`](https://github.com/flare-foundation/flare-npm-periphery-package).

The build emits an executable `dist/index.js` (with a `#!/usr/bin/env node` shebang) wired to the `flario` bin. Test individual tools without a client using the Inspector CLI, e.g.:

```bash
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name get_ftso_feed \
  --tool-arg feed_id=FLR/USD --tool-arg network=mainnet
```

---

## License

[MIT](#license) © Dziuba Technology / Alan Dziuba.

---

## Built by

**[Dziuba Technology](https://github.com/dziuba0x)** — Alan Dziuba.
Built on [Flare Network](https://dev.flare.network). Contributions and issues welcome.
