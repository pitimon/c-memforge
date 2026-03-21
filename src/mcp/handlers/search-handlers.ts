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

/** mem_temporal_query tool definition */
export const memTemporalQuery: ToolDefinition = {
  name: "mem_temporal_query",
  description:
    "Time-based search using natural language phrases ('yesterday', 'last week', '3 days ago'). " +
    "Use instead of mem_semantic_search when the query is primarily about WHEN something happened. " +
    "Supports Thai temporal phrases (เมื่อวาน, สัปดาห์ที่แล้ว, เดือนนี้).",
  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Search query text (optional — can search by time alone)",
      },
      before: {
        type: "string",
        description:
          "Find observations before this time (ISO date or phrase: 'yesterday', '3 days ago')",
      },
      after: {
        type: "string",
        description:
          "Find observations after this time (ISO date or phrase: 'last week')",
      },
      during: {
        type: "string",
        description:
          "Find observations during this period ('yesterday', 'last week', 'this month')",
      },
      limit: {
        type: "number",
        description: "Max results (default: 20, max: 100)",
      },
      tz: {
        type: "string",
        description: "Timezone offset (default: UTC, e.g. +07:00)",
      },
    },
  },
  handler: async (args) => {
    try {
      if (!args.q && !args.before && !args.after && !args.during) {
        return wrapError(
          new Error("At least one of q, before, after, or during is required."),
        );
      }

      const params: Record<string, unknown> = {
        limit: args.limit ?? 20,
      };
      if (args.q) params.q = args.q;
      if (args.before) params.before = args.before;
      if (args.after) params.after = args.after;
      if (args.during) params.during = args.during;
      if (args.tz) params.tz = args.tz;

      const data = (await callRemoteAPI("/api/search/temporal", params)) as {
        results: Array<{
          id: number;
          title: string;
          type: string;
          narrative?: string;
          created_at: string;
        }>;
        temporal?: {
          resolved?: {
            dateStart?: string;
            dateEnd?: string;
          };
          source?: string;
        };
        result_count: number;
      };

      if (!data.results || data.results.length === 0) {
        const resolved = data.temporal?.resolved;
        const range = resolved
          ? ` (resolved: ${resolved.dateStart ?? "?"} to ${resolved.dateEnd ?? "?"})`
          : "";
        return wrapSuccess(`No observations found for temporal query${range}.`);
      }

      const formatted = data.results
        .map(
          (o, i) =>
            `${i + 1}. **#${o.id}** ${o.title}\n` +
            `   Type: ${o.type} | Created: ${o.created_at.split("T")[0]}` +
            (o.narrative
              ? `\n   ${o.narrative.slice(0, 150)}${o.narrative.length > 150 ? "..." : ""}`
              : ""),
        )
        .join("\n\n");

      const resolved = data.temporal?.resolved;
      const rangeInfo = resolved
        ? `\nResolved range: ${resolved.dateStart ?? "?"} to ${resolved.dateEnd ?? "?"}`
        : "";

      return wrapSuccess(
        `Found ${data.result_count} observation(s):${rangeInfo}\n\n${formatted}`,
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** All search handlers */
export const searchHandlers: ToolDefinition[] = [
  memSemanticSearch,
  memHybridSearch,
  memVectorSearch,
  memSearch,
  memTemporalQuery,
];
