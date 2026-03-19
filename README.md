# MemForge Client

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

**Persistent semantic memory for Claude Code** — search, recall, and connect knowledge across sessions and projects.

## What You Can Do

- **Search memory** across all your past sessions — by keyword, concept, or semantic similarity
- **Cross-project knowledge** — find related work from other projects automatically
- **Team knowledge sharing** — access shared knowledge pool from team members
- **Knowledge graph** — query entity relationships and triplet connections
- **Automatic sync** — observations sync to the server in the background, no manual steps

## Installation

### Prerequisites

1. **Bun runtime**: `curl -fsSL https://bun.sh/install | bash`
2. **claude-mem plugin**: `/plugin marketplace add thedotmack/claude-mem`

### Step 1: Install Plugin

```
/plugin marketplace add https://github.com/pitimon/c-memforge.git
```

### Step 2: Configure API Key

Get your API key at https://memclaude.thaicloud.ai/settings, then create the config:

```bash
mkdir -p ~/.memforge
cat > ~/.memforge/config.json << 'EOF'
{
  "apiKey": "your-api-key-here",
  "serverUrl": "https://memclaude.thaicloud.ai",
  "syncEnabled": true,
  "pollInterval": 2000,
  "role": "client"
}
EOF
```

### Step 3: Restart Claude Code

Restart to load the plugin. Verify with `mem_status` tool — should show connectivity OK.

---

## MCP Tools (16)

### Search (start here)

| Tool                  | When to Use                                              | Speed  |
| --------------------- | -------------------------------------------------------- | ------ |
| `mem_search`          | Keyword search — fastest, use this first                 | 1-3s   |
| `mem_hybrid_search`   | Balanced keyword + semantic (use `vector_weight=0.2`)    | 5-15s  |
| `mem_semantic_search` | Flexible — choose mode: `fts`, `hybrid`, or `vector`     | varies |
| `mem_vector_search`   | Pure semantic similarity — slowest, use only when needed | 10-38s |

All search tools support `offset` for pagination, `dateStart`/`dateEnd` for filtering, and `tz` for timezone.

### Retrieve

| Tool                   | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `mem_semantic_get`     | Get single observation by ID                     |
| `mem_semantic_recent`  | Get recent observations                          |
| `mem_timeline`         | Get context around an observation (before/after) |
| `mem_get_observations` | Batch fetch multiple observations by IDs         |

### Knowledge Graph

| Tool                 | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `mem_entity_lookup`  | Find all triplets mentioning an entity       |
| `mem_triplets_query` | Query subject-predicate-object relationships |

### Cross-Project & Team

| Tool                 | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `mem_cross_project`  | Find related observations from other projects   |
| `mem_team_knowledge` | Search shared team knowledge pool               |
| `mem_stable_context` | Get stable observation log (for prompt caching) |

### Data & Workflow

| Tool                   | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `mem_ingest`           | Push observations to the server               |
| `mem_workflow_suggest` | Get workflow suggestions based on context     |
| `mem_status`           | Check config, connectivity, auth, and latency |

---

## Configuration

Stored at `~/.memforge/config.json`:

| Option         | Description            | Default                          |
| -------------- | ---------------------- | -------------------------------- |
| `apiKey`       | Your MemForge API key  | (required)                       |
| `serverUrl`    | Server URL             | `https://memclaude.thaicloud.ai` |
| `syncEnabled`  | Enable background sync | `true`                           |
| `pollInterval` | Sync interval in ms    | `2000`                           |
| `role`         | `client` or `admin`    | `client`                         |

For self-hosted servers, change `serverUrl` to your server URL.

---

## How It Works

```
claude-mem (local)          memforge-client (this plugin)          MemForge Server
━━━━━━━━━━━━━━━━           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━           ━━━━━━━━━━━━━━
LLM creates structured  →  SyncPoller reads SQLite     →  POST /api/sync/push
observations in SQLite      every 2s (read-only)           stores + generates embeddings

                            16 MCP tools  ←─────────────  Search, retrieve, graph queries
```

- **claude-mem** creates structured observations via LLM (haiku) — this is the data source
- **memforge-client** syncs observations to the server AND provides search tools
- **MemForge Server** stores data in PostgreSQL + pgvector, provides search APIs

Sync runs in-process with the MCP server. No separate daemon or background process.

---

## Troubleshooting

| Problem                        | Solution                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| "Remote search not configured" | Check `~/.memforge/config.json` has valid `apiKey`                                       |
| "Required: claude-mem plugin"  | Install: `/plugin marketplace add thedotmack/claude-mem`                                 |
| "bun: command not found"       | Install: `curl -fsSL https://bun.sh/install \| bash`                                     |
| SSH error on plugin install    | Use HTTPS URL: `claude plugin marketplace add https://github.com/pitimon/c-memforge.git` |
| Sync not working               | Run `mem_status` tool. Check `syncEnabled: true` in config                               |
| Slow search                    | Use `mem_search` (FTS) instead of vector. Add date filters. Lower `limit`                |

### Upgrading from v1.x

v2.0 removed the background sync daemon. If upgrading, clean up legacy files:

```bash
# Kill old daemon if still running
ps aux | grep db-watcher | grep -v grep | awk '{print $2}' | xargs kill 2>/dev/null

# Remove legacy state files
rm -f ~/.memforge/.sync-watermark.json ~/.memforge/.sync-queue.json
rm -f ~/.claude-mem/memforge-sync.pid ~/.claude-mem/memforge-sync.log
```

## Updating

```
/plugin marketplace update pitimon-c-memforge
```

Config at `~/.memforge/config.json` is preserved. Restart Claude Code after updating.

---

## License

AGPL-3.0 — See [LICENSE](LICENSE) for details.

## Credits

- **MemForge Server** by [@pitimon](https://github.com/pitimon)
- **claude-mem Plugin** by [@thedotmack](https://github.com/thedotmack)

## Development

See [MAINTENANCE.md](MAINTENANCE.md) for architecture details, release runbook, and development setup.
