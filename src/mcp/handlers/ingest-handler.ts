/**
 * MCP Ingest Handler (v0.22 #184)
 *
 * mem_ingest tool for cross-agent observation ingestion via MCP.
 */

import type { ToolDefinition } from "../types";
import { postRemoteAPI, wrapError, wrapSuccess } from "../api-client";

/** mem_ingest tool definition */
export const memIngest: ToolDefinition = {
  name: "mem_ingest",
  description:
    "Push observations from external AI agents (Cursor, Aider, Codex) into MemForge. " +
    "Single or batch mode (max 100 items). " +
    "Use this only for cross-agent ingestion — claude-mem handles Claude Code observations automatically.",
  inputSchema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        description:
          "Agent provider: cursor, aider, codex, openai, chatgpt, generic (default: generic)",
      },
      item: {
        type: "object",
        description:
          "Single observation payload. Provider-specific fields are auto-transformed.",
        properties: {
          title: { type: "string", description: "Observation title" },
          content: { type: "string", description: "Main content/narrative" },
          narrative: { type: "string", description: "Alias for content" },
          type: { type: "string", description: "Observation type" },
          project: { type: "string", description: "Project name" },
          files_read: {
            type: "array",
            items: { type: "string" },
            description: "Files read during this work",
          },
          files_modified: {
            type: "array",
            items: { type: "string" },
            description: "Files modified during this work",
          },
        },
      },
      items: {
        type: "array",
        description: "Batch mode: array of observation payloads (max 100)",
        items: { type: "object" },
      },
    },
  },
  handler: async (args) => {
    try {
      const data = await postRemoteAPI("/api/ingest", args);
      const result = data as {
        provider: string;
        total: number;
        created: number;
        skipped: number;
      };
      return wrapSuccess(
        `Ingested ${result.created}/${result.total} observations via ${result.provider} adapter` +
          (result.skipped > 0 ? ` (${result.skipped} skipped)` : ""),
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

export const ingestHandlers: ToolDefinition[] = [memIngest];
