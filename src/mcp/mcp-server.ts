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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { initializeApiKey, isRemoteEnabled, getRemoteUrl } from './api-client';
import { getAllTools } from './handlers';

// Redirect console.log to stderr (MCP uses stdout for JSON-RPC)
const _originalConsoleLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);

// Initialize API key from environment or settings
initializeApiKey();

// Log remote status
if (isRemoteEnabled()) {
  console.log(`Remote search enabled: ${getRemoteUrl()}`);
} else {
  console.log('Remote search disabled (no API key)');
}

// Get all tool definitions
const tools = getAllTools();

// Create MCP server
const server = new Server(
  {
    name: 'memforge-client',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
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

  try {
    return await tool.handler((request.params.arguments || {}) as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: `Tool execution failed: ${message}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('MemForge Client MCP server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
