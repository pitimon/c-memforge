/**
 * Entity Tool Handlers
 *
 * Handlers for entity lookup and triplets MCP tools.
 */

import type {
  ToolDefinition,
  EntityLookupResponse,
  TripletsQueryResponse,
} from "../types";
import { callRemoteAPI, wrapError, wrapSuccess } from "../api-client";
import { formatEntityLookup, formatTripletsQuery } from "../formatters";

/** mem_entity_lookup tool definition */
export const memEntityLookup: ToolDefinition = {
  name: "mem_entity_lookup",
  description:
    "Fast entity lookup — find all knowledge graph relationships for a named entity. " +
    "Use instead of mem_semantic_search when you know the exact entity name (file, concept, technology). " +
    "Follow up with mem_triplets_query for filtered relationship queries.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          'Entity name to lookup (case-insensitive). Examples: "bugfix", "api-proxy.ts", "authentication"',
      },
    },
    required: ["name"],
  },
  handler: async (args) => {
    try {
      const entityName = encodeURIComponent(args.name as string);
      const data = (await callRemoteAPI(
        `/api/entity/${entityName}`,
        {},
      )) as EntityLookupResponse;
      return wrapSuccess(formatEntityLookup(data, args.name as string));
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** mem_triplets_query tool definition */
export const memTripletsQuery: ToolDefinition = {
  name: "mem_triplets_query",
  description:
    "Query knowledge graph relationships (Subject-Predicate-Object). " +
    "Use AFTER mem_entity_lookup for filtered relationship queries. " +
    "Predicates: is_type, belongs_to, modifies, relates_to. " +
    "Use mem_entity_lookup instead for simple entity lookups.",
  inputSchema: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "Filter by subject (substring match, case-insensitive)",
      },
      predicate: {
        type: "string",
        description:
          "Filter by predicate (exact match). Options: is_type, belongs_to, modifies, relates_to",
      },
      object: {
        type: "string",
        description: "Filter by object (substring match, case-insensitive)",
      },
      limit: {
        type: "number",
        description: "Max results (default: 100)",
      },
    },
  },
  handler: async (args) => {
    try {
      const params: Record<string, unknown> = {
        limit: args.limit || 100,
      };
      if (args.subject) params.subject = args.subject;
      if (args.predicate) params.predicate = args.predicate;
      if (args.object) params.object = args.object;

      const data = (await callRemoteAPI(
        "/api/triplets",
        params,
      )) as TripletsQueryResponse;
      return wrapSuccess(
        formatTripletsQuery(data, {
          subject: args.subject as string | undefined,
          predicate: args.predicate as string | undefined,
          object: args.object as string | undefined,
        }),
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** All entity handlers */
export const entityHandlers: ToolDefinition[] = [
  memEntityLookup,
  memTripletsQuery,
];
