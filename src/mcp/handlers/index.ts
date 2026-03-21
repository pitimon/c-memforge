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
import { contextHandlers } from "./context-handlers";
import { teamHandlers } from "./team-handlers";
import { skillHandlers } from "./skill-handlers";
import { metadataHandlers } from "./metadata-handlers";

export {
  searchHandlers,
  observationHandlers,
  entityHandlers,
  statusHandlers,
  ingestHandlers,
  workflowHandlers,
  contextHandlers,
  teamHandlers,
  skillHandlers,
  metadataHandlers,
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
export { memCrossProject, memStableContext } from "./context-handlers";
export { memTeamKnowledge } from "./team-handlers";
export {
  memSkillSearch,
  memSkillGet,
  memSkillRelated,
  memSkillCreate,
  memSkillDiscover,
} from "./skill-handlers";
export { memTemporalQuery } from "./search-handlers";
export {
  memPin,
  memSetImportance,
  memSetEventDate,
  memContradict,
  memDriftCheck,
} from "./metadata-handlers";

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
    ...contextHandlers,
    ...teamHandlers,
    ...skillHandlers,
    ...metadataHandlers,
  ];
}
