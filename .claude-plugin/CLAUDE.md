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

The setup script also registers the sync SessionStart hook in `~/.claude/settings.json`.

### Role-Based Access
Set `"role": "admin"` in config to access destructive snapshot tools (restore/delete). Default is `"client"`.

## Sync Manager

Auto-manages the database watcher process via SessionStart hook.

### Commands
```bash
bun src/sync/sync-manager.ts start   # Start watcher (detached, PID tracked)
bun src/sync/sync-manager.ts stop    # Stop watcher (SIGTERM + cleanup)
bun src/sync/sync-manager.ts status  # Check if watcher is running
```

### Architecture
- `sync-manager.ts` - Process lifecycle (PID file, detached spawn, log redirect)
- `db-watcher.ts` - Polls local SQLite, uses batch `syncBatch()` for efficiency
- `remote-sync.ts` - HTTP sync with disk-persistent `PendingQueue` for retry
- `pending-queue.ts` - Failed syncs persisted to `~/.memforge/.sync-queue.json`, max 5 retries

### Key Files
| File | Purpose |
|------|---------|
| `~/.memforge/config.json` | Plugin configuration (API key, server URL, role) |
| `~/.memforge/.sync-watermark.json` | Sync progress watermark |
| `~/.memforge/.sync-queue.json` | Persistent retry queue for failed syncs |
| `~/.claude-mem/memforge-sync.pid` | PID file (JSON: pid, startedAt, pluginRoot) |
| `~/.claude-mem/memforge-sync.log` | Watcher stdout/stderr log |

## Requirements

This plugin requires the `thedotmack/claude-mem` plugin to be installed first.
