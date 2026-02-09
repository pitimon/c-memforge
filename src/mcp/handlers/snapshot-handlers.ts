/**
 * Snapshot Tool Handlers
 *
 * Handlers for memory snapshot MCP tools (time-travel debugging).
 */

import type { ToolDefinition, SnapshotCreateResponse, SnapshotListResponse, SnapshotRestoreResponse } from '../types';
import { postRemoteAPI, deleteRemoteAPI, getRemoteUrl, getApiKey, wrapError, wrapSuccess } from '../api-client';
import { formatSnapshotCreate, formatSnapshotList, formatSnapshotRestore, formatSnapshotDelete } from '../formatters';

/** mem_snapshot_create tool definition */
export const memSnapshotCreate: ToolDefinition = {
  name: 'mem_snapshot_create',
  description: 'Create a point-in-time snapshot of memory for time-travel debugging. Stores all observations, embeddings, sessions, and triplets in compressed CM2 format.',
  inputSchema: {
    type: 'object',
    properties: {
      snapshot_name: {
        type: 'string',
        description: 'Unique name for the snapshot (alphanumeric, hyphens, underscores). Examples: "before-refactor", "v1-release", "pre-migration"',
      },
      description: {
        type: 'string',
        description: 'Optional description of what this snapshot captures',
      },
    },
    required: ['snapshot_name'],
  },
  handler: async (args) => {
    try {
      const data = await postRemoteAPI('/api/snapshots', {
        snapshot_name: args.snapshot_name,
        description: args.description,
      }) as SnapshotCreateResponse;

      return wrapSuccess(formatSnapshotCreate(data));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('too many observations') || message.toLowerCase().includes('too large')) {
        return wrapError(new Error(
          `Snapshot too large: ${message}\n\n` +
          `**Suggestion:** Contact your administrator to create the snapshot server-side, ` +
          `or wait for a quieter period with fewer active observations.`
        ));
      }
      return wrapError(new Error(`Error creating snapshot: ${message}`));
    }
  },
};

/** mem_snapshot_list tool definition */
export const memSnapshotList: ToolDefinition = {
  name: 'mem_snapshot_list',
  description: 'List all available memory snapshots with their metadata. Shows observation counts, sizes, and restoration history.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Max snapshots to return (default: 20)',
      },
      include_deleted: {
        type: 'boolean',
        description: 'Include soft-deleted snapshots (default: false)',
      },
    },
  },
  handler: async (args) => {
    try {
      const params = new URLSearchParams();
      params.append('limit', String(args.limit || 20));
      if (args.include_deleted) params.append('include_deleted', 'true');

      const response = await fetch(`${getRemoteUrl()}/api/snapshots?${params}`, {
        headers: { 'X-API-Key': getApiKey() },
      });

      if (!response.ok) {
        throw new Error(`Remote API error (${response.status})`);
      }

      const data = await response.json() as SnapshotListResponse;
      return wrapSuccess(formatSnapshotList(data));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return wrapError(new Error(`Error listing snapshots: ${message}`));
    }
  },
};

/** mem_snapshot_restore tool definition */
export const memSnapshotRestore: ToolDefinition = {
  name: 'mem_snapshot_restore',
  description: 'Restore memory to a previous snapshot state. WARNING: This replaces all current data with the snapshot contents. Use with caution.',
  inputSchema: {
    type: 'object',
    properties: {
      snapshot_id: {
        type: 'number',
        description: 'ID of the snapshot to restore (get from mem_snapshot_list)',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to confirm restoration. This is a destructive operation.',
      },
    },
    required: ['snapshot_id', 'confirm'],
  },
  handler: async (args) => {
    if (args.confirm !== true) {
      return wrapSuccess(
        `**WARNING: Confirmation Required**\n\nRestoring a snapshot will replace ALL current memory data. Set confirm=true to proceed.`
      );
    }

    try {
      const data = await postRemoteAPI(
        `/api/snapshots/${args.snapshot_id}/restore`,
        { confirm: true }
      ) as SnapshotRestoreResponse;

      return wrapSuccess(formatSnapshotRestore(data));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return wrapError(new Error(`Error restoring snapshot: ${message}`));
    }
  },
};

/** mem_snapshot_delete tool definition */
export const memSnapshotDelete: ToolDefinition = {
  name: 'mem_snapshot_delete',
  description: 'Soft-delete a memory snapshot. The snapshot can still be recovered if include_deleted=true is used.',
  inputSchema: {
    type: 'object',
    properties: {
      snapshot_id: {
        type: 'number',
        description: 'ID of the snapshot to delete',
      },
    },
    required: ['snapshot_id'],
  },
  handler: async (args) => {
    try {
      const data = await deleteRemoteAPI(`/api/snapshots/${args.snapshot_id}`) as {
        snapshot_name: string;
        snapshot_id: number;
      };

      return wrapSuccess(formatSnapshotDelete(data.snapshot_name, data.snapshot_id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return wrapError(new Error(`Error deleting snapshot: ${message}`));
    }
  },
};

/** All snapshot handlers */
export const snapshotHandlers: ToolDefinition[] = [
  memSnapshotCreate,
  memSnapshotList,
  memSnapshotRestore,
  memSnapshotDelete,
];
