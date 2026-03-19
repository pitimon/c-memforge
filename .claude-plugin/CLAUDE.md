# MemForge Client Plugin

Persistent semantic memory for Claude Code, powered by the MemForge SaaS platform.

## MCP Tools Available

This plugin provides 15 MCP tools for diagnostics, semantic search, and memory management:

### Diagnostic Tools
- `mem_status` - Check config, connectivity, auth, and latency

### Search Tools
- `mem_semantic_search` - Hybrid search (vector + FTS) with mode selection
- `mem_hybrid_search` - Hybrid search with RRF ranking
- `mem_vector_search` - Pure vector/embedding search
- `mem_search` - Full-text search

All search tools support `offset` parameter for pagination.

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
- `mem_snapshot_restore` - Restore from snapshot (admin only)
- `mem_snapshot_delete` - Delete a snapshot (admin only)

## Configuration

Config is stored at `~/.memforge/config.json`. Run `bun run setup` to configure.

Sync runs automatically inside the MCP server process when `syncEnabled: true`.

### Role-Based Access
Set `"role": "admin"` in config to access destructive snapshot tools (restore/delete). Default is `"client"`.

## Sync (In-Process)

Sync runs automatically inside the MCP server process — no separate daemon, hooks, or background processes.

### Architecture
- `sync-poller.ts` - In-process polling of claude-mem SQLite (2s interval, configurable)
- `remote-sync.ts` - HTTP sync via `POST /api/sync/push` with batch support
- `pending-queue.ts` - In-memory retry queue (max 5 retries, lost on restart — server dedup handles overlap)

### Key Files
| File | Purpose |
|------|---------|
| `~/.memforge/config.json` | Plugin configuration (API key, server URL, role, syncEnabled, pollInterval) |

## Requirements

This plugin requires the `thedotmack/claude-mem` plugin to be installed first.
