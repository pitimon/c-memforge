/**
 * MCP Handlers Index
 *
 * Re-export all handlers for convenient imports.
 * Note: Snapshot tools removed from client plugin — clients should not have
 * power to create/restore/delete memory snapshots. Server-side MCP retains
 * full snapshot capabilities for admin operations.
 */

import type { ToolDefinition } from "../types";

export { searchHandlers } from "./search-handlers";
export { observationHandlers } from "./observation-handlers";
export { entityHandlers } from "./entity-handlers";
export { statusHandlers } from "./status-handler";

// Re-export individual handlers for direct imports
export {
  memSemanticSearch,
  memHybridSearch,
  memVectorSearch,
  memSearch,
} from "./search-handlers";

export {
  memSemanticGet,
  memSemanticRecent,
  memTimeline,
  memGetObservations,
} from "./observation-handlers";

export { memEntityLookup, memTripletsQuery } from "./entity-handlers";

export { memStatus } from "./status-handler";

/**
 * Get all tool definitions for MCP server registration.
 *
 * @returns Array of all tool definitions (read/search/browse only)
 */
export function getAllTools(): ToolDefinition[] {
  // Import directly to avoid circular dependencies
  const { searchHandlers } = require("./search-handlers");
  const { observationHandlers } = require("./observation-handlers");
  const { entityHandlers } = require("./entity-handlers");
  const { statusHandlers } = require("./status-handler");

  return [
    ...statusHandlers,
    ...searchHandlers,
    ...observationHandlers,
    ...entityHandlers,
  ];
}
