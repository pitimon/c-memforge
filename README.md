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

### Step 1: Add Marketplace + Install Plugin

Run these commands in your **terminal** (not inside Claude Code):

```bash
# Add the marketplace source
claude plugin marketplace add pitimon/c-memforge

# Install the plugin
claude plugin install memforge-client@pitimon-c-memforge
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

## MCP Tools (27)

### Search (start here)

| Tool                  | When to Use                                               |
| --------------------- | --------------------------------------------------------- |
| `mem_semantic_search` | **Primary** — use FIRST. Supports hybrid/fts/vector modes |
| `mem_temporal_query`  | Time-based search ("yesterday", "last week", dates)       |
| `mem_hybrid_search`   | Dedicated hybrid (backward compat — use semantic_search)  |
| `mem_vector_search`   | Pure semantic similarity                                  |
| `mem_search`          | Keyword-only (FTS) with project/type filter               |

### Retrieve

| Tool                   | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `mem_semantic_get`     | Get single observation by ID                     |
| `mem_semantic_recent`  | Get recent observations                          |
| `mem_timeline`         | Get context around an observation (before/after) |
| `mem_get_observations` | Batch fetch multiple observations by IDs         |

### Memory Curation

| Tool                 | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `mem_pin`            | Pin observation — protect from decay/archival  |
| `mem_set_importance` | Override importance score (0-1)                |
| `mem_set_event_date` | Set temporal event date for time-based queries |
| `mem_contradict`     | Mark stale + create correction observation     |
| `mem_drift_check`    | Find oldest unverified observations            |

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

### SkillNet

| Tool                 | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `mem_skill_search`   | Search skills by query, category, or tags  |
| `mem_skill_get`      | Get a specific skill with full details     |
| `mem_skill_related`  | Find related skills via graph traversal    |
| `mem_skill_create`   | Extract a reusable skill from observations |
| `mem_skill_discover` | Browse the public skill catalog            |

### Data & Workflow

| Tool                   | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `mem_ingest`           | Push observations to the server               |
| `mem_workflow_suggest` | Get workflow suggestions based on context     |
| `mem_status`           | Check config, connectivity, auth, tier, and quota |

All tool responses include **workflow hints** (`suggested_next`) guiding you to the right follow-up tool.

---

## Tiers & Quotas

Your API key is associated with a tier that determines available features:

| Tier         | Observations | Search Modes        | Synthesis/day | Rate Limit |
| ------------ | ------------ | ------------------- | ------------- | ---------- |
| **Free**     | 5,000        | FTS only            | 10            | 60/min     |
| **Pro**      | 100,000      | FTS + Vector + Hybrid | 200         | 300/min    |
| **Team**     | Unlimited    | All + cross-user    | Unlimited     | 600/min    |
| **Enterprise** | Unlimited  | All + SSO + audit   | Unlimited     | Custom     |

Run `mem_status` to see your current tier and quota usage. The server endpoints `/api/auth/me`, `/api/account`, and `/api/user/me` all return tier and quota details.

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
observations in SQLite      every 2-10s (adaptive)         stores + embeds + extracts entities

                            27 MCP tools  ←─────────────  Search, curation, graph, skills
                            + workflow hints                + 15 background workers
```

- **claude-mem** creates structured observations via LLM (haiku) — this is the data source
- **memforge-client** syncs observations to the server AND provides search tools
- **MemForge Server** stores data in PostgreSQL + pgvector, provides search APIs

Sync runs in-process with the MCP server. No separate daemon or background process.

---

## Troubleshooting

| Problem                        | Solution                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| "Remote search not configured" | Check `~/.memforge/config.json` has valid `apiKey`                                                  |
| "Required: claude-mem plugin"  | Install: `/plugin marketplace add thedotmack/claude-mem`                                            |
| "bun: command not found"       | Install: `curl -fsSL https://bun.sh/install \| bash`                                                |
| SSH error on plugin install    | Use HTTPS: `claude plugin marketplace add pitimon/c-memforge`                                       |
| Sync not working               | Run `mem_status` tool. Check `syncEnabled: true` in config                                          |
| Slow search                    | Use `mem_search` (FTS) instead of vector. Add date filters. Lower `limit`                           |
| MCP server won't start         | Missing dependencies — see [First-run dependency install](#first-run-dependency-install) below      |
| Old observations not syncing   | Remove watermark file — see [Backfill existing observations](#backfill-existing-observations) below |
| Claude Code hangs on startup   | claude-mem `smart-install.js` runs `bun install` — wait 30-60s or check network                     |
| Old db-watcher zombie process  | See [Upgrading from v1.x](#upgrading-from-v1x) below                                                |

### First-run dependency install

After `claude plugin install`, the MCP server may fail to connect because dependencies aren't installed in the cache directory. Fix:

```bash
# Find the cache directory and install dependencies
cd ~/.claude/plugins/cache/pitimon-c-memforge/memforge-client/*/
bun install
```

Then reconnect: run `/mcp` in Claude Code and reconnect memforge, or restart Claude Code.

### Backfill existing observations

If you installed c-memforge after using claude-mem for a while, your existing observations may not have synced. To backfill:

```bash
# Remove watermark — next startup will sync all observations from the beginning
rm -f ~/.memforge/.sync-watermark.json
```

Restart Claude Code. The SyncPoller will log:

```
[SyncPoller] Fresh install — backfilling N existing observations
```

Server-side deduplication prevents duplicates, so this is safe to run anytime.

### Upgrading from v1.x

v2.0+ moved sync into the MCP server process. If upgrading from v1.x, clean up legacy processes and files:

```bash
# Kill old daemon if still running
pkill -f db-watcher 2>/dev/null

# Remove old plugin cache (may spawn zombie db-watcher)
rm -rf ~/.claude/plugins/cache/pitimon-c-memforge/

# Remove legacy state files
rm -f ~/.memforge/.sync-queue.json
rm -f ~/.claude-mem/memforge-sync.pid ~/.claude-mem/memforge-sync.log
```

Then reinstall fresh:

```bash
claude plugin uninstall memforge-client@pitimon-c-memforge
claude plugin marketplace add pitimon/c-memforge
claude plugin install memforge-client@pitimon-c-memforge
```

## Updating

```bash
claude plugin update pitimon-c-memforge
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
