# Changelog

All notable changes to the MemForge client plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.11.0] - 2026-07-06

### Added

- **`mem_handoff` / `mem_resume` MCP tools** for cross-session continuity
  ([memforge#689](https://github.com/pitimon/memforge/issues/689)). `mem_handoff`
  writes a structured session handoff (`project`, `next_steps`, optional `context`
  and `open_loops`, optional `agent_id`/`agent_type`) via `POST /api/v1/handoff`.
  `mem_resume` fetches the latest handoff, open loops, prior handoff history, and
  the latest retrospective for a project via `GET /api/v1/resume`.
- **`/forward`, `/resume`, `/retrospective` commands**
  ([memforge#690](https://github.com/pitimon/memforge/issues/690)). `/forward`
  writes a handoff at the end of a session; `/resume` pulls handoff history at the
  start of the next one; `/retrospective` writes a first-person session
  retrospective into memforge via `mem_ingest`, with a **mandatory AI Diary +
  Honest Feedback** structure — the command refuses to submit if either section
  is missing or empty.
- New endpoint allowlist entries: `/api/v1/handoff`, `/api/v1/resume`.
- New Zod input-validation schemas for `mem_handoff` and `mem_resume`.
- `mem_resume` renders `latest_retrospective` per the pinned server shape
  `{id, created_at, title, narrative}` (title + a <= 300 char narrative excerpt).

### Requirements

- Requires **memforge server >= v1.20.0** for the `/api/v1/handoff` and
  `/api/v1/resume` endpoints. Using this client version against an older server
  will fail with 404s on both new tools.

## [2.10.2] - 2026-06-13

### Documentation

- **Corrected MCP tool count to 28** (was "27" in README and "16" in the plugin
  `CLAUDE.md`). Verified against `getAllTools()` — the 4 `mem_snapshot_*` tools
  are defined but server-side only, not exposed by this client.
- Added the missing tool groups to `.claude-plugin/CLAUDE.md` (temporal query,
  6 memory-curation tools, 5 SkillNet tools).
- Added a **"Try It — Example Prompts"** section to the README — copy-paste
  natural-language prompts grouped by feature (verify setup, search, cross-project,
  knowledge graph, skills, curation), each annotated with the tool it invokes.

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
