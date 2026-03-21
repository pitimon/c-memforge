/**
 * Observation & Timeline Tool Hints
 *
 * Generate contextual suggestions after observation retrieval.
 */

import type { Observation, TimelineResponse } from "../types";
import type { SuggestedAction } from "./types";

/** Generate hints after timeline retrieval */
export function generateTimelineHints(
  data: TimelineResponse,
): readonly SuggestedAction[] {
  const hints: SuggestedAction[] = [];

  // Collect all obs IDs from timeline
  const allIds: number[] = [];
  if (data.anchor?.id) allIds.push(data.anchor.id);
  for (const o of data.before ?? []) allIds.push(o.id);
  for (const o of data.after ?? []) allIds.push(o.id);

  // Suggest batch fetch for full details
  if (allIds.length > 1) {
    hints.push({
      tool: "mem_get_observations",
      reason: `fetch full narratives for ${allIds.length} timeline items`,
      params: { ids: allIds.slice(0, 10) },
    });
  }

  // Suggest drift check if anchor is old
  if (data.anchor?.id && allIds.length > 1) {
    hints.push({
      tool: "mem_drift_check",
      reason: "check if any of these observations are outdated",
    });
  }

  return hints;
}

/** Generate hints after batch observation fetch */
export function generateObservationHints(
  observations: readonly Observation[],
): readonly SuggestedAction[] {
  if (!observations || observations.length === 0) return [];

  const hints: SuggestedAction[] = [];

  // Find the oldest observation — suggest verifying it
  const withDate = observations.filter((o) => o.created_at != null);
  const oldest = [...withDate].sort(
    (a, b) =>
      new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime(),
  )[0];

  if (oldest?.id) {
    hints.push({
      tool: "mem_contradict",
      reason: `verify if #${oldest.id} is still current (oldest in batch)`,
      params: { observation_id: oldest.id },
    });
  }

  // Suggest pinning if high-value observation found
  const highValue = observations.find(
    (o) => o.type === "decision" || o.type === "bugfix",
  );
  if (highValue?.id) {
    hints.push({
      tool: "mem_pin",
      reason: `pin #${highValue.id} (${highValue.type}) to protect from decay`,
      params: { observation_id: highValue.id },
    });
  }

  // Suggest entity lookup from concepts
  for (const o of observations.slice(0, 3)) {
    const concepts =
      typeof o.concepts === "string"
        ? o.concepts.split(",").map((c) => c.trim())
        : (o.concepts ?? []);
    if (concepts.length > 0) {
      hints.push({
        tool: "mem_entity_lookup",
        reason: `explore '${concepts[0]}' in knowledge graph`,
        params: { name: concepts[0] },
      });
      break;
    }
  }

  return hints;
}
