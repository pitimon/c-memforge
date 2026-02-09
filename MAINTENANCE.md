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
│   └── sync/                # Sync service (Claude Code only)
│       ├── db-watcher.ts    # Database polling
│       ├── remote-sync.ts   # Remote sync client
│       ├── sync-manager.ts  # Process lifecycle manager
│       └── pending-queue.ts # Persistent retry queue
├── scripts/
│   ├── setup.ts             # Configuration script (writes to ~/.memforge/)
│   └── check-dependency.ts  # Dependency checker
├── config.example.json      # Config template
├── .mcp.json                # MCP server configuration
├── package.json
└── README.md
```

### Config Location

Config is stored at `~/.memforge/config.json` (canonical). The setup script migrates from the legacy `config.local.json` location automatically. Sync watermark and queue files are also stored under `~/.memforge/`.

---

## API Key Management

### For Users

Get your API key at: https://memclaude.thaicloud.ai/settings

Configure it using:
```bash
cd ~/.claude/plugins/marketplaces/pitimon-c-memforge
bun run setup "your-api-key"
```

Config is saved to `~/.memforge/config.json` and hooks are registered in `~/.claude/settings.json` automatically.

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

# 2. Test locally
bun run mcp
bun run sync

# 3. Commit and push
git add -A
git commit -m "description"
git push origin main
```

### Plugin Paths

| Environment | Path |
|-------------|------|
| User Install | `~/.claude/plugins/marketplaces/pitimon-c-memforge/` |

### Testing Installation Flow

```bash
# Remove existing
claude plugin remove memforge-client
claude plugin marketplace remove pitimon-c-memforge

# Fresh install (use HTTPS URL to avoid SSH issues)
claude plugin marketplace add https://github.com/pitimon/c-memforge.git
claude plugin install memforge-client@pitimon-c-memforge

# Configure (saves to ~/.memforge/config.json + registers hooks)
cd ~/.claude/plugins/marketplaces/pitimon-c-memforge
bun run setup "API-KEY"

# Test
bun run mcp
bun run sync
```

> **Note:** The GitHub slug format `pitimon/c-memforge` uses SSH internally and may fail for clients without SSH keys configured. Use the HTTPS URL instead. See [Claude Code issue #9719](https://github.com/anthropics/claude-code/issues/9719).

---

## Server Endpoints

### Production Server

| Endpoint | Purpose |
|----------|---------|
| `https://memclaude.thaicloud.ai/health` | Health check |
| `https://memclaude.thaicloud.ai/api/search` | Full-text search |
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

# Test sync manually
bun run sync
```

### API Key Rejected

```bash
# Verify key works
curl -H "X-API-Key: YOUR_KEY" https://memclaude.thaicloud.ai/health

# If rejected, request a new key from the administrator
```

---

## Release Checklist

### Claude Code Release

- [ ] Update version in `package.json`
- [ ] Update version in `.claude-plugin/plugin.json`
- [ ] Update version in `.claude-plugin/marketplace.json`
- [ ] Test locally: `bun run mcp`, `bun run sync`
- [ ] Commit and push to GitHub
- [ ] Test remote install flow
- [ ] Update documentation

---

## Contacts

- **Repository**: https://github.com/pitimon/c-memforge
- **Server**: https://memclaude.thaicloud.ai
