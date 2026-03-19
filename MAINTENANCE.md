# MemForge Client - Maintenance Guide

## Overview

This document covers maintenance procedures for the MemForge Client plugin for Claude Code.

## Repository Structure

```
c-memforge/
├── .claude-plugin/
│   ├── plugin.json          # Plugin manifest
│   ├── marketplace.json     # Marketplace registration
│   ├── CLAUDE.md            # Plugin documentation
│   └── hooks/
│       └── hooks.json       # Hook configuration
├── src/
│   ├── mcp/                 # MCP server and handlers
│   │   ├── mcp-server.ts    # Entry point
│   │   ├── api-client.ts    # Remote API client (config resolution)
│   │   ├── types.ts         # Type definitions
│   │   ├── handlers/        # Tool handlers (incl. status-handler.ts)
│   │   └── formatters/      # Response formatters
│   └── sync/                # Sync service (in-process)
│       ├── sync-poller.ts   # In-process database polling (replaces db-watcher)
│       ├── remote-sync.ts   # Remote sync client
│       └── pending-queue.ts # In-memory retry queue
├── scripts/
│   ├── setup.ts             # Configuration script (writes to ~/.memforge/)
│   └── check-dependency.ts  # Dependency checker
├── config.example.json      # Config template
├── .mcp.json                # MCP server configuration
├── package.json
└── README.md
```

### Config Location

Config is stored at `~/.memforge/config.json` (canonical). The setup script migrates from the legacy `config.local.json` location automatically. No other state files are needed — sync watermark and retry queue are in-memory.

---

## API Key Management

### For Users

Get your API key at: https://memclaude.thaicloud.ai/settings

Configure it using:

```bash
cd ~/.claude/plugins/marketplaces/pitimon-c-memforge
bun run setup "your-api-key"
```

Config is saved to `~/.memforge/config.json`. Sync runs automatically inside the MCP server process.

### For Administrators

API key management is documented in the **private** memforge server repository. Never store production API keys in this public repository.

```bash
# Generate a new key
openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32

# Verify a key
curl -H "X-API-Key: KEY" https://memclaude.thaicloud.ai/health
```

---

## Claude Code Plugin Maintenance

### Update Plugin Code

```bash
# 1. Make changes locally
# Edit files...

# 2. Test locally (sync runs in-process with MCP server)
bun run mcp

# 3. Commit and push
git add -A
git commit -m "description"
git push origin main
```

### Plugin Paths

| Environment  | Path                                                 |
| ------------ | ---------------------------------------------------- |
| User Install | `~/.claude/plugins/marketplaces/pitimon-c-memforge/` |

### Testing Installation Flow

```bash
# Remove existing
claude plugin remove memforge-client
claude plugin marketplace remove pitimon-c-memforge

# Fresh install (use HTTPS URL to avoid SSH issues)
claude plugin marketplace add https://github.com/pitimon/c-memforge.git
claude plugin install memforge-client@pitimon-c-memforge

# Configure (saves to ~/.memforge/config.json, cleans up legacy files)
cd ~/.claude/plugins/marketplaces/pitimon-c-memforge
bun run setup "API-KEY"

# Test (sync runs in-process with MCP server)
bun run mcp
```

