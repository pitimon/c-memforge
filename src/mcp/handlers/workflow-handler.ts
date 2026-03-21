/**
 * MCP Workflow Handler (v0.22 #179)
 *
 * mem_workflow_suggest tool for discovering recurring workflow patterns.
 */

import type { ToolDefinition } from "../types";
import { callRemoteAPI, wrapError, wrapSuccess } from "../api-client";

/** mem_workflow_suggest tool definition */
export const memWorkflowSuggest: ToolDefinition = {
  name: "mem_workflow_suggest",
  description:
    "Discover recurring workflow patterns from your observation history. " +
    "Returns step-by-step templates with success rates. " +
    "Use when starting a new task to check if a proven workflow exists. " +
    "Use mem_skill_search instead for curated, structured skill patterns.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query to match workflow names or trigger patterns (empty for all)",
      },
      limit: {
        type: "number",
        description: "Max results (default: 5)",
      },
    },
  },
  handler: async (args) => {
    try {
      const data = (await callRemoteAPI("/api/workflows", {
        q: args.query || "",
        limit: args.limit || 5,
      })) as {
        workflows: Array<{
          name: string;
          trigger_pattern: string;
          steps: string[];
          success_rate: number;
          invocation_count: number;
        }>;
      };

      if (!data.workflows || data.workflows.length === 0) {
        return wrapSuccess(
          "No workflow templates found. Workflows are automatically induced from observation patterns over time.",
        );
      }

      const formatted = data.workflows
        .map((w, i) => {
          const steps = w.steps
            .map((s: string, j: number) => `  ${j + 1}. ${s}`)
            .join("\n");
          return (
            `### ${i + 1}. ${w.name}\n` +
            `**Trigger:** ${w.trigger_pattern} | **Success:** ${Math.round(w.success_rate * 100)}% | **Used:** ${w.invocation_count}x\n` +
            `**Steps:**\n${steps}`
          );
        })
        .join("\n\n");

      return wrapSuccess(
        `Found ${data.workflows.length} workflow template(s):\n\n${formatted}`,
      );
    } catch (error) {
      return wrapError(error);
    }
  },
};

export const workflowHandlers: ToolDefinition[] = [memWorkflowSuggest];
