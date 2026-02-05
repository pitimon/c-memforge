/**
 * MCP Server Shared Types
 *
 * Common interfaces used across MCP server modules.
 */

/** MCP Tool response content */
export interface ToolContent {
  type: 'text';
  text: string;
}

/** Standard MCP tool response */
export interface ToolResponse {
  content: ToolContent[];
  isError?: boolean;
}

/** Tool definition for MCP server */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<ToolResponse>;
}

/** Search result from API */
export interface SearchResult {
  id: number;
  title?: string;
  subtitle?: string;
  narrative?: string;
  type?: string;
  score?: number;
  combined_score?: number;
  vector_score?: number;
  fts_score?: number;
}

/** Search API response */
export interface SearchResponse {
  query: string;
  expanded_query?: string;
  method?: string;
  vector_weight?: number;
  fts_weight?: number;
  candidates_count?: number;
  results_count?: number;
  embeddings_count?: number;
  duration_ms?: number;
  results?: SearchResult[];
}

/** Timeline API response */
export interface TimelineResponse {
  anchor?: {
    id: number;
    title?: string;
    narrative?: string;
    type?: string;
  };
  before?: Array<{
    id: number;
    title?: string;
    type?: string;
  }>;
  after?: Array<{
    id: number;
    title?: string;
    type?: string;
  }>;
}

/** Observation from API */
export interface Observation {
  id: number;
  title?: string;
  subtitle?: string;
  narrative?: string;
  type?: string;
  project?: string;
  created_at?: string;
  concepts?: string | string[];
}

/** Entity lookup response */
export interface EntityLookupResponse {
  as_subject?: Triplet[];
  as_object?: Triplet[];
  related_observations?: Observation[];
  total_triplets?: number;
}

/** SPO Triplet */
export interface Triplet {
  subject?: string;
  predicate?: string;
  object?: string;
  observation_id?: number;
  confidence?: number;
}

/** Triplets query response */
export interface TripletsQueryResponse {
  triplets?: Triplet[];
}

/** Snapshot metadata */
export interface Snapshot {
  id: number;
  snapshot_name: string;
  description?: string;
  created_at?: string;
  observation_count?: number;
  embedding_count?: number;
  session_count?: number;
  triplet_count?: number;
  file_size_bytes?: number;
  compressed_size_bytes?: number;
  compression_ratio?: number;
  status?: string;
  restoration_count?: number;
  last_restored_at?: string;
}

/** Snapshot creation response */
export interface SnapshotCreateResponse extends Snapshot {
  // All fields from Snapshot
}

/** Snapshot list response */
export interface SnapshotListResponse {
  total: number;
  snapshots?: Snapshot[];
}

/** Snapshot restore response */
export interface SnapshotRestoreResponse {
  snapshot_name: string;
  snapshot_id: number;
  timestamp: string;
  duration_ms: number;
  restored: {
    observations?: number;
    embeddings?: number;
    sessions?: number;
    summaries?: number;
    triplets?: number;
  };
}
