# MemForge Client

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

**Persistent semantic memory for Claude** - powered by the MemForge SaaS platform.

MemForge Client is a companion plugin that connects to the [MemForge](https://memclaude.thaicloud.ai) server, providing:

- **15 MCP tools** for semantic search, observation retrieval, memory snapshots, and diagnostics
- **Real-time sync** from local claude-mem database to remote server
- **Hybrid search** combining vector embeddings and full-text search
- **Knowledge graph** with entity lookup and triplet queries

## Installation

### Prerequisites

1. **Bun runtime** - Install from https://bun.sh:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **claude-mem plugin** - Install the base plugin first:
   ```
   /plugin marketplace add thedotmack/claude-mem
   ```

### Option 1: Claude Code CLI (Recommended)

```bash
# Step 1: Add the marketplace (HTTPS URL recommended)
claude plugin marketplace add https://github.com/pitimon/c-memforge.git

# Step 2: Install the plugin
claude plugin install memforge-client@pitimon-c-memforge

# Step 3: Configure API key
cd ~/.claude/plugins/marketplaces/pitimon-c-memforge
bun run setup "your-api-key"
```

Get your API key at: https://memclaude.thaicloud.ai/settings

> **Note:** The setup script automatically registers the sync hook in `~/.claude/settings.json` and saves your config to `~/.memforge/config.json`.

### Option 2: Inside Claude Code

```
/plugin marketplace add https://github.com/pitimon/c-memforge.git
```

Then configure in terminal:

```bash
cd ~/.claude/plugins/marketplaces/pitimon-c-memforge
bun install
bun run setup "your-api-key"
```

### Option 3: Manual Installation

```bash
git clone https://github.com/pitimon/c-memforge.git
cd c-memforge
bun install
bun run setup
```

Then add to Claude Code:
```
/plugin add /path/to/c-memforge
```

### Start Sync Service (Optional)

To sync your local observations to the remote server:

```bash
cd ~/.claude/plugins/marketplaces/pitimon-c-memforge
bun run sync
```

The sync service:
- Polls local database every 2 seconds
- Syncs new observations to remote server
- Retries failed syncs automatically
- Runs in read-only mode (no conflicts with claude-mem)

> **Note:** If you ran `bun run setup`, the sync service starts automatically on each Claude Code session via the registered SessionStart hook.

---

## MCP Tools

### Diagnostic Tools

| Tool | Description |
|------|-------------|
| `mem_status` | Check config, connectivity, auth validity, and latency |

### Search Tools

| Tool | Description | Recommendation |
|------|-------------|----------------|
| `mem_search` | Full-text search with filters | Fast (1-3s) |
| `mem_hybrid_search` | Hybrid search with RRF ranking | Use `vector_weight=0.2` |
| `mem_semantic_search` | Hybrid with mode selection | Flexible |
| `mem_vector_search` | Pure vector/embedding search | Slowest (10-38s) |

All search tools support `offset` parameter for pagination.

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

| Tool | Description | Access |
|------|-------------|--------|
| `mem_snapshot_create` | Create memory snapshot | All |
| `mem_snapshot_list` | List all snapshots | All |
| `mem_snapshot_restore` | Restore from snapshot | Admin only |
| `mem_snapshot_delete` | Delete a snapshot | Admin only |

---

## Configuration

Configuration is stored in `~/.memforge/config.json`:

```json
{
  "apiKey": "your-api-key",
  "serverUrl": "https://memclaude.thaicloud.ai",
  "syncEnabled": true,
  "pollInterval": 2000,
  "role": "client"
}
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `apiKey` | Your MemForge API key | (required) |
| `serverUrl` | MemForge server URL | `https://memclaude.thaicloud.ai` |
| `syncEnabled` | Enable real-time sync | `true` |
| `pollInterval` | Sync poll interval in ms | `2000` |
| `role` | Access level (`client` or `admin`) | `client` |

### Self-Hosted Server

To use your own MemForge server:

```json
{
  "apiKey": "your-api-key",
  "serverUrl": "https://your-server.com"
}
```

---

## Search Performance Tips

Search latency varies by mode. Choose the right mode for your needs:

| Mode | Typical Latency | Best For |
|------|----------------|----------|
| `fts` (full-text) | 1-3s | Keyword search, fastest |
| `hybrid` | 5-15s | Balanced relevance |
| `vector` | 10-38s | Semantic similarity, slowest |

**Tips for faster searches:**
- Use `mode: "fts"` in `mem_semantic_search` for fast keyword search
- Add `dateStart`/`dateEnd` filters to narrow results
- Use lower `limit` values (5-10 instead of 50)
- Add `tz` parameter to avoid timezone mismatches in date filters

---

## Architecture

### High-Level Overview

```mermaid
graph TB
    subgraph "Local Machine"
        CM[claude-mem plugin<br/>SQLite Database]
        MFC[memforge-client<br/>Sync Service]
    end

    subgraph "Remote Server"
        API[MemForge API<br/>memclaude.thaicloud.ai]
        VDB[(Vector DB<br/>Memgraph)]
    end

    CM -->|Poll every 2s<br/>Read-only| MFC
    MFC -->|HTTPS + API Key<br/>POST /api/sync/push| API
    API --> VDB

    User[Claude Code] -.->|15 MCP Tools<br/>Search & Retrieve| API

    style CM fill:#1a365d,stroke:#2d3748,stroke-width:2px,color:#fff
    style MFC fill:#2f855a,stroke:#276749,stroke-width:2px,color:#fff
    style API fill:#2b6cb0,stroke:#2c5282,stroke-width:2px,color:#fff
    style VDB fill:#6b46c1,stroke:#553c9a,stroke-width:2px,color:#fff
    style User fill:#ed8936,stroke:#c05621,stroke-width:2px,color:#fff
```

**Components:**
- **claude-mem plugin**: Local SQLite database storing observations
- **memforge-client**: Sync service that polls local DB every 2s and pushes to remote
- **MemForge API**: Remote server handling sync and search requests
- **Vector DB**: Memgraph database with semantic search capabilities

### Detailed Flow

```mermaid
sequenceDiagram
    participant User as Claude Code User
    participant CM as claude-mem plugin
    participant DB as Local SQLite
    participant MFC as memforge-client
    participant API as MemForge Server
    participant VDB as Vector DB

    User->>CM: Create observation
    CM->>DB: Store locally

    loop Every 2 seconds
        MFC->>DB: Poll new observations (read-only)
        DB-->>MFC: Return new records
        MFC->>API: POST /api/sync/push + API Key
        API->>VDB: Store + Generate embeddings
        VDB-->>API: Success
        API-->>MFC: Sync confirmed
    end

    User->>API: Search (MCP tools)
    API->>VDB: Hybrid search (FTS + Vector)
    VDB-->>API: Ranked results
    API-->>User: Return observations
```

---

## Scripts

| Script | Description |
|--------|-------------|
| `bun run setup [api-key]` | Configure API key (interactive or quick) |
| `bun run sync` | Start database watcher |
| `bun run check` | Check dependencies |
| `bun run mcp` | Run MCP server directly |

---

## Troubleshooting

### "Remote search not configured"

Run `bun run setup` to configure your API key, or use `mem_status` tool to diagnose.

### "Required: thedotmack/claude-mem plugin"

Install the base plugin first:
```
/plugin marketplace add thedotmack/claude-mem
```

### "bun: command not found"

Install Bun runtime:
```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc  # or restart terminal
```

### Installation fails with SSH error

If `claude plugin marketplace add pitimon/c-memforge` fails with an SSH error, use the HTTPS URL instead:

```bash
claude plugin marketplace add https://github.com/pitimon/c-memforge.git
```

Or configure git to use HTTPS for all GitHub operations:
```bash
git config --global url."https://github.com/".insteadOf git@github.com:
```

This is a known Claude Code issue ([#9719](https://github.com/anthropics/claude-code/issues/9719)).

### Sync not working

1. Check config: `cat ~/.memforge/config.json`
2. Verify API key is correct
3. Check server connectivity: `curl https://memclaude.thaicloud.ai/health`
4. Check sync logs when running `bun run sync`
5. Use `mem_status` tool for diagnostics

### Database locked

The sync service uses read-only mode and should not conflict with claude-mem. If issues persist, restart the sync service.

---

## Updating

### Claude Code

```bash
claude plugin marketplace update pitimon-c-memforge
```

Or inside Claude Code:
```
/plugin marketplace update pitimon-c-memforge
```

---

## Development

See [MAINTENANCE.md](MAINTENANCE.md) for detailed maintenance instructions.

```bash
# Check dependencies
bun run check

# Run MCP server
bun run mcp

# Run sync watcher
bun run sync
```

---

## License

AGPL-3.0 - See [LICENSE](LICENSE) for details.

## Credits

- **MemForge Server** by [@pitimon](https://github.com/pitimon)
- **Claude-Mem Plugin** by [@thedotmack](https://github.com/thedotmack)
