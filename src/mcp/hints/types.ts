/**
 * Workflow Hint Types
 *
 * Suggested next actions returned with tool responses.
 * Inspired by Obsidian Semantic MCP's "suggested_next" pattern.
 */

export interface SuggestedAction {
  /** MCP tool name to call next */
  readonly tool: string;
  /** Why this action is suggested */
  readonly reason: string;
  /** Pre-filled parameters (optional) */
  readonly params?: Readonly<Record<string, unknown>>;
}

/** Format suggested actions as markdown appendix */
export function formatHints(hints: readonly SuggestedAction[]): string {
  if (hints.length === 0) return "";

  const lines = hints.map(
    (h) =>
      `- **${h.tool}** — ${h.reason}` +
      (h.params
        ? ` → \`${h.tool}(${Object.entries(h.params)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(", ")})\``
        : ""),
  );

  return `\n\n---\n**Suggested next:**\n${lines.join("\n")}`;
}
