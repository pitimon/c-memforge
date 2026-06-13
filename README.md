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

### Codex

Codex uses the native package in `.codex-plugin/` and the repo marketplace in `.agents/plugins/marketplace.json`:

```bash
codex plugin marketplace add https://github.com/pitimon/c-memforge.git
codex plugin add memforge-client@pitimon-c-memforge
```

To pin a release:

```bash
codex plugin marketplace add pitimon/c-memforge --ref v2.10.1
codex plugin add memforge-client@pitimon-c-memforge
```

Configure credentials in `~/.memforge/config.json` as shown below, then start a new Codex thread so the MCP server is loaded. The Codex package exposes the MemForge MCP tools; Claude Code hook behavior remains Claude Code-specific.

### Claude Code

### Prerequisites

1. **Bun runtime** (the MCP server runs on bun — `node` cannot substitute):
   - macOS / Linux: `curl -fsSL https://bun.sh/install | bash`
   - Windows (PowerShell): `powershell -c "irm bun.sh/install.ps1 | iex"`

   Ensure both `bun` and `node` are on your `PATH` — verify with `bun --version`
   and `node --version`. (Windows note: the MCP launcher no longer needs a Unix
   shell as of **v2.10.1**; earlier versions launched via `sh`, which Windows
   lacks, so the MCP server failed to start.)

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

## Try It — Example Prompts

