#!/usr/bin/env node
// flare-mcp entry point.
//
//   flare-mcp                 → MCP server over stdio (default; for Claude
//                               Desktop, Cursor, VS Code, ...)
//   flare-mcp --http [port]   → hub mode: MCP over Streamable HTTP at /mcp
//                               plus spec-style x402 REST endpoints
//                               (also: FLARE_MCP_HTTP_PORT env var)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { startHub } from "./hub.js";

async function main() {
  const args = process.argv.slice(2);
  const httpFlag = args.indexOf("--http");
  const envPort = process.env.FLARE_MCP_HTTP_PORT;

  if (httpFlag !== -1 || envPort) {
    const port = Number(
      (httpFlag !== -1 ? args[httpFlag + 1] : undefined) ?? envPort ?? 8402,
    );
    await startHub(Number.isFinite(port) && port > 0 ? port : 8402);
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("flare-mcp server started\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
