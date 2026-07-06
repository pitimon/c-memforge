/**
 * MCP Session Handoff Handlers (memforge #74 — lifetime-memory Wave 2)
 *
 * mem_handoff / mem_resume tools for cross-session continuity:
 * write a structured handoff at the end of a session, resume it
 * (latest handoff + open loops + prior handoffs + retrospective) at the
 * start of the next one.
 */

import type { ToolDefinition } from "../types";
import { callRemoteAPI, postRemoteAPI, wrapError, wrapSuccess } from "../api-client";

/** Response shape from POST /api/v1/handoff */
interface HandoffCreateResponse {
  id: number;
  project?: string;
  created_at?: string;
}

/** A single handoff record as returned by GET /api/v1/resume */
interface HandoffRecord {
  id: number;
  project: string;
  next_steps?: string[];
  context?: string;
  open_loops?: string[];
  agent_id?: string;
  agent_type?: string;
  created_at?: string;
}

/**
 * A retrospective record as returned by GET /api/v1/resume — pinned to the
 * exact server shape (memforge `formatRetrospective` in
 * docker/scripts/api/routes/session.ts): {id, created_at, title, narrative}.
 */
interface RetrospectiveRecord {
  id?: number;
  title?: string;
  narrative?: string;
  created_at?: string;
}

/** Response shape from GET /api/v1/resume */
export interface ResumeResponse {
  latest_handoff: HandoffRecord | null;
  prior_handoffs: HandoffRecord[];
  latest_retrospective: RetrospectiveRecord | null;
  open_loops: string[];
  empty: boolean;
  guidance?: string;
}

/** Truncate long text for compact rendering, appending an ellipsis marker */
function excerpt(text: string, maxLen = 500): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

/** mem_handoff tool definition */
export const memHandoff: ToolDefinition = {
  name: "mem_handoff",
  description:
    "Write a session handoff (what's done, what's next, open loops) for cross-session continuity — lifetime-memory Wave 2",
  inputSchema: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project this handoff belongs to (required)",
      },
      next_steps: {
        type: "array",
        items: { type: "string" },
        description:
          "Concrete next steps for the next session to pick up (required, non-empty)",
      },
      context: {
        type: "string",
        description:
          "Optional narrative context — what was done and why, key decisions made",
      },
      open_loops: {
        type: "array",
        items: { type: "string" },
        description: "Optional unresolved questions or blockers to track",
      },
      agent_id: {
        type: "string",
        description: "Optional identifier of the agent writing this handoff",
      },
      agent_type: {
        type: "string",
        description:
          "Optional agent type/role (e.g. 'orchestrator', 'fast-worker')",
      },
    },
    required: ["project", "next_steps"],
  },
  handler: async (args) => {
    const project = args.project as string;
    const nextSteps = args.next_steps as string[];

    if (typeof project !== "string" || project.trim().length === 0) {
      return wrapError(
        new Error("project is required and must be a non-empty string."),
      );
    }
    if (!Array.isArray(nextSteps) || nextSteps.length === 0) {
      return wrapError(
        new Error(
          "next_steps is required and must be a non-empty array of strings.",
        ),
      );
    }

    try {
      const data = (await postRemoteAPI(
        "/api/v1/handoff",
        args,
      )) as HandoffCreateResponse;

      const openLoops = args.open_loops as string[] | undefined;
      return wrapSuccess(
        `Handoff #${data.id} recorded for project "${project}" — ` +
          `${nextSteps.length} next step(s)` +
          (openLoops && openLoops.length > 0
            ? `, ${openLoops.length} open loop(s)`
            : "") +
          ".",
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

/** Render the "## NEXT STEPS" section, or "" if there are none. */
function renderNextSteps(latest: HandoffRecord | null): string {
  if (!latest?.next_steps || latest.next_steps.length === 0) return "";
  let section = "## NEXT STEPS\n";
  latest.next_steps.forEach((step, i) => {
    section += `${i + 1}. ${step}\n`;
  });
  return `${section}\n`;
}

/** Render the "## OPEN LOOPS" section (top-level open_loops wins, else latest handoff's). */
function renderOpenLoops(data: ResumeResponse): string {
  const openLoops =
    data.open_loops && data.open_loops.length > 0
      ? data.open_loops
      : data.latest_handoff?.open_loops;
  if (!openLoops || openLoops.length === 0) return "";
  let section = "## OPEN LOOPS\n";
  for (const loop of openLoops) {
    section += `- ${loop}\n`;
  }
  return `${section}\n`;
}

/** Render the "## Context" section from the latest handoff's narrative. */
function renderContext(latest: HandoffRecord | null): string {
  if (!latest?.context) return "";
  return `## Context\n${excerpt(latest.context)}\n\n`;
}

/** Render the "## Prior Handoffs" summary line. */
function renderPriorHandoffs(priorHandoffs: HandoffRecord[]): string {
  const priorCount = priorHandoffs.length;
  if (priorCount === 0) return "";
  const dates = priorHandoffs
    .map((h) => h.created_at)
    .filter(Boolean)
    .join(", ");
  return (
    `## Prior Handoffs\n${priorCount} prior handoff(s)` +
    (dates ? ` (${dates})` : "") +
    "\n\n"
  );
}

/** Render the "## Latest Retrospective" section (title + narrative excerpt, <= 300 chars). */
function renderRetrospective(
  retrospective: RetrospectiveRecord | null,
): string {
  if (!retrospective || !retrospective.narrative) return "";
  const heading = retrospective.title
    ? `## Latest Retrospective: ${retrospective.title}\n`
    : "## Latest Retrospective\n";
  return `${heading}${excerpt(retrospective.narrative, 300)}\n`;
}

/** Render the empty-state message when no handoff history exists for a project. */
function formatEmptyResume(project: string, data: ResumeResponse): string {
  return (
    `No handoff history found for project "${project}".\n\n` +
    (data.guidance ||
      "Start a new handoff with mem_handoff when you have progress to record.")
  );
}

/**
 * Format the full /api/v1/resume response into rendered text — the client-side
 * twin of memforge's server-side `buildResumePayload` (docker/scripts/api/routes/session.ts).
 */
export function formatResume(project: string, data: ResumeResponse): string {
  if (data.empty) {
    return formatEmptyResume(project, data);
  }

  let output = `# Resume: ${project}\n\n`;
  output += renderNextSteps(data.latest_handoff);
  output += renderOpenLoops(data);
  output += renderContext(data.latest_handoff);
  output += renderPriorHandoffs(data.prior_handoffs || []);
  output += renderRetrospective(data.latest_retrospective);

  return output.trim();
}

/** mem_resume tool definition */
export const memResume: ToolDefinition = {
  name: "mem_resume",
  description:
    "Resume work: latest handoff + open loops + prior handoffs + latest retrospective for a project",
  inputSchema: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project to resume work on (required)",
      },
      limit: {
        type: "number",
        description: "Max prior handoffs to include (default: 3)",
      },
    },
    required: ["project"],
  },
  handler: async (args) => {
    const project = args.project as string;

    if (typeof project !== "string" || project.trim().length === 0) {
      return wrapError(
        new Error("project is required and must be a non-empty string."),
      );
    }

    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? args.limit
        : 3;

    try {
      const data = (await callRemoteAPI("/api/v1/resume", {
        project,
        limit,
      })) as ResumeResponse;

      return wrapSuccess(formatResume(project, data));
    } catch (error) {
      return wrapError(error);
    }
  },
};

export const sessionHandlers: ToolDefinition[] = [memHandoff, memResume];