You don't call tools directly — just talk to Claude in natural language, and it
picks the right MemForge tool for you. Copy any prompt below into Claude Code.
The **Tool** column shows what runs under the hood (handy for verifying which
feature you're exercising).

### 1. Verify your setup (run these first)

| Prompt                                                    | Tool                  | Expect                                            |
| --------------------------------------------------------- | --------------------- | ------------------------------------------------- |
| `Check my MemForge status, tier, and quota.`              | `mem_status`          | Connectivity OK + your tier and observation count |
| `Search my MemForge memory for anything about this repo.` | `mem_semantic_search` | A list of past observations (empty if brand new)  |

If `mem_status` returns connectivity OK, the plugin is working. New accounts
start empty — your observations appear automatically after a few sessions (sync
is background, no manual steps).

### 2. Search & recall

| Prompt                                                   | Tool                           |
| -------------------------------------------------------- | ------------------------------ |
| `How did I fix the last deployment bug?`                 | `mem_semantic_search` (hybrid) |
| `What did I work on yesterday?` · `…last week?`          | `mem_temporal_query`           |
| `Find observations similar to "rate limiting strategy".` | `mem_vector_search`            |
| `Search my memory for the keyword "postgres".`           | `mem_search` (full-text)       |
| `Show my 10 most recent observations.`                   | `mem_semantic_recent`          |
| `Show the context around observation 102945.`            | `mem_timeline`                 |

### 3. Cross-project & team

| Prompt                                                           | Tool                             |
| ---------------------------------------------------------------- | -------------------------------- |
| `Find related work from my other projects about authentication.` | `mem_cross_project`              |
| `Search the team knowledge pool for our incident runbook.`       | `mem_team_knowledge` (Team tier) |

### 4. Knowledge graph

| Prompt                                                    | Tool                 |
| --------------------------------------------------------- | -------------------- |
| `What is connected to the entity "Redis" in my memory?`   | `mem_entity_lookup`  |
| `Show relationships where the predicate is "depends on".` | `mem_triplets_query` |

### 5. Skills (SkillNet)

| Prompt                                                | Tool                 |
| ----------------------------------------------------- | -------------------- |
| `Search my skills for a database migration workflow.` | `mem_skill_search`   |
| `Browse the public skill catalog.`                    | `mem_skill_discover` |
| `Turn my recent work into a reusable skill.`          | `mem_skill_create`   |

### 6. Curate memory

| Prompt                                                | Tool              |
| ----------------------------------------------------- | ----------------- |
| `Pin observation 102945 so it never gets archived.`   | `mem_pin`         |
| `Mark observation 100200 as deprecated.`              | `mem_set_status`  |
| `Observation 99000 is wrong — record the correction.` | `mem_contradict`  |
| `Which of my observations are oldest and unverified?` | `mem_drift_check` |

> Every tool response includes a `suggested_next` hint pointing you to the
> natural follow-up tool — so you can keep going without memorizing the catalog.

---

## MCP Tools (28)

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

| Tool                 | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `mem_pin`            | Pin observation — protect from decay/archival                        |
| `mem_set_importance` | Override importance score (0-1)                                      |
| `mem_set_event_date` | Set temporal event date for time-based queries                       |
| `mem_set_status`     | Set lifecycle status (active/deprecated/superseded/applied/archived) |
| `mem_contradict`     | Mark stale + create correction observation                           |
| `mem_drift_check`    | Find oldest unverified observations                                  |

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

| Tool                   | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `mem_ingest`           | Push observations to the server                   |
| `mem_workflow_suggest` | Get workflow suggestions based on context         |
| `mem_status`           | Check config, connectivity, auth, tier, and quota |

All tool responses include **workflow hints** (`suggested_next`) guiding you to the right follow-up tool.

---

## Tiers & Quotas

Your API key is associated with a tier that determines available features:

| Tier           | Observations | Search Modes          | Synthesis/day | Rate Limit |
| -------------- | ------------ | --------------------- | ------------- | ---------- |
| **Free**       | 5,000        | FTS only              | 10            | 60/min     |
| **Pro**        | 100,000      | FTS + Vector + Hybrid | 200           | 300/min    |
| **Team**       | Unlimited    | All + cross-user      | Unlimited     | 600/min    |
| **Enterprise** | Unlimited    | All + SSO + audit     | Unlimited     | Custom     |

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

                            28 MCP tools  ←─────────────  Search, curation, graph, skills
                            + workflow hints                + 15 background workers
```

- **claude-mem** creates structured observations via LLM (haiku) — this is the data source
- **memforge-client** syncs observations to the server AND provides search tools
- **MemForge Server** stores data in PostgreSQL + pgvector, provides search APIs

Sync runs in-process with the MCP server. No separate daemon or background process.

---

## Troubleshooting

| Problem                         | Solution                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Remote search not configured"  | Check `~/.memforge/config.json` has valid `apiKey`                                                                                                            |
| "Required: claude-mem plugin"   | Install: `/plugin marketplace add thedotmack/claude-mem`                                                                                                      |
| "bun: command not found"        | Install: `curl -fsSL https://bun.sh/install \| bash`                                                                                                          |
| SSH error on plugin install     | Use HTTPS: `claude plugin marketplace add pitimon/c-memforge`                                                                                                 |
| Sync not working                | Run `mem_status` tool. Check `syncEnabled: true` in config                                                                                                    |
| Slow search                     | Use `mem_search` (FTS) instead of vector. Add date filters. Lower `limit`                                                                                     |
| MCP server won't start          | Missing dependencies — see [First-run dependency install](#first-run-dependency-install) below                                                                |
| MCP fails on Windows (≤ 2.10.0) | The launcher used `sh` (absent on Windows). Update to **v2.10.1+** (`claude plugin install memforge-client@pitimon-c-memforge`) and ensure `bun` is on `PATH` |
| Old observations not syncing    | Remove watermark file — see [Backfill existing observations](#backfill-existing-observations) below                                                           |
| Claude Code hangs on startup    | claude-mem `smart-install.js` runs `bun install` — wait 30-60s or check network                                                                               |
| Old db-watcher zombie process   | See [Upgrading from v1.x](#upgrading-from-v1x) below                                                                                                          |

### First-run dependency install

After `claude plugin install`, the MCP server may fail to connect because dependencies aren't installed in the cache directory. Fix:

```bash
# macOS / Linux — find the cache directory and install dependencies
cd ~/.claude/plugins/cache/pitimon-c-memforge/memforge-client/*/
bun install
```

```powershell
# Windows (PowerShell) — newest installed version
cd (Get-ChildItem "$env:USERPROFILE\.claude\plugins\cache\pitimon-c-memforge\memforge-client" | Sort-Object Name -Descending | Select-Object -First 1).FullName
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

### Verify sync is actually working

If you suspect the observation count on the MemForge UI is lower than it should be, run `mem_status` — it includes a **Pipeline Health** section that pinpoints which layer is failing. The numbers you see will reflect your own activity:

```
### Pipeline Health
**Activity (last 24h):** N transcript file(s) modified
**Captured (last 24h):** M obs in claude-mem.db (latest id=…)
**Sync cursor:** obs #… (K unsynced)
**Server (lifetime):** … obs accepted
**Sync workers:** synced ok, 0 failed, 0 pending, circuit=closed

✓ Healthy — all 4 layers aligned.
```

The 4 layers form a pipeline. A gap between adjacent layers points at a specific failure mode:

| Gap   | Symptom                                                   | Likely cause                                                           | Where to look                                                          |
| ----- | --------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **A** | transcripts > 0 but `Captured` is 0 (or `<<` transcripts) | claude-mem hooks not running — observations are never produced locally | `~/.claude/settings.json` PostToolUse hook + `~/.claude-mem/logs/`     |
| **B** | `unsynced` is large or `circuit=open`                     | sync poller is behind or server unreachable                            | sync-poller stderr; check connectivity in the same `mem_status` output |
| **C** | `failed > 0`                                              | server rejected uploads (quota, auth, malformed payload)               | tier quota above; API key validity; server logs                        |

This is the **most common silent-failure mode**: claude-mem hook misconfiguration produces no observations at all, yet `mem_status` connectivity/auth/sync all show GREEN. The Pipeline Health section is what makes Gap A visible.

If `Captured` keeps reporting 0 after Gap A is shown, re-check that `claude-mem` is installed and that `~/.claude-mem/claude-mem.db` exists and is being written to (mtime should advance during use).

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
