# Changelog

All notable changes to the MemForge client plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.14.0] - 2026-07-25

### Added

- **Wave C — `/forward` nudge on compact**
  ([#79](https://github.com/pitimon/c-memforge/issues/79)). Wave A made the
  *read* path automatic (a handoff pointer injected at session start), but the
  *write* path stayed manual — the pointer is only as fresh as the last
  hand-written `/forward`. Wave C closes that loop.
  - **Why a nudge, not an auto-write**: a handoff's value is its LLM-written
    `next_steps` / `open_loops` summary, and a shell hook has no LLM. So instead
    of auto-writing a weak handoff, the hook nudges the *in-session model* — which
    has full context — to run `/forward` itself and produce the real summary.
  - **Channel**: reuses Wave A's proven SessionStart `additionalContext` path,
    gated on `source === "compact"`. Deliberately *not* `PreCompact`, whose
    model-visible injection is unconfirmed and which can block compaction.
  - **Gated** on three conditions: the `waveCEnabled` kill switch (default true),
    a compact-triggered session start, and a stale-or-missing handoff (a fresh
    handoff already covers "worth preserving", so the nudge stays quiet).
  - **Telemetry**: adds `nudge_emitted` to the existing metrics JSONL line (no new
    file), so nudge → `mem_handoff` follow-through is measurable by joining hook
    metrics with the MCP audit log.
  - **Fail-open**, identical to the rest of the hook — the nudge path can never
    throw or block a session.
  - **Known gap (deferred)**: v1 covers compact events only. A session that ends
    *without* compacting (user just closes the terminal) is not nudged —
    SessionStart has no "about to end" trigger outside compaction/clear/startup.

### Fixed

- **`.codex-plugin/plugin.json` version drift** — the Codex plugin manifest was
  left at `2.11.0` through the `2.12.0` and `2.13.0` releases (it had been bumped
  in lockstep up to `2.11.0`, then missed). It is now realigned and part of the
  release checklist: **four** manifests carry the version, not three
  (`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
  `.codex-plugin/plugin.json`).

## [2.13.0] - 2026-07-24

### Added

- **Wave A hook telemetry — Wave B go/no-go gate instrumentation**
  ([#76](https://github.com/pitimon/c-memforge/issues/76)). Wave B (per-prompt
  `UserPromptSubmit` RAG) is held behind a value-measurement gate: does the
  Wave A pointer *alone* close the passive-memory gap? The SessionStart hook now
  appends **one JSONL line per active run** so that question can be answered from
  real sessions instead of guesswork. Adds `src/hooks/metrics-logger.ts` and
  `scripts/wave-metrics-report.ts`.
  - **Signals captured**: emission rate (`emitted`), injected token cost
    (`chars` / `tokens_est`), which content types fired
    (`has_handoff` / `has_cross_project` — the non-redundant-vs-claude-mem
    layer), and fetch latency (`resume_ms` / `cross_ms` / `total_ms`, which
    validates the 2.5s / 1.5s timeout budget).
  - **Fail-open**, identical to the hook itself — a telemetry write failure is
    silently swallowed and never blocks or breaks a session.
  - **Kill switch** `MEMFORGE_METRICS=0`; path override `MEMFORGE_METRICS_FILE`
    (default `~/.claude/c-memforge-metrics.jsonl`, honoring `CLAUDE_CONFIG_DIR`).
  - Aggregate with `bun scripts/wave-metrics-report.ts` — prints emission rate,
    token percentiles, content-type breakdown, and latency percentiles. The
    behavioral "was the pointer useful" signal is a manual tally kept alongside.

## [2.12.0] - 2026-07-24

### Added

- **Proactive SessionStart context hook (Wave A)**
  ([#76](https://github.com/pitimon/c-memforge/issues/76)). The plugin was
  previously pull-only — server memory (handoff, open loops, cross-project)
  surfaced only when an MCP tool was explicitly called. A new `SessionStart`
  hook now injects a **compact pointer** at session start
  (`Handoff #N (2d ago) · 3 open loops — run mem_resume for detail`) so that
  continuity context is offered automatically. Reuses `callRemoteAPI` /
  `formatResume`; adds `src/hooks/session-context.ts`.
  - **Pointer mode (default)** injects counts + a hint, never the raw next-steps,
    so a stale handoff cannot steer the model toward old work. Set
    `sessionContextMode: "full"` to also inject the detailed resume block.
  - **Fail-open**: any error / missing config / timeout → nothing injected,
    exit 0. Never blocks or breaks a session.
  - **Non-redundant with claude-mem**: injects the enrichment layer
    (handoff / cross-project), never plain recent observations.
  - Config: `sessionContextEnabled` (default `true`), `sessionContextMode`
    (`"pointer"` | `"full"`, default `"pointer"`), `sessionContextMaxAgeDays`
    (default `30`). Kill switch: `MEMFORGE_SESSION_CONTEXT=0`.
  - Cross-project lookup gets a tighter 1.5s timeout so the graph traversal
    never dominates session-start latency; resume gets 2.5s.

### Changed

- **`callRemoteAPI` accepts optional per-call `{ timeoutMs, maxRetries }`**
  (backward-compatible — existing callers keep the 30s/60s + 2-retry defaults).
  Hooks pass a short timeout + `maxRetries: 0` to bound wall-clock.

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
