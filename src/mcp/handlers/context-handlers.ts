/**
 * Context Tool Handlers
 *
 * Client-side tools for cross-project knowledge (#326) and
 * stable context retrieval (Phase 6.3).
 */

import type { ToolDefinition } from "../types";
import { callRemoteAPI, wrapError, wrapSuccess } from "../api-client";

// =============================================================================
// Cross-Project Knowledge (#326)
// =============================================================================

interface CrossProjectResponse {
  targetProject: string;
  suggestions: Array<{
    id: number;
    title: string;
    sourceProject: string;
    type: string;
    created_at: string;
    sharedConceptCount: number;
    sharedConcepts: string[];
  }>;
  projectOverlaps: Array<{
    project: string;
    sharedConceptCount: number;
    topSharedConcepts: string[];
    observationCount: number;
  }>;
  totalCandidates: number;
}

/** mem_cross_project tool definition */
export const memCrossProject: ToolDefinition = {
  name: "mem_cross_project",
  description:
    "Find relevant observations from other projects based on shared concepts. " +
    "Uses Memgraph graph traversal to identify concept overlap between projects. " +
    "Only returns your own observations across projects.",
  inputSchema: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description:
          "Target project name — finds observations from OTHER projects that share concepts with this one",
      },
      limit: {
        type: "number",
        description: "Maximum number of suggestions to return (default: 20)",
      },
      min_concepts: {
        type: "number",
        description:
          "Minimum shared concepts required to qualify as a suggestion (default: 2)",
      },
    },
    required: ["project"],
  },
  handler: async (args) => {
    const project = args.project as string;
    const limit = args.limit as number | undefined;
    const min_concepts = args.min_concepts as number | undefined;

    try {
      const params: Record<string, unknown> = { project };
      if (limit) params.limit = limit;
      if (min_concepts) params.min_concepts = min_concepts;

      const data = (await callRemoteAPI(
        "/context/cross-project",
        params,
      )) as CrossProjectResponse;

      if (!data.suggestions || data.suggestions.length === 0) {
        return wrapSuccess(
          `No cross-project knowledge found for project "${project}". ` +
            "This project may not share concepts with other projects, or the graph may need time to sync.",
        );
      }

      let output = `# Cross-Project Knowledge for "${project}"\n\n`;
      output += `Found ${data.suggestions.length} relevant observations from ${data.projectOverlaps.length} other project(s).\n\n`;

      if (data.projectOverlaps.length > 0) {
        output += "## Project Overlap\n\n";
        for (const overlap of data.projectOverlaps) {
          output += `- **${overlap.project}**: ${overlap.sharedConceptCount} shared concepts, ${overlap.observationCount} relevant observations\n`;
          output += `  Concepts: ${overlap.topSharedConcepts.join(", ")}\n`;
        }
        output += "\n";
      }

      output += "## Suggestions\n\n";
      for (const s of data.suggestions) {
        output += `### [${s.sourceProject}] ${s.title}\n`;
        output += `- **Type**: ${s.type} | **Shared concepts**: ${s.sharedConceptCount}\n`;
        output += `- **Concepts**: ${s.sharedConcepts.join(", ")}\n`;
        output += `- **ID**: ${s.id} | **Date**: ${s.created_at}\n\n`;
      }

      return wrapSuccess(output);
    } catch (error) {
      return wrapError(error);
    }
  },
};

// =============================================================================
// Stable Context (Phase 6.3)
// =============================================================================

interface StableContextResponse {
  context: string;
  entries: Array<Record<string, unknown>>;
  total_tokens: number;
  entry_count: number;
  user: string;
}

/** mem_stable_context tool definition */
export const memStableContext: ToolDefinition = {
  name: "mem_stable_context",
  description:
    "Get the stable observation log for a session or project. " +
    "Returns compressed, append-only context designed for prompt caching. " +
    "Use this to load previous session context efficiently.",
  inputSchema: {
    type: "object",
    properties: {
      sdk_session_id: {
        type: "string",
        description: "SDK session ID to retrieve context for",
      },
      project: {
        type: "string",
        description: "Project name to retrieve context for",
      },
    },
  },
  handler: async (args) => {
    const sdk_session_id = args.sdk_session_id as string | undefined;
    const project = args.project as string | undefined;

    if (!sdk_session_id && !project) {
      return wrapError(
        new Error("Either sdk_session_id or project is required"),
      );
    }

    try {
      const params: Record<string, unknown> = {};
      if (sdk_session_id) params.sdk_session_id = sdk_session_id;
      if (project) params.project = project;

      const data = (await callRemoteAPI(
        "/context/stable",
        params,
      )) as StableContextResponse;

      if (!data.context || data.entry_count === 0) {
        return wrapSuccess(
          "No stable context available for this session/project yet.",
        );
      }

      const header = `# Stable Context (${data.entry_count} entries, ~${data.total_tokens} tokens)\n\n`;
      return wrapSuccess(header + data.context);
    } catch (error) {
      return wrapError(error);
    }
  },
};

export const contextHandlers: ToolDefinition[] = [
  memCrossProject,
  memStableContext,
];
