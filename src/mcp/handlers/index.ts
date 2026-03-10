/**
 * MCP Handlers Index
 *
 * Re-export all handlers for convenient imports.
 * Note: Snapshot tools removed from client plugin — clients should not have
 * power to create/restore/delete memory snapshots. Server-side MCP retains
 * full snapshot capabilities for admin operations.
 */

import type { ToolDefinition } from "../types";

import { searchHandlers } from "./search-handlers";
import { observationHandlers } from "./observation-handlers";
import { entityHandlers } from "./entity-handlers";
import { statusHandlers } from "./status-handler";
import { ingestHandlers } from "./ingest-handler";
import { workflowHandlers } from "./workflow-handler";

export {
  searchHandlers,
  observationHandlers,
  entityHandlers,
  statusHandlers,
  ingestHandlers,
  workflowHandlers,
};

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

export { memIngest } from "./ingest-handler";
export { memWorkflowSuggest } from "./workflow-handler";

/**
 * Get all tool definitions for MCP server registration.
 *
 * @returns Array of all tool definitions (read/search/browse only)
 */
export function getAllTools(): ToolDefinition[] {
  return [
    ...statusHandlers,
    ...searchHandlers,
    ...observationHandlers,
    ...entityHandlers,
    ...ingestHandlers,
    ...workflowHandlers,
  ];
}
