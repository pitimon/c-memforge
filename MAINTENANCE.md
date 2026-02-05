# MemForge Client - Maintenance Guide

## Overview

This document covers maintenance procedures for the MemForge Client plugin across both Claude Code and Claude Cowork platforms.

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
│   │   ├── api-client.ts    # Remote API client
│   │   ├── types.ts         # Type definitions
│   │   ├── handlers/        # Tool handlers
│   │   └── formatters/      # Response formatters
│   └── sync/                # Sync service (Claude Code only)
│       ├── db-watcher.ts    # Database polling
│       └── remote-sync.ts   # Remote sync client
├── scripts/
│   ├── setup.ts             # Configuration script
│   ├── check-dependency.ts  # Dependency checker
│   └── build-cowork.sh      # Cowork package builder
├── config.example.json      # Config template
├── config.local.json        # User config (gitignored)
├── .mcp.json                # MCP server configuration
├── package.json
└── README.md
```

---

## API Key Management

### Production Server Location

```
Server: ***REMOVED***
Path: ***REMOVED***
```

### Current API Keys

| Key | User | Purpose |
|-----|------|---------|
| `***REMOVED***` | itarun | Original user key |
| `***REMOVED***` | itarun | c-memforge client |
| `***REMOVED***` | cowork | Claude Cowork distribution |

### Adding New API Key

```bash
# 1. Generate key
NEW_KEY=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
echo "New key: $NEW_KEY"

# 2. SSH to production server
ssh itarun@***REMOVED***

# 3. Edit api-keys.json
vi ***REMOVED***

# 4. Add new key entry
{
  "keys": {
    "existing-keys": "...",
    "NEW_KEY_HERE": {
      "user": "username",
      "database": "database-name",
      "description": "Key description"
    }
  }
}

# 5. Restart worker
cd ***REMOVED***
docker compose restart worker

# 6. Verify
curl -H "X-API-Key: NEW_KEY" https://memclaude.thaicloud.ai/health
```

### Revoking API Key

```bash
# 1. SSH to production
ssh itarun@***REMOVED***

# 2. Remove key from api-keys.json
vi ***REMOVED***

# 3. Restart worker
cd ***REMOVED***
docker compose restart worker
```

---

## Claude Code Plugin Maintenance

### Update Plugin Code

```bash
# 1. Make changes locally
cd /Users/itarun/c-memforge
# Edit files...

# 2. Test locally
bun run mcp
bun run sync

# 3. Commit and push
git add -A
git commit -m "description"
git push origin main

# 4. Update on remote test server
ssh itarun@***REMOVED***
claude plugin marketplace update pitimon-c-memforge
```

### Plugin Paths

| Environment | Path |
|-------------|------|
| Development | `/Users/itarun/c-memforge/` |
| Remote Test | `~/.claude/plugins/marketplaces/pitimon-c-memforge/` |
| User Install | `~/.claude/plugins/marketplaces/pitimon-c-memforge/` |

### Testing Installation Flow

```bash
# Full reinstall test
ssh itarun@***REMOVED***

# Remove existing
claude plugin remove memforge-client
claude plugin marketplace remove pitimon-c-memforge

# Fresh install
claude plugin marketplace add pitimon/c-memforge
claude plugin install memforge-client@pitimon-c-memforge

# Configure
cd ~/.claude/plugins/marketplaces/pitimon-c-memforge
bun run setup "API-KEY"

# Test
bun run mcp
bun run sync
```

---

## Claude Cowork Package Maintenance

### Build New Package

```bash
# Use build script
cd /Users/itarun/c-memforge
./scripts/build-cowork.sh "API-KEY"

# Output: memforge-client-cowork.zip
```

### Manual Build Process

```bash
# 1. Create temp directory
COWORK_DIR="/tmp/memforge-cowork"
rm -rf "$COWORK_DIR"
mkdir -p "$COWORK_DIR"

# 2. Copy files
cp -r .claude-plugin "$COWORK_DIR/"
cp -r src/mcp "$COWORK_DIR/src/"
cp .mcp.json "$COWORK_DIR/"
cp package.json "$COWORK_DIR/"
cp tsconfig.json "$COWORK_DIR/"

# 3. Remove marketplace.json (not needed for upload)
rm -f "$COWORK_DIR/.claude-plugin/marketplace.json"

# 4. Create embedded config
cat > "$COWORK_DIR/config.local.json" << EOF
{
  "apiKey": "YOUR-API-KEY",
  "serverUrl": "https://memclaude.thaicloud.ai",
  "syncEnabled": false,
  "pollInterval": 2000
}
EOF

# 5. Update plugin.json
cat > "$COWORK_DIR/.claude-plugin/plugin.json" << EOF
{
  "name": "memforge-client",
  "version": "1.0.0",
  "description": "MemForge - Persistent semantic memory for Claude (Pre-configured)"
}
EOF

# 6. Remove sync directory (not needed for Cowork)
rm -rf "$COWORK_DIR/src/sync"

# 7. Create ZIP
cd "$COWORK_DIR"
zip -r /Users/itarun/memforge-client-cowork.zip .
```

### Cowork Package Contents

```
memforge-client-cowork.zip/
├── .claude-plugin/
│   ├── plugin.json
│   ├── hooks/hooks.json
│   └── CLAUDE.md
├── .mcp.json
├── config.local.json      # ⭐ Embedded API key
├── package.json
├── tsconfig.json
└── src/mcp/               # MCP tools only (no sync)
```

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

### Test Sync

```bash
curl -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: KEY" \
  https://memclaude.thaicloud.ai/api/sync/push \
  -d '{"observations": [{"id": 1, "type": "test", "title": "Test", ...}]}'
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
cat config.local.json | jq .syncEnabled

# Test sync manually
bun run sync
```

### API Key Rejected

```bash
# Verify key on server
ssh itarun@***REMOVED*** 'cat ***REMOVED***'

# Restart worker if needed
ssh itarun@***REMOVED*** 'cd ***REMOVED*** && docker compose restart worker'
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

### Claude Cowork Release

- [ ] Generate new API key if needed
- [ ] Add key to production server
- [ ] Build ZIP: `./scripts/build-cowork.sh "API-KEY"`
- [ ] Test upload to Cowork
- [ ] Verify MCP tools work
- [ ] Update release notes

---

## Contacts

- **Repository**: https://github.com/pitimon/c-memforge
- **Server**: memclaude.thaicloud.ai
- **Production SSH**: itarun@***REMOVED***
- **Test SSH**: itarun@***REMOVED***
