/**
 * MCP Handlers Index
 *
 * Re-export all handlers for convenient imports.
 */

import type { ToolDefinition } from '../types';
import { getRole } from '../api-client';

export { searchHandlers } from './search-handlers';
export { observationHandlers } from './observation-handlers';
export { entityHandlers } from './entity-handlers';
export { snapshotHandlers } from './snapshot-handlers';
export { statusHandlers } from './status-handler';

// Re-export individual handlers for direct imports
export {
  memSemanticSearch,
  memHybridSearch,
  memVectorSearch,
  memSearch,
} from './search-handlers';

export {
  memSemanticGet,
  memSemanticRecent,
  memTimeline,
  memGetObservations,
} from './observation-handlers';

export {
  memEntityLookup,
  memTripletsQuery,
} from './entity-handlers';

export {
  memSnapshotCreate,
  memSnapshotList,
  memSnapshotRestore,
  memSnapshotDelete,
} from './snapshot-handlers';

export { memStatus } from './status-handler';

/** Tools restricted to admin role */
const ADMIN_ONLY_TOOLS = new Set(['mem_snapshot_restore', 'mem_snapshot_delete']);

/**
 * Get all tool definitions for MCP server registration.
 * Filters admin-only tools based on configured role.
 *
 * @returns Array of all tool definitions
 */
export function getAllTools(): ToolDefinition[] {
  // Import directly to avoid circular dependencies
  const { searchHandlers } = require('./search-handlers');
  const { observationHandlers } = require('./observation-handlers');
  const { entityHandlers } = require('./entity-handlers');
  const { snapshotHandlers } = require('./snapshot-handlers');
  const { statusHandlers } = require('./status-handler');

  const allTools: ToolDefinition[] = [
    ...statusHandlers,
    ...searchHandlers,
    ...observationHandlers,
    ...entityHandlers,
    ...snapshotHandlers,
  ];

  const role = getRole();
  if (role === 'admin') {
    return allTools;
  }

  return allTools.filter((tool) => !ADMIN_ONLY_TOOLS.has(tool.name));
}
