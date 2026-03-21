/**
 * MCP Skill Handlers (SkillNet #39)
 *
 * 5 tools for discovering, retrieving, and creating reusable skill patterns.
 */

import type { ToolDefinition } from "../types";
import {
  callRemoteAPI,
  postRemoteAPI,
  wrapError,
  wrapSuccess,
} from "../api-client";

interface SkillResponse {
  skills: Array<{
    id: number;
    title: string;
    narrative: string;
    metadata: {
      version: string;
      category: string;
      tags: string[];
      steps: string[];
      prerequisites?: string[];
      estimated_tokens?: number;
      source_type: string;
    };
    importance_score?: number;
    created_at: string;
  }>;
  total: number;
}

interface SingleSkillResponse {
  id: number;
  title: string;
  narrative: string;
  metadata: {
    version: string;
    category: string;
    tags: string[];
    steps: string[];
    prerequisites?: string[];
    estimated_tokens?: number;
    source_type: string;
    source_ids?: number[];
    input_schema?: object;
    output_schema?: object;
    evaluation?: {
      safety: number;
      completeness: number;
      executability: number;
      maintainability: number;
      cost_awareness: number;
      overall: number;
      method: string;
    };
  };
  project?: string;
  importance_score?: number;
  created_at: string;
  updated_at?: string;
}

/** Format a skill as markdown */
function formatSkill(s: SingleSkillResponse, index?: number): string {
  const prefix = index !== undefined ? `### ${index + 1}. ` : "## ";
  const meta = s.metadata;

  const steps = meta.steps
    .map((step: string, i: number) => `  ${i + 1}. ${step}`)
    .join("\n");

  let output =
    `${prefix}${s.title}\n` +
    `**Category:** ${meta.category} | **Version:** ${meta.version} | **Source:** ${meta.source_type}\n` +
    `**Tags:** ${meta.tags.join(", ") || "none"}\n`;

  if (meta.prerequisites && meta.prerequisites.length > 0) {
    output += `**Prerequisites:** ${meta.prerequisites.join(", ")}\n`;
  }
  if (meta.estimated_tokens) {
    output += `**Estimated tokens:** ~${meta.estimated_tokens}\n`;
  }

  const evaluation = meta.evaluation;
  if (evaluation) {
    output +=
      `**Quality:** ${evaluation.overall.toFixed(2)} [${evaluation.method}] ` +
      `(S:${evaluation.safety.toFixed(1)} C:${evaluation.completeness.toFixed(1)} ` +
      `E:${evaluation.executability.toFixed(1)} M:${evaluation.maintainability.toFixed(1)} ` +
      `$:${evaluation.cost_awareness.toFixed(1)})\n`;
  }

  output += `\n${s.narrative}\n\n**Steps:**\n${steps}`;
  return output;
}

/** mem_skill_search tool definition */
export const memSkillSearch: ToolDefinition = {
  name: "mem_skill_search",
  description:
    "Search for reusable skill patterns stored in MemForge. " +
    "Skills are structured, step-by-step procedures that can be discovered and reused across sessions. " +
    "Filter by query text, category, or tags.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query to match skill names or descriptions (empty for all)",
      },
      category: {
        type: "string",
        description:
          "Filter by skill category (e.g. debugging, deployment, testing)",
      },
      tags: {
        type: "string",
        description:
          "Comma-separated tags to filter by (e.g. docker,kubernetes)",
      },
      limit: {
        type: "number",
        description: "Max results (default: 10)",
      },
    },
  },
  handler: async (args) => {
    try {
      const params: Record<string, unknown> = {
        limit: args.limit ?? 10,
      };
      if (args.query) params.q = args.query;
      if (args.category) params.category = args.category;
      if (args.tags) params.tags = args.tags;

      const data = (await callRemoteAPI(
        "/api/skills",
        params,
      )) as SkillResponse;

      if (!data.skills || data.skills.length === 0) {
        return wrapSuccess(
          "No skills found. Skills are created manually or seeded from workflow patterns.",
        );
      }

      const formatted = data.skills
        .map((s, i) => formatSkill(s as unknown as SingleSkillResponse, i))
        .join("\n\n---\n\n");

      return wrapSuccess(
        `Found ${data.skills.length} skill(s) (${data.total} total):\n\n${formatted}`,
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** mem_skill_get tool definition */
export const memSkillGet: ToolDefinition = {
  name: "mem_skill_get",
  description:
    "Get a specific skill by ID with full details including steps, prerequisites, and schemas.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "Skill observation ID",
      },
    },
    required: ["id"],
  },
  handler: async (args) => {
    try {
      const data = (await callRemoteAPI(
        `/api/skills/${args.id}`,
        {},
      )) as SingleSkillResponse;

      if (!data || !data.id) {
        return wrapSuccess(`Skill #${args.id} not found.`);
      }

      return wrapSuccess(formatSkill(data));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404"))
        return wrapSuccess(`Skill #${args.id} not found.`);
      return wrapError(error);
    }
  },
};

