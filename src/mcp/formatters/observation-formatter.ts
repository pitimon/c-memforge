/**
 * Observation Result Formatters
 *
 * Format observation data as markdown for MCP tool responses.
 */

import type { Observation, TimelineResponse, EntityLookupResponse, TripletsQueryResponse } from '../types';

/**
 * Format observations as markdown.
 *
 * @param observations - Array of observations
 * @returns Formatted markdown string
 */
export function formatObservations(observations: Observation[]): string {
  let output = `## Observations (${observations.length})\n\n`;

  for (const obs of observations) {
    output += `---\n\n`;
    output += `### #${obs.id} - ${obs.title || 'Untitled'}\n\n`;
    output += `**Type:** ${obs.type || '-'} | **Project:** ${obs.project || '-'}\n`;
    if (obs.created_at) output += `**Created:** ${obs.created_at}\n`;
    output += '\n';

    if (obs.subtitle) output += `_${obs.subtitle}_\n\n`;
    if (obs.narrative) output += `${obs.narrative}\n\n`;

    if (obs.concepts) {
      const concepts = typeof obs.concepts === 'string' ? JSON.parse(obs.concepts) : obs.concepts;
      if (Array.isArray(concepts) && concepts.length > 0) {
        output += `**Concepts:** ${concepts.join(', ')}\n`;
      }
    }
  }

  return output;
}

/**
 * Format timeline context as markdown.
 *
 * @param data - Timeline API response
 * @param requestedAnchor - Anchor ID from request
 * @returns Formatted markdown string
 */
export function formatTimeline(data: TimelineResponse, requestedAnchor?: number): string {
  let output = `## Timeline Context\n\n`;
  output += `**Anchor:** #${data.anchor?.id || requestedAnchor}\n\n`;

  if (data.before && data.before.length > 0) {
    output += `### Before (${data.before.length})\n`;
    output += `| ID | Type | Title |\n`;
    output += `|----|------|-------|\n`;
    for (const obs of data.before) {
      const title = (obs.title || '').length > 50 ? obs.title!.slice(0, 47) + '...' : (obs.title || '');
      output += `| ${obs.id} | ${obs.type || '-'} | ${title} |\n`;
    }
    output += '\n';
  }

  if (data.anchor) {
    output += `### Anchor\n`;
    output += `**#${data.anchor.id}** - ${data.anchor.title}\n\n`;
    if (data.anchor.narrative) {
      output += `${data.anchor.narrative.slice(0, 500)}${data.anchor.narrative.length > 500 ? '...' : ''}\n\n`;
    }
  }

  if (data.after && data.after.length > 0) {
    output += `### After (${data.after.length})\n`;
    output += `| ID | Type | Title |\n`;
    output += `|----|------|-------|\n`;
    for (const obs of data.after) {
      const title = (obs.title || '').length > 50 ? obs.title!.slice(0, 47) + '...' : (obs.title || '');
      output += `| ${obs.id} | ${obs.type || '-'} | ${title} |\n`;
    }
  }

  return output;
}

/**
 * Format entity lookup results as markdown.
 *
 * @param data - Entity lookup API response
 * @param entityName - Name of the looked up entity
 * @returns Formatted markdown string
 */
export function formatEntityLookup(data: EntityLookupResponse, entityName: string): string {
  const allTriplets = [...(data.as_subject || []), ...(data.as_object || [])];
  const observations = data.related_observations || [];

  let output = `## Entity Lookup: "${entityName}"\n\n`;
  output += `**Found:** ${data.total_triplets || allTriplets.length} triplets, ${observations.length} related observations\n\n`;

  if (data.as_subject && data.as_subject.length > 0) {
    output += `### As Subject (${data.as_subject.length})\n`;
    output += formatTripletsTable(data.as_subject.slice(0, 10));
    if (data.as_subject.length > 10) {
      output += `\n_...and ${data.as_subject.length - 10} more_\n`;
    }
    output += '\n';
  }

  if (data.as_object && data.as_object.length > 0) {
    output += `### As Object (${data.as_object.length})\n`;
    output += formatTripletsTable(data.as_object.slice(0, 10));
    if (data.as_object.length > 10) {
      output += `\n_...and ${data.as_object.length - 10} more_\n`;
    }
    output += '\n';
  }

  if (observations.length > 0) {
    output += `### Related Observations\n`;
    output += `| ID | Type | Title |\n`;
    output += `|----|------|-------|\n`;
    for (const obs of observations.slice(0, 10)) {
      const title = (obs.title || '').length > 50 ? obs.title!.slice(0, 47) + '...' : (obs.title || '');
      output += `| ${obs.id} | ${obs.type || '-'} | ${title} |\n`;
    }
    if (observations.length > 10) {
      output += `\n_...and ${observations.length - 10} more observations_\n`;
    }
  }

  return output;
}

/**
 * Format triplets query results as markdown.
 *
 * @param data - Triplets query API response
 * @param filters - Applied filters
 * @returns Formatted markdown string
 */
export function formatTripletsQuery(
  data: TripletsQueryResponse,
  filters: { subject?: string; predicate?: string; object?: string }
): string {
  let output = `## Triplets Query\n\n`;
  output += `**Filters:** `;
  const filterParts: string[] = [];
  if (filters.subject) filterParts.push(`subject="${filters.subject}"`);
  if (filters.predicate) filterParts.push(`predicate="${filters.predicate}"`);
  if (filters.object) filterParts.push(`object="${filters.object}"`);
  output += filterParts.length > 0 ? filterParts.join(', ') : 'none';
  output += `\n`;
  output += `**Found:** ${data.triplets?.length || 0} triplets\n\n`;

  if (data.triplets && data.triplets.length > 0) {
    output += `| Subject | Predicate | Object | Obs ID | Confidence |\n`;
    output += `|---------|-----------|--------|--------|------------|\n`;
    for (const t of data.triplets) {
      const subj = (t.subject || '').length > 20 ? t.subject!.slice(0, 17) + '...' : (t.subject || '');
      const obj = (t.object || '').length > 20 ? t.object!.slice(0, 17) + '...' : (t.object || '');
      output += `| ${subj} | ${t.predicate} | ${obj} | ${t.observation_id || '-'} | ${t.confidence?.toFixed(2) || '-'} |\n`;
    }
  } else {
    output += `_No triplets found matching filters_\n`;
  }

  return output;
}

/**
 * Format a triplets table.
 *
 * @param triplets - Array of triplets
 * @returns Formatted markdown table
 */
function formatTripletsTable(triplets: EntityLookupResponse['as_subject']): string {
  if (!triplets || triplets.length === 0) return '';

  let output = `| Subject | Predicate | Object | Confidence |\n`;
  output += `|---------|-----------|--------|------------|\n`;

  for (const t of triplets) {
    const subj = (t.subject || '').length > 25 ? t.subject!.slice(0, 22) + '...' : (t.subject || '');
    const obj = (t.object || '').length > 25 ? t.object!.slice(0, 22) + '...' : (t.object || '');
    output += `| ${subj} | ${t.predicate} | ${obj} | ${t.confidence?.toFixed(2) || '-'} |\n`;
  }

  return output;
}
