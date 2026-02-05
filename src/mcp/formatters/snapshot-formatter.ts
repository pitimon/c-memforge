/**
 * Snapshot Result Formatters
 *
 * Format snapshot data as markdown for MCP tool responses.
 */

import type { SnapshotCreateResponse, SnapshotListResponse, SnapshotRestoreResponse } from '../types';

/**
 * Format snapshot creation response as markdown.
 *
 * @param data - Snapshot creation API response
 * @returns Formatted markdown string
 */
export function formatSnapshotCreate(data: SnapshotCreateResponse): string {
  let output = `## Snapshot Created Successfully\n\n`;
  output += `**Name:** ${data.snapshot_name}\n`;
  output += `**ID:** ${data.id}\n`;
  if (data.description) output += `**Description:** ${data.description}\n`;
  output += `**Created:** ${data.created_at}\n\n`;

  output += `### Contents\n`;
  output += `- **Observations:** ${data.observation_count?.toLocaleString()}\n`;
  output += `- **Embeddings:** ${data.embedding_count?.toLocaleString()}\n`;
  output += `- **Sessions:** ${data.session_count?.toLocaleString()}\n`;
  output += `- **Triplets:** ${data.triplet_count?.toLocaleString()}\n\n`;

  output += `### Storage\n`;
  output += `- **Original size:** ${((data.file_size_bytes || 0) / 1024 / 1024).toFixed(2)} MB\n`;
  output += `- **Compressed:** ${((data.compressed_size_bytes || 0) / 1024 / 1024).toFixed(2)} MB\n`;
  output += `- **Compression ratio:** ${data.compression_ratio}x\n`;

  return output;
}

/**
 * Format snapshot list response as markdown.
 *
 * @param data - Snapshot list API response
 * @returns Formatted markdown string
 */
export function formatSnapshotList(data: SnapshotListResponse): string {
  let output = `## Memory Snapshots\n\n`;
  output += `**Total:** ${data.total} snapshots\n\n`;

  if (data.snapshots && data.snapshots.length > 0) {
    output += `| ID | Name | Obs | Emb | Sessions | Size | Status | Created |\n`;
    output += `|----|------|-----|-----|----------|------|--------|--------|\n`;

    for (const s of data.snapshots) {
      const name = (s.snapshot_name || '').length > 20
        ? s.snapshot_name!.slice(0, 17) + '...'
        : (s.snapshot_name || '');
      const sizeMB = ((s.compressed_size_bytes || 0) / 1024 / 1024).toFixed(1);
      const created = s.created_at?.split('T')[0] || '-';
      output += `| ${s.id} | ${name} | ${s.observation_count || 0} | ${s.embedding_count || 0} | ${s.session_count || 0} | ${sizeMB}MB | ${s.status} | ${created} |\n`;
    }
    output += '\n';

    // Show restoration stats if any
    const restoredSnapshots = data.snapshots.filter(s => (s.restoration_count || 0) > 0);
    if (restoredSnapshots.length > 0) {
      output += `### Restoration History\n`;
      for (const s of restoredSnapshots) {
        output += `- **${s.snapshot_name}**: restored ${s.restoration_count}x (last: ${s.last_restored_at?.split('T')[0] || 'unknown'})\n`;
      }
    }
  } else {
    output += `_No snapshots found. Create one with mem_snapshot_create._\n`;
  }

  return output;
}

/**
 * Format snapshot restore response as markdown.
 *
 * @param data - Snapshot restore API response
 * @returns Formatted markdown string
 */
export function formatSnapshotRestore(data: SnapshotRestoreResponse): string {
  let output = `## Snapshot Restored Successfully\n\n`;
  output += `**Snapshot:** ${data.snapshot_name} (ID: ${data.snapshot_id})\n`;
  output += `**Timestamp:** ${data.timestamp}\n`;
  output += `**Duration:** ${data.duration_ms}ms\n\n`;

  output += `### Restored Data\n`;
  output += `- **Observations:** ${data.restored.observations?.toLocaleString()}\n`;
  output += `- **Embeddings:** ${data.restored.embeddings?.toLocaleString()}\n`;
  output += `- **Sessions:** ${data.restored.sessions?.toLocaleString()}\n`;
  output += `- **Summaries:** ${data.restored.summaries?.toLocaleString()}\n`;
  output += `- **Triplets:** ${data.restored.triplets?.toLocaleString()}\n`;

  return output;
}

/**
 * Format snapshot delete response as markdown.
 *
 * @param snapshotName - Name of deleted snapshot
 * @param snapshotId - ID of deleted snapshot
 * @returns Formatted markdown string
 */
export function formatSnapshotDelete(snapshotName: string, snapshotId: number): string {
  return `Snapshot "${snapshotName}" (ID: ${snapshotId}) deleted successfully.`;
}
