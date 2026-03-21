/**
 * Search Tool Hints
 *
 * Generate contextual suggestions after search results.
 */

import type { SearchResult } from "../types";
import type { SuggestedAction } from "./types";

/** Extract entity-like terms from search results */
function extractEntities(results: readonly SearchResult[]): string[] {
  const entities = new Set<string>();
  for (const r of results.slice(0, 3)) {
    const text = `${r.title ?? ""} ${r.narrative ?? ""}`;
    // Extract capitalized terms, file paths, tech names
    const matches = text.match(
      /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b|[a-z-]+\.[a-z]{2,4}\b|\b(?:PostgreSQL|Redis|Docker|Kubernetes|Memgraph|Caddy|Nginx)\b/gi,
    );
    if (matches) {
      for (const m of matches.slice(0, 3)) entities.add(m);
    }
  }
  return [...entities].slice(0, 2);
}

/** Generate hints after any search operation */
export function generateSearchHints(
  results: readonly SearchResult[],
): readonly SuggestedAction[] {
  if (!results || results.length === 0) return [];

  const hints: SuggestedAction[] = [];
  const top = results[0];

  // Always suggest timeline for top result
  if (top.id) {
    hints.push({
      tool: "mem_timeline",
      reason: `see temporal context around #${top.id}`,
      params: { anchor: top.id },
    });
  }

  // If multiple results, suggest batch fetch
  if (results.length > 1) {
    const ids = results
      .slice(0, 5)
      .map((r) => r.id)
      .filter((id): id is number => id != null);
    hints.push({
      tool: "mem_get_observations",
      reason: `fetch full details of top ${ids.length} results`,
      params: { ids },
    });
  }

  // If entities detected, suggest entity lookup
  const entities = extractEntities(results);
  if (entities.length > 0) {
    hints.push({
      tool: "mem_entity_lookup",
      reason: `explore '${entities[0]}' in knowledge graph`,
      params: { name: entities[0] },
    });
  }

  return hints;
}
