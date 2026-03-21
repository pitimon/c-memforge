/**
 * Search Tool Handlers
 *
 * Handlers for search-related MCP tools.
 */

import type { ToolDefinition, ToolResponse, SearchResponse } from "../types";
import { callRemoteAPI, wrapError, wrapSuccess } from "../api-client";
import {
  formatSearchResults,
  formatHybridResults,
  formatVectorResults,
} from "../formatters";

/**
 * Call search API and format results.
 *
 * @param endpoint - API endpoint to call
 * @param params - Query parameters
 * @returns Promise resolving to ToolResponse
 */
async function callSearchAPI(
  endpoint: string,
  params: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const data = (await callRemoteAPI(endpoint, params)) as SearchResponse;
    const offset =
      typeof params.offset === "number" ? params.offset : undefined;

    if (endpoint === "/search" && data.results) {
      return wrapSuccess(formatSearchResults(data, offset));
    }

    if (endpoint === "/hybrid" && data.results) {
      return wrapSuccess(formatHybridResults(data, offset));
    }

    if (endpoint === "/vector" && data.results) {
      return wrapSuccess(formatVectorResults(data, offset));
    }

    return wrapSuccess(JSON.stringify(data, null, 2));
  } catch (error) {
    return wrapError(error);
  }
}

/** mem_semantic_search tool definition */
export const memSemanticSearch: ToolDefinition = {
  name: "mem_semantic_search",
  description:
    "Primary search tool — use FIRST for any memory query. " +
    "Supports 3 modes: hybrid (default, best for most queries), " +
    "fts (exact keyword match), vector (semantic similarity). " +
    "Use mem_timeline AFTER finding relevant obs to get surrounding context. " +
    "Use mem_entity_lookup instead for entity-specific lookups.",
  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Search query (required). Supports Thai and English.",
      },
      limit: {
        type: "number",
        description: "Max results (default: 10, max: 50)",
      },
      mode: {
        type: "string",
        enum: ["hybrid", "fts", "vector"],
        description:
          "Search mode: hybrid (default), fts (keyword-only), vector (semantic-only)",
      },
      vector_weight: {
        type: "number",
        description:
          "For hybrid mode: weight 0-1 (default: 0.5). Higher = favor semantic.",
      },
      dateStart: {
        type: "string",
        description:
          "Start date filter (YYYY-MM-DD). Use with tz for timezone.",
      },
      dateEnd: {
        type: "string",
        description: "End date filter (YYYY-MM-DD). Use with tz for timezone.",
      },
      tz: {
        type: "string",
        description:
          "Timezone offset for date filtering (e.g., +07:00, -05:00, Z). Without tz, dates are UTC.",
      },
      offset: {
        type: "number",
        description: "Skip first N results for pagination (default: 0)",
      },
      include_shared: {
        type: "boolean",
        description:
          "Include observations shared with you by other users (default: false)",
      },
    },
    required: ["q"],
  },
  handler: async (args) => {
    const mode = (args.mode as string) || "hybrid";
    const endpoint =
      mode === "fts" ? "/search" : mode === "vector" ? "/vector" : "/hybrid";
    return await callSearchAPI(endpoint, {
      q: args.q,
      limit: args.limit || 10,
      offset: args.offset,
      vector_weight: args.vector_weight || 0.5,
      skip_rerank: mode === "fts",
      dateStart: args.dateStart,
      dateEnd: args.dateEnd,
      tz: args.tz,
      include_shared: args.include_shared,
    });
  },
};

