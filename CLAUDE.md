# CLAUDE.md — flare-mcp Project Brief

> **V2 AMENDMENTS (2026-07, nadrzędne wobec reszty pliku):**
> 1. Sieci: **cztery** — mainnet (14), Coston2 (114), **Songbird (19), Coston (16)**; env vary `FLARE_RPC_SONGBIRD`, `FLARE_RPC_COSTON`.
> 2. Zasada READ-ONLY złagodzona **wyłącznie** dla `fdc_request_attestation`: opcjonalny `FLARE_PRIVATE_KEY` (podpis lokalny, nigdy logowany) pozwala wysłać attestation request do FdcHub; bez klucza tryb prepared-only. Żaden tool nie ma nigdy custody środków.
> 3. Duże ABI (IAssetManager, IFdcVerification, IRelay, IFdcHub) pobieramy z oficjalnego `@flarenetwork/flare-periphery-contract-artifacts` (`interfaceToAbi`), nie ręcznie.
> 4. Nowe toole v2: `fdc_request_attestation`, `fdc_get_attestation_proof` (lokalna weryfikacja Merkle vs Relay), `fassets_agent_status`, `fassets_system_state`, `songbird_fcc_registry`.
> 5. Testy: `npm test` (vitest, recorded fixtures w `test/fixtures/`), live checks: `npx tsx scripts/live-check.ts`.
> 6. Decyzje i odstępstwa: patrz `DECISIONS.md`. Spec v2: `~/Desktop/flare-mcp-v2-x402-build-spec.md`.

## Co budujesz

**flare-mcp** — pierwszy MCP (Model Context Protocol) server dla Flare Network.
Pozwala Claude Desktop, Cursor, VS Code i każdemu MCP-compatible AI na bezpośrednie
odpytywanie Flare blockchain przez natural language. Zero serwera, zero kosztów —
działa lokalnie przez stdio transport jako npx package.

**Autor:** Dziuba Technology / Alan Dziuba  
**Repozytorium docelowe:** github.com/[USERNAME]/flare-mcp  
**npm package name:** flare-mcp  

---

## Stack — nic poza tym

```
TypeScript (ESM, Node.js 18+)
@modelcontextprotocol/sdk        ← MCP server framework
viem                             ← EVM RPC client (NIE ethers.js)
zod                              ← input validation dla tools
@flarenetwork/flare-periphery-contract-artifacts ← Flare ABIs
```

**Package manager:** npm (nie yarn, nie pnpm)  
**Build:** tsc → dist/  
**Transport:** WYŁĄCZNIE stdio (read-only, bez private keys, bez transakcji)

---

## Absolutne zasady — nigdy ich nie łam

1. **READ-ONLY** — żadnych transakcji, żadnych private keys, żadnych state-changing calls
2. **stdio transport only** — nie implementuj HTTP/SSE w tej wersji
3. **viem, nie ethers.js** — Flare używa viem w swoich oficjalnych narzędziach
4. **Wszystkie sieci konfigurowalne** — mainnet (chainId: 14) i Coston2 testnet (chainId: 114)
5. **Zod validation** dla każdego tool input — bez wyjątków
6. **Error handling** — każdy tool musi zwracać sensowny error message gdy RPC fail
7. **Żadnych hardcoded private keys** — RPC URL przez env var FLARE_RPC (mainnet) i FLARE_RPC_TESTNET (Coston2)

---

## Struktura projektu — dokładnie tak

```
flare-mcp/
├── src/
│   ├── index.ts                 ← main entry, MCP server setup
│   ├── tools/
│   │   ├── ftso.ts              ← FTSO tools (feeds, providers, history)
│   │   ├── fassets.ts           ← FAssets tools (status, agents)
│   │   ├── fdc.ts               ← FDC tools (proof status)
│   │   ├── wallet.ts            ← balance tools (FLR, WFLR)
│   │   └── smart-accounts.ts   ← Smart Accounts (XRPL → Flare mapping)
│   ├── resources/
│   │   └── network.ts          ← MCP resources (feed list, contract addresses)
│   └── utils/
│       ├── rpc.ts              ← viem clients, chain configs
│       └── contracts.ts        ← Flare contract addresses (mainnet + Coston2)
├── CLAUDE.md                   ← ten plik
├── TASKS.md                    ← lista etapów
├── package.json
├── tsconfig.json
└── README.md
```

---

## Flare Network — kluczowe dane techniczne

### RPC Endpoints
```
Mainnet:   https://flare-api.flare.network/ext/C/rpc     (chainId: 14)
Coston2:   https://coston2-api.flare.network/ext/C/rpc   (chainId: 114)
```

### Kluczowe kontrakty (przez ContractRegistry pattern)

Flare używa ContractRegistry — **nie hardcoduj adresów kontraktów bezpośrednio**.
Zamiast tego pobieraj je runtime przez `getContractAddressByName()`:

```typescript
// ContractRegistry address (ten sam na mainnet i Coston2)
const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019"

// Przykład pobierania adresu FtsoV2:
// getContractAddressByName("FtsoV2")
// getContractAddressByName("FAssetManager") 
// getContractAddressByName("FdcHub")
// getContractAddressByName("WNat")
```

