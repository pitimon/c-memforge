# Changelog

All notable changes to the MemForge client plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.10.1] - 2026-06-13

### Fixed

- **Windows: MCP server failed to start** ([#71](https://github.com/pitimon/c-memforge/issues/71)).
  `.mcp.json` launched the server via `"command": "sh"` + a POSIX one-liner, but
  `sh` is not on `PATH` on Windows (no Git Bash) → Claude Code spawn failed with
  `ENOENT` before any bun code ran. The claude-mem→memforge sync was unaffected
  because it launches `bun` directly. Replaced the `sh` launcher with an inline
  `bun -e` resolver that reads `CLAUDE_PLUGIN_ROOT`/`PLUGIN_ROOT` at runtime,
  probes the plugin cache cross-platform, and imports the server in-process.
  Works on Claude Code and Codex (shared `.mcp.json`) across macOS, Linux, Windows.
- **`process.env.HOME` undefined on Windows** (`src/mcp/api-client.ts`). The
  claude-mem settings fallback path now uses `os.homedir()` (`USERPROFILE`-aware).
- **`postinstall` was POSIX-only and swallowed failure** (`mkdir -p … || true`).
  Replaced with a cross-platform `node` one-liner that creates `~/.memforge` and
  surfaces real errors instead of hiding them.

### Documentation

- Added Windows prerequisites (PowerShell bun install, `PATH` check) and a
  Windows first-run dependency-install path to the README troubleshooting guide.
