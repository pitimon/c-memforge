/**
 * MCP Handlers Index
 *
 * Re-export all handlers for convenient imports.
 */

import type { ToolDefinition } from '../types';

export { searchHandlers } from './search-handlers';
export { observationHandlers } from './observation-handlers';
export { entityHandlers } from './entity-handlers';
export { snapshotHandlers } from './snapshot-handlers';

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

/**
 * Get all tool definitions for MCP server registration.
 *
 * @returns Array of all tool definitions
 */
export function getAllTools(): ToolDefinition[] {
  // Import directly to avoid circular dependencies
  const { searchHandlers } = require('./search-handlers');
  const { observationHandlers } = require('./observation-handlers');
  const { entityHandlers } = require('./entity-handlers');
  const { snapshotHandlers } = require('./snapshot-handlers');

  return [
    ...searchHandlers,
    ...observationHandlers,
    ...entityHandlers,
    ...snapshotHandlers,
  ];
}