/** mem_hybrid_search tool definition */
export const memHybridSearch: ToolDefinition = {
  name: "mem_hybrid_search",
  description:
    "Dedicated hybrid search (vector + FTS with RRF ranking). " +
    "Use mem_semantic_search instead — it supports hybrid mode and is more flexible. " +
    "This tool exists for backward compatibility.",
  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Search query (required). Supports Thai and English.",
      },
      limit: {
        type: "number",
        description: "Max results (default: 10, max: 50)",
      },
      vector_weight: {
        type: "number",
        description:
          "Weight for vector search 0-1 (default: 0.5). Higher = favor semantic meaning.",
      },
      dateStart: {
        type: "string",
        description:
          "Start date filter (YYYY-MM-DD). Use with tz for timezone.",
      },
      dateEnd: {
        type: "string",
        description: "End date filter (YYYY-MM-DD). Use with tz for timezone.",
      },
      tz: {
        type: "string",
        description:
          "Timezone offset for date filtering (e.g., +07:00, -05:00, Z). Without tz, dates are UTC.",
      },
      offset: {
        type: "number",
        description: "Skip first N results for pagination (default: 0)",
      },
      include_shared: {
        type: "boolean",
        description:
          "Include observations shared with you by other users (default: false)",
      },
    },
    required: ["q"],
  },
  handler: async (args) => {
    return await callSearchAPI("/hybrid", {
      q: args.q,
      limit: args.limit || 10,
      offset: args.offset,
      vector_weight: args.vector_weight || 0.5,
      dateStart: args.dateStart,
      dateEnd: args.dateEnd,
      tz: args.tz,
      include_shared: args.include_shared,
    });
  },
};

/** mem_vector_search tool definition */
export const memVectorSearch: ToolDefinition = {
  name: "mem_vector_search",
  description:
    "Pure semantic/embedding search — finds conceptually similar content even with different wording. " +
    "Use mem_semantic_search instead for most queries (hybrid mode combines this with keyword matching). " +
    "Use this directly only when you need pure semantic similarity without keyword influence.",
  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Search query (required). Supports Thai and English.",
      },
      limit: {
        type: "number",
        description: "Max results (default: 10, max: 50)",
      },
      dateStart: {
        type: "string",
        description:
          "Start date filter (YYYY-MM-DD). Use with tz for timezone.",
      },
      dateEnd: {
        type: "string",
        description: "End date filter (YYYY-MM-DD). Use with tz for timezone.",
      },
      tz: {
        type: "string",
        description:
          "Timezone offset for date filtering (e.g., +07:00, -05:00, Z). Without tz, dates are UTC.",
      },
      offset: {
        type: "number",
        description: "Skip first N results for pagination (default: 0)",
      },
      include_shared: {
        type: "boolean",
        description:
          "Include observations shared with you by other users (default: false)",
      },
    },
    required: ["q"],
  },
  handler: async (args) => {
    return await callSearchAPI("/vector", {
      q: args.q,
      limit: args.limit || 10,
      offset: args.offset,
      dateStart: args.dateStart,
      dateEnd: args.dateEnd,
      tz: args.tz,
      include_shared: args.include_shared,
    });
  },
};

/** mem_search tool definition (plugin-compatible FTS) */
export const memSearch: ToolDefinition = {
  name: "mem_search",
  description:
    "Keyword-only (FTS) search — exact text matching without semantic understanding. " +
    "Use mem_semantic_search instead for most queries (it defaults to hybrid which includes FTS). " +
    "Use this directly only when you need exact keyword match or want to filter by project/type.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (required)",
      },
      limit: {
        type: "number",
        description: "Max results (default: 10)",
      },
      project: {
        type: "string",
        description: "Filter by project name",
      },
      type: {
        type: "string",
        description:
          "Filter by observation type (e.g., bugfix, feature, decision)",
      },
      dateStart: {
        type: "string",
        description:
          "Start date filter (YYYY-MM-DD). Use with tz for timezone.",
      },
      dateEnd: {
        type: "string",
        description: "End date filter (YYYY-MM-DD). Use with tz for timezone.",
      },
      tz: {
        type: "string",
        description:
          "Timezone offset for date filtering (e.g., +07:00, -05:00, Z). Without tz, dates are UTC.",
      },
      offset: {
        type: "number",
        description: "Skip first N results for pagination (default: 0)",
      },
      include_shared: {
        type: "boolean",
        description:
          "Include observations shared with you by other users (default: false)",
      },
    },
    required: ["query"],
  },
  handler: async (args) => {
    return await callSearchAPI("/search", {
      q: args.query,
      limit: args.limit || 10,
      offset: args.offset,
      project: args.project,
      type: args.type,
      dateStart: args.dateStart,
      dateEnd: args.dateEnd,
      tz: args.tz,
      include_shared: args.include_shared,
    });
  },
};

/** All search handlers */
export const searchHandlers: ToolDefinition[] = [
  memSemanticSearch,
  memHybridSearch,
  memVectorSearch,
  memSearch,
];
