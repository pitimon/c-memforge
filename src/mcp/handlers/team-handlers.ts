/**
 * Team Knowledge Tool Handler (#327)
 *
 * Client-side tool for accessing team knowledge pool — shared
 * observations from team members across projects.
 */

import type { ToolDefinition } from "../types";
import { callRemoteAPI, wrapError, wrapSuccess } from "../api-client";

interface TeamKnowledgeResponse {
  team_id: number;
  observations: Array<{
    id: number;
    title: string | null;
    narrative: string | null;
    type: string | null;
    project: string | null;
    created_at: string | null;
    owner_user: string;
    owner_schema: string;
    permission: string;
  }>;
  total: number;
  query: string | null;
}

/** mem_team_knowledge tool definition */
export const memTeamKnowledge: ToolDefinition = {
  name: "mem_team_knowledge",
  description:
    "Search the team knowledge pool — observations shared by team members. " +
    "Use this to find what other agents/users on the same team have learned. " +
    "Requires team membership.",
  inputSchema: {
    type: "object",
    properties: {
      team_id: {
        type: "number",
        description: "Team ID to search knowledge pool for",
      },
      query: {
        type: "string",
        description:
          "Optional text query to filter team knowledge (searches title + narrative)",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (default: 20)",
      },
    },
    required: ["team_id"],
  },
  handler: async (args) => {
    const teamId = args.team_id as number;
    const query = args.query as string | undefined;
    const limit = args.limit as number | undefined;

    try {
      const params: Record<string, unknown> = {};
      if (query) params.q = query;
      if (limit) params.limit = limit;

      const data = (await callRemoteAPI(
        `/api/teams/${teamId}/knowledge`,
        params,
      )) as TeamKnowledgeResponse;

      if (!data.observations || data.observations.length === 0) {
        const msg = query
          ? `No team knowledge found matching "${query}" in team ${teamId}.`
          : `No shared knowledge in team ${teamId} yet. Share observations using the share-team endpoint.`;
        return wrapSuccess(msg);
      }

      let output = `# Team Knowledge Pool (Team ${teamId})\n\n`;
      output += `Found ${data.observations.length} shared observations`;
      if (data.query) output += ` matching "${data.query}"`;
      output += ".\n\n";

      for (const obs of data.observations) {
        output += `### ${obs.title || "Untitled"}\n`;
        output += `- **From**: ${obs.owner_user} | **Type**: ${obs.type || "unknown"} | **Project**: ${obs.project || "—"}\n`;
        output += `- **ID**: ${obs.id} | **Date**: ${obs.created_at || "—"}\n`;
        if (obs.narrative) {
          const preview =
            obs.narrative.length > 200
              ? obs.narrative.slice(0, 200) + "..."
              : obs.narrative;
          output += `- ${preview}\n`;
        }
        output += "\n";
      }

      return wrapSuccess(output);
    } catch (error) {
      return wrapError(error);
    }
  },
};

export const teamHandlers: ToolDefinition[] = [memTeamKnowledge];
