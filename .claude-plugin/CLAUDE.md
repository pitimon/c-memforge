# MemForge Client Plugin

Persistent semantic memory for Claude Code, powered by the MemForge SaaS platform.

## MCP Tools Available

This plugin provides 14 MCP tools for semantic search and memory management:

### Search Tools
- `mem_semantic_search` - Hybrid search (vector + FTS)
- `mem_hybrid_search` - Hybrid search with RRF ranking
- `mem_vector_search` - Pure vector/embedding search
- `mem_search` - Full-text search

### Observation Tools
- `mem_semantic_get` - Get observation by ID
- `mem_semantic_recent` - Get recent observations
- `mem_timeline` - Get context around an observation
- `mem_get_observations` - Batch fetch observations by IDs

### Entity Tools
- `mem_entity_lookup` - Find triplets by entity name
- `mem_triplets_query` - Query SPO triplets with filters

### Snapshot Tools
- `mem_snapshot_create` - Create memory snapshot
- `mem_snapshot_list` - List all snapshots
- `mem_snapshot_restore` - Restore from snapshot
- `mem_snapshot_delete` - Delete a snapshot

## Configuration

API key is read from `config.local.json` in the plugin root directory.
Run `bun run setup` to configure.

## Requirements

This plugin requires the `thedotmack/claude-mem` plugin to be installed first.