/** mem_skill_related tool definition */
export const memSkillRelated: ToolDefinition = {
  name: "mem_skill_related",
  description:
    "Find skills related to a given skill via graph traversal. " +
    "Discovers similar skills, composition chains, and dependencies.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "Skill ID to find relations for",
      },
      depth: {
        type: "number",
        description: "Graph traversal depth (default: 2, max: 3)",
      },
      limit: {
        type: "number",
        description: "Max results (default: 10)",
      },
    },
    required: ["id"],
  },
  handler: async (args) => {
    try {
      const data = (await callRemoteAPI(`/api/skills/${args.id}/related`, {
        depth: args.depth ?? 2,
        limit: args.limit ?? 10,
      })) as {
        id: number;
        related: Array<{
          id: number;
          title: string;
          category: string;
          relation: string;
          score?: number;
          distance: number;
        }>;
      };

      if (!data.related || data.related.length === 0) {
        return wrapSuccess(
          `No related skills found for skill #${args.id}. ` +
            "Relations are discovered automatically via embedding similarity or added manually.",
        );
      }

      const formatted = data.related
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}** (ID: ${r.id})\n` +
            `   Relation: ${r.relation}${r.score ? ` (score: ${r.score})` : ""} | ` +
            `Category: ${r.category || "—"} | Distance: ${r.distance} hop(s)`,
        )
        .join("\n");

      return wrapSuccess(
        `Found ${data.related.length} related skill(s) for #${args.id}:\n\n${formatted}`,
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** mem_skill_create tool definition */
export const memSkillCreate: ToolDefinition = {
  name: "mem_skill_create",
  description:
    "Extract a reusable skill from conversation observations. " +
    "Takes a session ID or observation IDs and synthesizes them into a structured skill " +
    "with clear steps, tags, and evaluation scores.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "SDK session ID to extract skill from",
      },
      observation_ids: {
        type: "array",
        items: { type: "number" },
        description: "Specific observation IDs to extract skill from",
      },
      project: {
        type: "string",
        description: "Project context for the extracted skill",
      },
    },
  },
  handler: async (args) => {
    try {
      if (
        !args.session_id &&
        (!args.observation_ids ||
          (args.observation_ids as number[]).length === 0)
      ) {
        return wrapSuccess("Either session_id or observation_ids is required.");
      }

      const body: Record<string, unknown> = {};
      if (args.session_id) body.session_id = args.session_id;
      if (args.observation_ids) body.observation_ids = args.observation_ids;
      if (args.project) body.project = args.project;

      const data = (await postRemoteAPI("/api/skills/extract", body)) as {
        skill_id: number;
        title: string;
        steps_count: number;
        source_count: number;
      };

      return wrapSuccess(
        `Skill extracted successfully!\n\n` +
          `**ID:** ${data.skill_id}\n` +
          `**Title:** ${data.title}\n` +
          `**Steps:** ${data.steps_count}\n` +
          `**Sources:** ${data.source_count} observations\n\n` +
          `Use \`mem_skill_get(id: ${data.skill_id})\` to see full details.`,
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** mem_skill_discover tool definition */
export const memSkillDiscover: ToolDefinition = {
  name: "mem_skill_discover",
  description:
    "Discover skills shared by other users in the skill catalog. " +
    "Browse publicly listed skills with ratings, fork counts, and categories.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query for skill title or category",
      },
      category: {
        type: "string",
        description: "Filter by category",
      },
      limit: {
        type: "number",
        description: "Max results (default: 10)",
      },
    },
  },
  handler: async (args) => {
    try {
      const params: Record<string, unknown> = {
        limit: args.limit ?? 10,
      };
      if (args.query) params.q = args.query;
      if (args.category) params.category = args.category;

      const data = (await callRemoteAPI("/api/skills/catalog", params)) as {
        skills: Array<{
          skill_observation_id: number;
          owner_schema: string;
          title: string;
          category: string;
          tags: string[];
          avg_rating: number;
          rating_count: number;
          fork_count: number;
        }>;
        total: number;
      };

      if (!data.skills || data.skills.length === 0) {
        return wrapSuccess(
          "No skills found in the catalog. Skills are listed by their owners for discovery.",
        );
      }

      const formatted = data.skills
        .map(
          (s, i) =>
            `${i + 1}. **${s.title || "Untitled"}** (ID: ${s.skill_observation_id})\n` +
            `   Category: ${s.category || "—"} | ` +
            `Rating: ${s.avg_rating != null ? s.avg_rating.toFixed(1) : "—"}/5 (${s.rating_count ?? 0}) | ` +
            `Forks: ${s.fork_count ?? 0} | ` +
            `Owner: ${s.owner_schema}\n` +
            `   Tags: ${s.tags?.join(", ") || "none"}`,
        )
        .join("\n\n");

      return wrapSuccess(
        `Found ${data.skills.length} skill(s) in catalog (${data.total} total):\n\n${formatted}`,
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

export const skillHandlers: ToolDefinition[] = [
  memSkillSearch,
  memSkillGet,
  memSkillRelated,
  memSkillCreate,
  memSkillDiscover,
];