> **Note:** The GitHub slug format `pitimon/c-memforge` uses SSH internally and may fail for clients without SSH keys configured. Use the HTTPS URL instead. See [Claude Code issue #9719](https://github.com/anthropics/claude-code/issues/9719).

---

## Server Endpoints

### Production Server

| Endpoint                                       | Purpose           |
| ---------------------------------------------- | ----------------- |
| `https://memclaude.thaicloud.ai/health`        | Health check      |
| `https://memclaude.thaicloud.ai/api/search`    | Full-text search  |
| `https://memclaude.thaicloud.ai/api/sync/push` | Sync observations |

### Health Check

```bash
curl -H "X-API-Key: KEY" https://memclaude.thaicloud.ai/health | jq .
```

### Test Search

```bash
curl -H "X-API-Key: KEY" "https://memclaude.thaicloud.ai/api/search?q=test&limit=3" | jq .
```

---

## Known Issues

### Issue #88: Vector Search Quality

- Vector search returns irrelevant results
- **Workaround**: Use `mem_search` (FTS) or `mem_hybrid_search` with `vector_weight=0.2`

### Issue #89: Entity Lookup Substring Match

- Entity lookup uses substring matching
- **Workaround**: Use exact entity names

### Issue #90: Date Filter

- Date filter may return 0 results
- **Workaround**: Use wider date ranges or omit filter

---

## Troubleshooting

### MCP Server Won't Start

```bash
# Check for syntax errors
bun run src/mcp/mcp-server.ts

# Check config
cat config.local.json

# Verify API key
curl -H "X-API-Key: KEY" https://memclaude.thaicloud.ai/health
```

### Sync Not Working

```bash
# Check database exists
ls -la ~/.claude-mem/claude-mem.db

# Check sync config
cat ~/.memforge/config.json | jq .syncEnabled

# Test sync (check MCP server stderr for [SyncPoller] messages)
bun run mcp
```

### API Key Rejected

```bash
# Verify key works
curl -H "X-API-Key: YOUR_KEY" https://memclaude.thaicloud.ai/health

# If rejected, request a new key from the administrator
```

---

## Release Runbook

### Version Files (ALL 3 must match)

| File                              | Read by                | Missed =                 |
| --------------------------------- | ---------------------- | ------------------------ |
| `package.json`                    | npm/bun, `bun run mcp` | Build uses wrong version |
| `.claude-plugin/plugin.json`      | Plugin detail view     | Detail shows old version |
| `.claude-plugin/marketplace.json` | Plugin **list** view   | List shows old version   |

**Verify after bump:** `grep -rn '"version"' package.json .claude-plugin/`

### Patch Release (bugfix, no new tools)

```bash
# 1. Branch
git checkout -b fix/description

# 2. Fix + commit
git add <files>
git commit -m "fix: description"

# 3. PR + merge
git push -u origin fix/description
gh pr create --title "fix: description" --body "..."
gh pr merge <N> --merge

# 4. Version bump (ALL 3 files)
git checkout main && git pull
# Edit: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore(version): bump to X.Y.Z"
git push origin main

# 5. Tag + release
git tag -a vX.Y.Z -m "vX.Y.Z — short description"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z — Title" --notes "..."

# 6. Verify
grep -rn '"version"' package.json .claude-plugin/  # all 3 match?
```

### Minor Release (new tools / features)

```bash
# 1. Branch
git checkout -b feat/description

# 2. Implement
#    - Add handler in src/mcp/handlers/
#    - Register in handlers/index.ts (import + getAllTools)
#    - Add endpoint to api-client.ts:
#      ENDPOINT_MAP (if handler uses short path like /context/stable)
#      ALLOWED_API_PATHS (for direct /api/ paths or prefix matching)
#    - Update README.md tool count + table

# 3. PR + merge (same as patch)

# 4. Version bump ALL 3 files → X.Y+1.0
# 5. Tag + release (same as patch)
# 6. Verify
```

### Adding New Server Endpoints to Client

When the memforge server adds new API endpoints:

1. **ENDPOINT_MAP** — add if handler calls a short path (e.g., `/context/stable` → `/api/context/stable`)
2. **ALLOWED_API_PATHS** — add the full `/api/...` path for exact match, or the prefix for parameterized paths (e.g., `/api/teams` matches `/api/teams/1/knowledge`)
3. **Test** — call the tool and verify it doesn't throw "Unknown endpoint"

### Post-Release QA

```bash
# From Claude Code:
# 1. Update plugin
/plugin → select memforge-client → "Update now"

# 2. Verify version (list AND detail must match)
/plugin → check list view version
/plugin → select → check detail version

# 3. Smoke test all tools
# Run each mem_* tool and confirm no "Unknown endpoint" errors
```

### Rollback

```bash
# Revert to previous version
git revert HEAD   # revert version bump
git revert HEAD~1 # revert the fix (if needed)
git push origin main

# Re-tag
git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z
gh release delete vX.Y.Z --yes
```

---

## Contacts

- **Repository**: https://github.com/pitimon/c-memforge
- **Server**: https://memclaude.thaicloud.ai
