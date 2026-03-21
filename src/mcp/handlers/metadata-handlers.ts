/**
 * MCP Metadata Handlers (#42)
 *
 * 5 tools for observation metadata management:
 * pin, set_importance, set_event_date, contradict, drift_check.
 */

import type { ToolDefinition } from "../types";
import {
  callRemoteAPI,
  patchRemoteAPI,
  postRemoteAPI,
  wrapError,
  wrapSuccess,
} from "../api-client";

interface ObservationUpdate {
  id: number;
  title: string;
  pinned?: number;
  importance_override?: number | null;
  importance_score?: number;
  event_date?: string | null;
}

interface ContradictResponse {
  original_id: number;
  original_marked_stale: boolean;
  new_observation_id: number;
  message: string;
}

interface DriftCheckResponse {
  observations: Array<{
    id: number;
    title: string;
    type: string;
    project: string;
    importance_score: number;
    created_at: string;
  }>;
  count: number;
}

/** mem_pin tool definition */
export const memPin: ToolDefinition = {
  name: "mem_pin",
  description:
    "Pin or unpin an observation — pinned observations are protected from decay and archival. " +
    "Use AFTER finding important observations via mem_semantic_search. " +
    "Pinned observations always appear in stable context.",
  inputSchema: {
    type: "object",
    properties: {
      observation_id: {
        type: "number",
        description: "Observation ID to pin/unpin (required)",
      },
      pinned: {
        type: "boolean",
        description: "True to pin (default), false to unpin",
      },
    },
    required: ["observation_id"],
  },
  handler: async (args) => {
    try {
      const id = Number(args.observation_id);
      if (!Number.isInteger(id) || id < 1) {
        return wrapError(new Error("Invalid observation_id."));
      }
      const pinned = args.pinned !== false;

      await patchRemoteAPI(`/api/observations/${id}`, { pinned });

      return wrapSuccess(
        pinned
          ? `Observation #${id} pinned — protected from decay and archival.`
          : `Observation #${id} unpinned — will follow normal decay rules.`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404"))
        return wrapSuccess(`Observation #${args.observation_id} not found.`);
      return wrapError(error);
    }
  },
};

/** mem_set_importance tool definition */
export const memSetImportance: ToolDefinition = {
  name: "mem_set_importance",
  description:
    "Override the calculated importance score for an observation (0.0-1.0). " +
    "Use when automatic scoring undervalues a critical observation. " +
    "Pass null to clear the override and restore calculated score. " +
    "Use mem_drift_check to find observations that may need importance adjustment.",
  inputSchema: {
    type: "object",
    properties: {
      observation_id: {
        type: "number",
        description: "Observation ID (required)",
      },
      score: {
        type: "number",
        description:
          "Importance score 0.0-1.0 (null to clear override). Higher = more important.",
      },
    },
    required: ["observation_id"],
  },
  handler: async (args) => {
    try {
      const id = Number(args.observation_id);
      if (!Number.isInteger(id) || id < 1) {
        return wrapError(new Error("Invalid observation_id."));
      }
      const score =
        typeof args.score === "number" && !isNaN(args.score)
          ? args.score
          : null;

      await patchRemoteAPI(`/api/observations/${id}`, {
        importance_override: score,
      });

      if (score == null) {
        return wrapSuccess(
          `Importance override cleared for observation #${id}. Calculated score will be used.`,
        );
      }

      return wrapSuccess(
        `Importance for observation #${id} set to ${score.toFixed(2)}.`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404"))
        return wrapSuccess(`Observation #${args.observation_id} not found.`);
      return wrapError(error);
    }
  },
};

/** mem_set_event_date tool definition */
export const memSetEventDate: ToolDefinition = {
  name: "mem_set_event_date",
  description:
    "Set a temporal event date on an observation for time-based queries. " +
    "Use when an observation refers to a specific date (e.g. deployment, incident, meeting). " +
    "Pass null to clear. Use mem_temporal_query AFTER to verify date-based retrieval.",
  inputSchema: {
    type: "object",
    properties: {
      observation_id: {
        type: "number",
        description: "Observation ID (required)",
      },
      event_date: {
        type: "string",
        description:
          "ISO 8601 date/datetime (e.g. '2026-03-01' or '2026-03-01T14:30:00Z'), or null to clear",
      },
    },
    required: ["observation_id"],
  },
  handler: async (args) => {
    try {
      const id = Number(args.observation_id);
      if (!Number.isInteger(id) || id < 1) {
        return wrapError(new Error("Invalid observation_id."));
      }
      const eventDate = (args.event_date as string | null) ?? null;

      await patchRemoteAPI(`/api/observations/${id}`, {
        event_date: eventDate,
      });

      if (eventDate == null) {
        return wrapSuccess(`Event date cleared for observation #${id}.`);
      }

      return wrapSuccess(
        `Event date for observation #${id} set to ${eventDate}.`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404"))
        return wrapSuccess(`Observation #${args.observation_id} not found.`);
      if (msg.includes("ISO 8601") || msg.includes("event_date"))
        return wrapSuccess(
          `Invalid date format: use ISO 8601 (e.g. '2026-03-01' or '2026-03-01T14:30:00Z').`,
        );
      return wrapError(error);
    }
  },
};

/** mem_contradict tool definition */
export const memContradict: ToolDefinition = {
  name: "mem_contradict",
  description:
    "Mark an observation as stale and create a correction. " +
    "Use when you find outdated or incorrect information in memory. " +
    "The original is marked stale; a new correction observation is created. " +
    "Use mem_drift_check FIRST to find candidates for contradiction.",
  inputSchema: {
    type: "object",
    properties: {
      observation_id: {
        type: "number",
        description: "ID of the observation to mark as stale (required)",
      },
      correction: {
        type: "string",
        description: "The corrected information (required)",
      },
      title: {
        type: "string",
        description:
          "Title for the correction (default: 'Correction: supersedes #ID')",
      },
    },
    required: ["observation_id", "correction"],
  },
  handler: async (args) => {
    try {
      const id = Number(args.observation_id);
      if (!Number.isInteger(id) || id < 1) {
        return wrapError(new Error("Invalid observation_id."));
      }
      const correction = args.correction as string;

      const body: Record<string, unknown> = { correction };
      if (args.title) body.title = args.title;

      const data = (await postRemoteAPI(
        `/api/observations/${id}/contradict`,
        body,
      )) as ContradictResponse;

      return wrapSuccess(
        `Observation #${data.original_id} marked stale.\n` +
          `Correction created as observation #${data.new_observation_id}.\n\n` +
          `Use \`mem_semantic_get(id: ${data.new_observation_id})\` to verify the correction.`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404"))
        return wrapSuccess(`Observation #${args.observation_id} not found.`);
      return wrapError(error);
    }
  },
};

/** mem_drift_check tool definition */
export const memDriftCheck: ToolDefinition = {
  name: "mem_drift_check",
  description:
    "Find the oldest unverified observations that may be outdated. " +
    "Use periodically to maintain memory quality. " +
    "Follow up with mem_contradict for stale observations, " +
    "or mem_pin / mem_set_importance for still-relevant ones.",
  inputSchema: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Filter by project name (optional)",
      },
      limit: {
        type: "number",
        description: "Max results (default: 20, max: 100)",
      },
    },
  },
  handler: async (args) => {
    try {
      const params: Record<string, unknown> = {
        limit: args.limit ?? 20,
      };
      if (args.project) params.project = args.project;

      const data = (await callRemoteAPI(
        "/api/observations/drift-check",
        params,
      )) as DriftCheckResponse;

      if (!data.observations || data.observations.length === 0) {
        return wrapSuccess(
          "No unverified observations found — memory is up to date.",
        );
      }

      const formatted = data.observations
        .map(
          (o, i) =>
            `${i + 1}. **#${o.id}** ${o.title}\n` +
            `   Type: ${o.type} | Project: ${o.project || "—"} | ` +
            `Importance: ${o.importance_score?.toFixed(2) ?? "—"} | ` +
            `Created: ${o.created_at.split("T")[0]}`,
        )
        .join("\n");

      return wrapSuccess(
        `Found ${data.count} unverified observation(s):\n\n${formatted}\n\n` +
          "Review each and use `mem_contradict` for stale ones, " +
          "`mem_pin` for important ones, or `mem_set_importance` to adjust scoring.",
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

export const metadataHandlers: ToolDefinition[] = [
  memPin,
  memSetImportance,
  memSetEventDate,
  memContradict,
  memDriftCheck,
];
