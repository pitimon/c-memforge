/**
 * Observation Tool Handlers
 *
 * Handlers for observation-related MCP tools.
 */

import type { ToolDefinition, Observation, TimelineResponse } from '../types';
import { callRemoteAPI, fetchObservationsByIds, wrapError, wrapSuccess } from '../api-client';
import { formatObservations, formatTimeline } from '../formatters';

// Note: callRemoteAPI is used by memTimeline, fetchObservationsByIds is used by memSemanticGet and memGetObservations

/** mem_semantic_get tool definition */
export const memSemanticGet: ToolDefinition = {
  name: 'mem_semantic_get',
  description: 'Get full observation by ID from remote server.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'number',
        description: 'Observation ID (required)',
      },
    },
    required: ['id'],
  },
  handler: async (args) => {
    try {
      const data = await fetchObservationsByIds([args.id as number]) as {
        observations?: Observation[];
      };
      const observation = data.observations?.[0] || (data as unknown as Observation[])?.[0];
      if (!observation) {
        return wrapSuccess(`Observation #${args.id} not found`);
      }
      return wrapSuccess(formatObservations([observation]));
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** mem_semantic_recent tool definition */
export const memSemanticRecent: ToolDefinition = {
  name: 'mem_semantic_recent',
  description: 'Get recent observations from remote server.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
    },
  },
  handler: async (args) => {
    try {
      const data = await callRemoteAPI('/recent', { limit: args.limit || 20 });
      return wrapSuccess(JSON.stringify(data, null, 2));
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** mem_timeline tool definition */
export const memTimeline: ToolDefinition = {
  name: 'mem_timeline',
  description: 'Get context around a specific observation ID from remote server. Returns observations before and after the anchor point.',
  inputSchema: {
    type: 'object',
    properties: {
      anchor: {
        type: 'number',
        description: 'Observation ID to get context around (required)',
      },
      query: {
        type: 'string',
        description: 'Optional query to find anchor automatically',
      },
      depth_before: {
        type: 'number',
        description: 'Number of observations before anchor (default: 5)',
      },
      depth_after: {
        type: 'number',
        description: 'Number of observations after anchor (default: 5)',
      },
      project: {
        type: 'string',
        description: 'Filter by project name',
      },
    },
  },
  handler: async (args) => {
    try {
      const params = {
        anchor: args.anchor,
        query: args.query,
        depth_before: args.depth_before || 5,
        depth_after: args.depth_after || 5,
        project: args.project,
      };

      const data = await callRemoteAPI('/api/timeline', params) as TimelineResponse;
      return wrapSuccess(formatTimeline(data, args.anchor as number));
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** mem_get_observations tool definition */
export const memGetObservations: ToolDefinition = {
  name: 'mem_get_observations',
  description: 'Fetch full observation details by IDs from remote server. Use after search/timeline to get complete narrative and context.',
  inputSchema: {
    type: 'object',
    properties: {
      ids: {
        type: 'array',
        items: { type: 'number' },
        description: 'Array of observation IDs to fetch (required)',
      },
    },
    required: ['ids'],
  },
  handler: async (args) => {
    try {
      const data = await fetchObservationsByIds(args.ids as number[]) as {
        observations?: Observation[];
      };

      const observations = data.observations || (data as unknown as Observation[]) || [];
      return wrapSuccess(formatObservations(observations));
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** All observation handlers */
export const observationHandlers: ToolDefinition[] = [
  memSemanticGet,
  memSemanticRecent,
  memTimeline,
  memGetObservations,
];
