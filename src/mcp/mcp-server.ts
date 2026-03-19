#!/usr/bin/env bun
/**
 * MemForge Client MCP Server
 *
 * Provides semantic search tools via MCP protocol.
 * Calls the remote API at memclaude.thaicloud.ai
 *
 * Architecture: Remote-only (SaaS client)
 * - Semantic/Hybrid/Vector search via remote server
 * - All data stored on remote server
 * - Local claude-mem plugin handles local storage
 *
 * Modular structure:
 * - types.ts - Shared type definitions
 * - api-client.ts - API communication
 * - formatters/ - Response formatters
 * - handlers/ - Tool handlers
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { readFileSync } from "fs";
import {
  initializeApiKey,
  isRemoteEnabled,
  getRemoteUrl,
  resolveConfigPath,
} from "./api-client";
import { getAllTools } from "./handlers";
import { validateToolInput } from "./validation";
import { auditLog } from "./audit-logger";
import { SyncPoller } from "../sync/sync-poller";
import pkg from "../../package.json";

// Redirect console.log to stderr (MCP uses stdout for JSON-RPC)
const _originalConsoleLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);

// Initialize API key from environment or settings
initializeApiKey();

// Log remote status
if (isRemoteEnabled()) {
  console.log(`Remote search enabled: ${getRemoteUrl()}`);
} else {
  console.log("Remote search disabled (no API key)");
}

// Get all tool definitions
const tools = getAllTools();

// Create MCP server
const server = new Server(
  {
    name: "memforge-client",
    version: pkg.version,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Register tools/list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// Register tools/call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);

  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const rawArgs = (request.params.arguments || {}) as Record<string, unknown>;
  const start = Date.now();

  // Validate input before handler execution
  let validatedArgs: Record<string, unknown>;
  try {
    validatedArgs = validateToolInput(request.params.name, rawArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    auditLog(request.params.name, rawArgs, Date.now() - start, false, message);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(validatedArgs);
    auditLog(request.params.name, rawArgs, Date.now() - start, true);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    auditLog(request.params.name, rawArgs, Date.now() - start, false, message);
    return {
      content: [
        { type: "text" as const, text: `Tool execution failed: ${message}` },
      ],
      isError: true,
    };
  }
});

// Sync poller instance (started if syncEnabled in config)
// Exported for status-handler to read sync stats
export let syncPoller: SyncPoller | null = null;

async function initSync(): Promise<void> {
  const configPath = resolveConfigPath();
  if (!configPath) return;

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!config.syncEnabled) return;

    syncPoller = new SyncPoller({
      pollInterval: config.pollInterval || 2000,
      logger: console.error,
    });
    await syncPoller.start();
  } catch (error) {
    console.error("[Sync] Failed to initialize:", error);
  }
}

// Graceful shutdown
process.on("SIGTERM", () => syncPoller?.stop());
process.on("SIGINT", () => syncPoller?.stop());

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("MemForge Client MCP server started");

  // Start sync poller after MCP server is connected
  await initSync();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
