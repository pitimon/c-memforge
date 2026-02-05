# MemForge Client

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

**Persistent semantic memory for Claude Code** - powered by the MemForge SaaS platform.

MemForge Client is a companion plugin that connects to the [MemForge](https://memclaude.thaicloud.ai) server, providing:

- **14 MCP tools** for semantic search, observation retrieval, and memory snapshots
- **Real-time sync** from local claude-mem database to remote server
- **Hybrid search** combining vector embeddings and full-text search
- **Knowledge graph** with entity lookup and triplet queries

## Prerequisites

**Required**: Install the base claude-mem plugin first:

```
/plugin marketplace add thedotmack/claude-mem
```

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/pitimon/c-memforge.git
cd c-memforge
bun install
```

### 2. Configure

```bash
bun run setup
```

You'll be prompted for:
- **API Key** - Get yours at https://memclaude.thaicloud.ai/settings
- **Server URL** - Default: `https://memclaude.thaicloud.ai`

### 3. Add to Claude Code

```
/plugin add /path/to/c-memforge
```

### 4. (Optional) Start Sync Service

To sync your local observations to the remote server:

```bash
bun run sync
```

## MCP Tools

### Search Tools

| Tool | Description |
|------|-------------|
| `mem_semantic_search` | Hybrid search with mode selection (hybrid/fts/vector) |
| `mem_hybrid_search` | Hybrid search with RRF ranking |
| `mem_vector_search` | Pure vector/embedding search |
| `mem_search` | Full-text search with filters |

### Observation Tools

| Tool | Description |
|------|-------------|
| `mem_semantic_get` | Get observation by ID |
| `mem_semantic_recent` | Get recent observations |
| `mem_timeline` | Get context around an observation |
| `mem_get_observations` | Batch fetch observations by IDs |

### Entity Tools

| Tool | Description |
|------|-------------|
| `mem_entity_lookup` | Find triplets by entity name |
| `mem_triplets_query` | Query SPO triplets with filters |

### Snapshot Tools

| Tool | Description |
|------|-------------|
| `mem_snapshot_create` | Create memory snapshot |
| `mem_snapshot_list` | List all snapshots |
| `mem_snapshot_restore` | Restore from snapshot |
| `mem_snapshot_delete` | Delete a snapshot |

## Configuration

Configuration is stored in `config.local.json` (gitignored):

```json
{
  "apiKey": "your-api-key",
  "serverUrl": "https://memclaude.thaicloud.ai",
  "syncEnabled": true,
  "pollInterval": 2000
}
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `apiKey` | Your MemForge API key | (required) |
| `serverUrl` | MemForge server URL | `https://memclaude.thaicloud.ai` |
| `syncEnabled` | Enable real-time sync | `true` |
| `pollInterval` | Sync poll interval in ms | `2000` |

### Self-Hosted Server

To use your own MemForge server:

```json
{
  "apiKey": "your-api-key",
  "serverUrl": "https://your-server.com"
}
```

## Sync Architecture

```
┌─────────────────────────────────────────────────────────┐
│ claude-mem plugin (local)                               │
│ SQLite: ~/.claude-mem/claude-mem.db                     │
└─────────────────────────────────────────────────────────┘
                      ▲
                      │ readonly query (every 2s)
                      │
┌─────────────────────┴───────────────────────────────────┐
│ memforge-client (this plugin)                           │
│ DatabaseWatcher → polls new observations                │
│ RemoteSync → POST to server                             │
│ PendingQueue → retry failed syncs                       │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS + X-API-Key
                      ▼
┌─────────────────────────────────────────────────────────┐
│ memclaude.thaicloud.ai                                  │
│ POST /api/sync/observation → receive & store            │
│ GET /api/search/* → semantic search                     │
└─────────────────────────────────────────────────────────┘
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run setup` | Interactive configuration |
| `bun run sync` | Start database watcher |
| `bun run check` | Check dependencies |
| `bun run mcp` | Run MCP server directly |

## Troubleshooting

### "Remote search not configured"

Run `bun run setup` to configure your API key.

### "Required: thedotmack/claude-mem plugin"

Install the base plugin first:
```
/plugin marketplace add thedotmack/claude-mem
```

### Sync not working

1. Check if sync is enabled: `bun run check`
2. Verify API key is correct
3. Check server connectivity: `curl https://memclaude.thaicloud.ai/health`
4. Review pending queue in `.sync-queue.json`

### Database locked

The sync service uses read-only mode and should not conflict with claude-mem. If issues persist, restart the sync service.

## Development

```bash
# Check dependencies
bun run check

# Run MCP server
bun run mcp

# Run sync watcher
bun run sync
```

## License

AGPL-3.0 - See [LICENSE](LICENSE) for details.

## Credits

- **MemForge Server** by [@pitimon](https://github.com/pitimon)
- **Claude-Mem Plugin** by [@thedotmack](https://github.com/thedotmack)
