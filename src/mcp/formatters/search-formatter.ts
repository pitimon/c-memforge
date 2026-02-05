/**
 * Search Result Formatters
 *
 * Format search results as markdown for MCP tool responses.
 */

import type { SearchResponse } from '../types';

/**
 * Format FTS search results as markdown.
 *
 * @param data - Search API response
 * @returns Formatted markdown string
 */
export function formatSearchResults(data: SearchResponse): string {
  const { query, expanded_query, candidates_count, results_count, duration_ms, results } = data;

  let output = `## Search Results\n\n`;
  output += `**Query:** ${query}\n`;
  if (expanded_query) output += `**Expanded:** ${expanded_query}\n`;
  output += `**Found:** ${results?.length || results_count || 0} results`;
  if (candidates_count) output += ` from ${candidates_count} candidates`;
  output += ` (${Math.round(duration_ms || 0)}ms)\n\n`;

  if (!results || results.length === 0) {
    output += `_No results found_\n`;
    return output;
  }

  output += `| ID | Score | Type | Title |\n`;
  output += `|----|-------|------|-------|\n`;

  for (const r of results) {
    const title = (r.title || '').length > 55 ? r.title!.slice(0, 52) + '...' : (r.title || '');
    output += `| ${r.id} | ${r.score || '-'} | ${r.type || '-'} | ${title} |\n`;
  }

  output += formatTopResultDetails(results[0]);

  return output;
}

/**
 * Format hybrid search results as markdown.
 *
 * @param data - Hybrid search API response
 * @returns Formatted markdown string
 */
export function formatHybridResults(data: SearchResponse): string {
  const { query, method, vector_weight, fts_weight, results_count, duration_ms, results } = data;

  let output = `## Hybrid Search Results\n\n`;
  output += `**Query:** ${query}\n`;
  if (method) output += `**Method:** ${method}`;
  if (vector_weight !== undefined) {
    output += ` (vector: ${(vector_weight * 100).toFixed(0)}%, FTS: ${((fts_weight || 1 - vector_weight) * 100).toFixed(0)}%)`;
  }
  output += `\n`;
  output += `**Found:** ${results?.length || results_count || 0} results (${Math.round(duration_ms || 0)}ms)\n\n`;

  if (!results || results.length === 0) {
    output += `_No results found_\n`;
    return output;
  }

  output += `| ID | Score | Vec | FTS | Type | Title |\n`;
  output += `|----|-------|-----|-----|------|-------|\n`;

  for (const r of results) {
    const title = (r.title || '').length > 45 ? r.title!.slice(0, 42) + '...' : (r.title || '');
    const vecMark = (r.vector_score || 0) > 0 ? '✓' : '-';
    const ftsMark = (r.fts_score || 0) > 0 ? '✓' : '-';
    const score = r.combined_score || r.score || '-';
    output += `| ${r.id} | ${typeof score === 'number' ? score.toFixed(3) : score} | ${vecMark} | ${ftsMark} | ${r.type || '-'} | ${title} |\n`;
  }

  output += formatTopResultDetails(results[0], true);

  return output;
}

/**
 * Format vector search results as markdown.
 *
 * @param data - Vector search API response
 * @returns Formatted markdown string
 */
export function formatVectorResults(data: SearchResponse): string {
  const { query, method, results_count, duration_ms, results, embeddings_count } = data;

  let output = `## Vector Search Results\n\n`;
  output += `**Query:** ${query}\n`;
  if (method) output += `**Method:** ${method} (embedding similarity)\n`;
  output += `**Found:** ${results?.length || results_count || 0} results`;
  if (embeddings_count) output += ` from ${embeddings_count} embeddings`;
  output += ` (${Math.round(duration_ms || 0)}ms)\n\n`;

  if (!results || results.length === 0) {
    output += `_No results found_\n`;
    return output;
  }

  output += `| ID | Score | Type | Title |\n`;
  output += `|----|-------|------|-------|\n`;

  for (const r of results) {
    const title = (r.title || '').length > 50 ? r.title!.slice(0, 47) + '...' : (r.title || '');
    const score = r.vector_score || r.score || '-';
    output += `| ${r.id} | ${typeof score === 'number' ? score.toFixed(3) : score} | ${r.type || '-'} | ${title} |\n`;
  }

  output += formatTopResultDetails(results[0], false, true);

  return output;
}

/**
 * Format top result details section.
 *
 * @param top - Top search result
 * @param usesCombinedScore - Whether to use combined_score
 * @param usesVectorScore - Whether to use vector_score
 * @returns Formatted markdown string
 */
function formatTopResultDetails(
  top: SearchResponse['results'] extends (infer T)[] | undefined ? NonNullable<T> : never,
  usesCombinedScore = false,
  usesVectorScore = false
): string {
  let output = `\n### Top Result Details\n\n`;

  let topScore: string | number = top.score || '-';
  if (usesCombinedScore && top.combined_score !== undefined) {
    topScore = top.combined_score;
  }
  if (usesVectorScore && top.vector_score !== undefined) {
    topScore = top.vector_score;
  }

  output += `**#${top.id}** (score: ${typeof topScore === 'number' ? topScore.toFixed(3) : topScore})\n\n`;
  output += `**${top.title}**\n\n`;
  if (top.subtitle) output += `_${top.subtitle}_\n\n`;
  if (top.narrative) {
    output += `${top.narrative.slice(0, 500)}${top.narrative.length > 500 ? '...' : ''}\n`;
  }

  return output;
}
