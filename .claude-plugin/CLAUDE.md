# MemForge Client Plugin

Persistent semantic memory for Claude Code, powered by the MemForge SaaS platform.

## MCP Tools Available

This plugin provides 30 MCP tools for diagnostics, search, retrieval, curation, knowledge graph, skills, session continuity, and cross-project memory:

### Diagnostic Tools
- `mem_status` - Check config, connectivity, auth, and latency

### Search Tools
- `mem_semantic_search` - Primary search; hybrid (vector + FTS) with mode selection
- `mem_temporal_query` - Time-based search ("yesterday", "last week", date ranges)
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

### Context & Knowledge Tools
- `mem_cross_project` - Find observations from other projects via concept overlap
- `mem_team_knowledge` - Search team knowledge pool (shared by team members)
- `mem_stable_context` - Get stable observation log for prompt caching

### Memory Curation Tools
- `mem_pin` - Pin an observation to protect it from decay/archival
- `mem_set_importance` - Override an observation's importance score (0-1)
- `mem_set_event_date` - Set the temporal event date for time-based queries
- `mem_set_status` - Set lifecycle status (active/deprecated/superseded/applied/archived)
- `mem_contradict` - Mark an observation stale and record a correction
- `mem_drift_check` - Find the oldest unverified observations

### Skill Tools (SkillNet)
- `mem_skill_search` - Search skills by query, category, or tags
- `mem_skill_get` - Get a specific skill with full details
- `mem_skill_related` - Find related skills via graph traversal
- `mem_skill_create` - Extract a reusable skill from observations
- `mem_skill_discover` - Browse the public skill catalog

### Data Tools
- `mem_ingest` - Ingest observations into the server
- `mem_workflow_suggest` - Suggest workflows based on context

### Session Continuity Tools
- `mem_handoff` - Write a session handoff (what's done, what's next, open loops) for cross-session continuity
- `mem_resume` - Resume work: latest handoff + open loops + prior handoffs + latest retrospective for a project

## Commands

- `/forward` - Write a structured session handoff before ending/clearing (calls `mem_handoff`)
- `/resume` - Resume work by pulling the latest handoff, open loops, and recent context (calls `mem_resume`)
- `/retrospective` - Write a first-person session retrospective (AI Diary + Honest Feedback) into memforge (calls `mem_ingest`)

## Configuration

Config is stored at `~/.memforge/config.json`. Run `bun run setup` to configure.

Sync runs automatically inside the MCP server process when `syncEnabled: true`.

### Role-Based Access
Set `"role": "admin"` in config to access admin features. Default is `"client"`.

> **Note:** Snapshot tools (create/restore/delete) are available on the server-side MCP only, not in this client plugin.

## Sync (In-Process)

**Sync** runs automatically inside the MCP server process — no separate daemon or background process for syncing. (Context *retrieval* uses a read-only hook — see "Proactive Context Hooks" below; that is a separate concern from sync.)

### Architecture
- `sync-poller.ts` - In-process polling of claude-mem SQLite (2s interval, configurable)
- `remote-sync.ts` - HTTP sync via `POST /api/sync/push` with batch support
- `pending-queue.ts` - In-memory retry queue (max 5 retries, lost on restart — server dedup handles overlap)

## Proactive Context Hooks

A read-only `SessionStart` hook (`src/hooks/session-context.ts`) injects a compact
pointer to the latest handoff, open loops, and cross-project knowledge at session
start, so server memory surfaces without an explicit `mem_search` / `mem_resume`
call. Fail-open (any error → nothing injected, exit 0); pointer mode never injects
raw next-steps (no stale-steering); non-redundant with claude-mem (which injects
local recent observations).

- Config (`~/.memforge/config.json`): `sessionContextEnabled` (default `true`),
  `sessionContextMode` (`"pointer"` | `"full"`, default `"pointer"`),
  `sessionContextMaxAgeDays` (default `30`).
- Kill switch: `MEMFORGE_SESSION_CONTEXT=0`.

### Key Files
| File | Purpose |
|------|---------|
| `~/.memforge/config.json` | Plugin configuration (API key, server URL, role, syncEnabled, pollInterval, sessionContext*) |
| `src/hooks/session-context.ts` | SessionStart context-injection hook (Wave A, #76) |

## Requirements

This plugin requires the `thedotmack/claude-mem` plugin to be installed first.