### FTSO Feed IDs (przykłady)
```
FLR/USD:  0x01464c522f55534400000000000000000000000000  (category 1 = Crypto)
BTC/USD:  0x014254432f55534400000000000000000000000000
ETH/USD:  0x014554482f55534400000000000000000000000000
XRP/USD:  0x015852502f55534400000000000000000000000000
```

Feed format: `category (1 byte) + name (padded to 20 bytes)`

### Jak czytać FTSO feeds (FtsoV2Interface)
```typescript
// getFeedById(feedId) → (value: uint256, decimals: int8, timestamp: uint64)
// getFeedsById(feedIds[]) → (values[], decimals[], timestamp)
// getFeedByIdInWei(feedId) → value in wei (18 decimals)
```

### Jak czytać FAssets
```typescript
// FAssetManager: getAgents() → agent list
// CollateralPool: agentInfo(agent) → collateral ratio, minted amount
```

---

## MCP Tools — pełna specyfikacja

### Tool: get_ftso_feed
```
Input:  feed_id (string, np. "FLR/USD"), network ("mainnet" | "coston2")
Output: price (number), decimals (number), timestamp (unix), feed_id, network
```

### Tool: get_ftso_feeds_all  
```
Input:  network ("mainnet" | "coston2")
Output: array of {feed_id, name, price, decimals, timestamp}
Feeds do pobrania z FtsoV2 — pobierz listę z oficjalnego Flare dev docs
lub hardcode top 20 feeds (FLR, BTC, ETH, XRP, DOGE, ADA, SOL, MATIC...)
```

### Tool: get_ftso_providers
```
Input:  network ("mainnet" | "coston2")
Output: array of {name, address, vote_power, fee_percent, reward_rate}
Dane z: FtsoRewardManager lub DA Layer API (https://flare-systems-explorer.flare.network)
Jeśli on-chain zbyt kompleksowe → użyj public flaremetrics.io API jako fallback
```

### Tool: get_ftso_history
```
Input:  feed_id (string), rounds (number, max 100), network
Output: array of {round_id, price, decimals, timestamp, turnout_bips}
Dane z: data-availability API jeśli dostępne, lub VotingResult events
```

### Tool: get_flr_balance
```
Input:  address (string, EVM hex), network ("mainnet" | "coston2")
Output: flr_balance (string w ether), wflr_balance (string w ether), address
```

### Tool: get_fassets_status
```
Input:  asset ("FXRP" | "FBTC" | "FDOGE"), network
Output: total_minted (string), total_collateral (string), active_agents (number),
        collateral_ratio (number), minting_paused (boolean)
```

### Tool: get_fdc_proof_status
```
Input:  voting_round_id (number), network
Output: merkle_root (string), security_status (string), timestamp,
        protocol_id (number, 200 for FDC)
Data z: ContractRegistry → Relay contract → getProtocolMessageMerkleRoot()
```

### Tool: get_smart_account_info
```
Input:  xrpl_address (string, r... format), network
Output: flare_address (string), has_account (boolean), network
Mapping: każdy XRPL address ma deterministycznie zmapowany Flare address
przez MasterAccountController kontrakt
```

---

## MCP Resources

### Resource: flare://network/feeds
```
Zwraca: JSON z listą wszystkich oficjalnych FTSO feed IDs i ich nazwami
Static data z Flare developer hub — aktualizuj ręcznie w utils/contracts.ts
```

### Resource: flare://network/contracts
```
Zwraca: JSON z adresami kluczowych kontraktów na mainnet i Coston2
Pobierane runtime przez ContractRegistry
```

---

## package.json — wymagana konfiguracja bin

```json
{
  "name": "flare-mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "flare-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "inspect": "npx @modelcontextprotocol/inspector node dist/index.js"
  }
}
```

Shebang line w dist/index.js musi być: `#!/usr/bin/env node`

---

## tsconfig.json — wymagana konfiguracja

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

---

## Jak użytkownik konfiguruje (docelowy UX)

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "flare-mcp": {
      "command": "npx",
      "args": ["-y", "flare-mcp"],
      "env": {
        "FLARE_RPC": "https://flare-api.flare.network/ext/C/rpc",
        "FLARE_RPC_TESTNET": "https://coston2-api.flare.network/ext/C/rpc"
      }
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "flare-mcp": {
      "command": "npx",
      "args": ["-y", "flare-mcp"]
    }
  }
}
```

---

## Źródła wiedzy — użyj gdy potrzebujesz szczegółów

- Flare dev docs: https://dev.flare.network/
- FTSO overview: https://dev.flare.network/ftso/overview
- FAssets: https://dev.flare.network/fassets/overview  
- FDC: https://dev.flare.network/fdc/overview
- Smart Accounts: https://dev.flare.network/smart-accounts/overview
- MCP SDK docs: https://modelcontextprotocol.io/docs
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Flare periphery artifacts: https://github.com/flare-foundation/flare-npm-periphery-package

---

## Czego NIE rób

- Nie implementuj transakcji ani funkcji write
- Nie używaj ethers.js (tylko viem)
- Nie hardcoduj RPC URL (env vars)
- Nie pomijaj zod validation
- Nie implementuj HTTP/SSE transport
- Nie używaj `any` w TypeScript
- Nie zapominaj o obsłudze błędów RPC (try/catch wszędzie)
- Nie używaj `console.log` (MCP używa stdout do komunikacji — logi tylko na stderr)
