/**
 * Entity Tool Handlers
 *
 * Handlers for entity lookup and triplets MCP tools.
 */

import type { ToolDefinition, EntityLookupResponse, TripletsQueryResponse } from '../types';
import { getRemoteUrl, getApiKey, wrapError, wrapSuccess } from '../api-client';
import { formatEntityLookup, formatTripletsQuery } from '../formatters';

/** mem_entity_lookup tool definition */
export const memEntityLookup: ToolDefinition = {
  name: 'mem_entity_lookup',
  description: 'O(1) entity lookup - find observations and triplets related to an entity name. Returns all triplets where the entity appears as subject or object.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Entity name to lookup (case-insensitive). Examples: "bugfix", "api-proxy.ts", "authentication"',
      },
    },
    required: ['name'],
  },
  handler: async (args) => {
    try {
      const entityName = encodeURIComponent(args.name as string);
      const response = await fetch(`${getRemoteUrl()}/api/entity/${entityName}`, {
        headers: { 'X-API-Key': getApiKey() },
      });

      if (!response.ok) {
        throw new Error(`Remote API error (${response.status})`);
      }

      const data = await response.json() as EntityLookupResponse;
      return wrapSuccess(formatEntityLookup(data, args.name as string));
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** mem_triplets_query tool definition */
export const memTripletsQuery: ToolDefinition = {
  name: 'mem_triplets_query',
  description: 'Query SPO (Subject-Predicate-Object) triplets with filters. Predicates: is_type (observation type), belongs_to (project), modifies (file changes), relates_to (concept relationships).',
  inputSchema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'Filter by subject (substring match, case-insensitive)',
      },
      predicate: {
        type: 'string',
        description: 'Filter by predicate (exact match). Options: is_type, belongs_to, modifies, relates_to',
      },
      object: {
        type: 'string',
        description: 'Filter by object (substring match, case-insensitive)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 100)',
      },
    },
  },
  handler: async (args) => {
    try {
      const params = new URLSearchParams();
      if (args.subject) params.append('subject', args.subject as string);
      if (args.predicate) params.append('predicate', args.predicate as string);
      if (args.object) params.append('object', args.object as string);
      params.append('limit', String(args.limit || 100));

      const response = await fetch(`${getRemoteUrl()}/api/triplets?${params}`, {
        headers: { 'X-API-Key': getApiKey() },
      });

      if (!response.ok) {
        throw new Error(`Remote API error (${response.status})`);
      }

      const data = await response.json() as TripletsQueryResponse;
      return wrapSuccess(formatTripletsQuery(data, {
        subject: args.subject as string | undefined,
        predicate: args.predicate as string | undefined,
        object: args.object as string | undefined,
      }));
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
