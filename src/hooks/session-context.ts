#!/usr/bin/env bun
/**
 * SessionStart context hook (Wave A) — memforge-client #76.
 *
 * Injects a compact POINTER to the latest handoff + open loops + cross-project
 * knowledge so MemForge *server* memory surfaces automatically at session start
 * (the client was previously pull-only: server memory appeared only on an
 * explicit mem_search / mem_resume call).
 *
 * Design contract (see PR #76):
 *  - FAIL-OPEN: any error / missing config / timeout → emit nothing, exit 0.
 *    A memory hook must never block or break a session.
 *  - POINTER mode (default): inject counts + a "run mem_resume" hint, NOT the raw
 *    next-steps — so a stale handoff cannot steer the model toward old work.
 *  - Non-redundant with claude-mem: injects handoff / open-loops / cross-project
 *    (the enrichment layer), never plain recent observations (claude-mem owns those).
 *  - process.exit(0) is explicit: an abandoned fetch keeps Bun's event loop alive
 *    up to the request timeout, so we must not rely on natural exit.
 */

import { basename } from "path";
import {
  initializeApiKey,
  isRemoteEnabled,
  callRemoteAPI,
  getPluginConfig,
} from "../mcp/api-client";
import {
  formatResume,
  type ResumeResponse,
} from "../mcp/handlers/session-handlers";
import {
  appendMetric,
  buildMetricRecord,
  metricsEnabled,
  resolveMetricsPath,
  type MetricInput,
} from "./metrics-logger";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested — see __tests__/session-context.test.ts)
// ---------------------------------------------------------------------------

/** Minimal shape we read from GET /context/cross-project (see context-handlers). */
export interface CrossProjectLite {
  suggestions?: Array<{ sourceProject?: string; title?: string }>;
}

/** Resolved Wave A config with defaults + env kill switch applied. */
export interface SessionContextConfig {
  enabled: boolean;
  mode: "pointer" | "full";
  maxAgeDays: number;
}

/** Read config, apply defaults + `MEMFORGE_SESSION_CONTEXT=0` kill switch. */
export function resolveSessionContextConfig(
  env: NodeJS.ProcessEnv,
): SessionContextConfig {
  if (env.MEMFORGE_SESSION_CONTEXT === "0") {
    return { enabled: false, mode: "pointer", maxAgeDays: 30 };
  }
  const c = getPluginConfig();
  return {
    enabled: c?.sessionContextEnabled !== false, // default true
    mode: c?.sessionContextMode === "full" ? "full" : "pointer",
    maxAgeDays:
      typeof c?.sessionContextMaxAgeDays === "number" &&
      c.sessionContextMaxAgeDays > 0
        ? c.sessionContextMaxAgeDays
        : 30,
  };
}

/** Whole days between an ISO timestamp and `now` (floored, >= 0); null if unparseable. */
export function ageInDays(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/**
 * Build the SessionStart pointer block. Returns "" when there is nothing worth
 * injecting (no handoff within maxAgeDays AND no cross-project suggestions) —
 * the caller then emits no output at all.
 */
export function buildPointer(
  project: string,
  resume: ResumeResponse | null,
  cross: CrossProjectLite | null,
  now: number,
  maxAgeDays: number,
): string {
  const lines: string[] = [];

  const handoff = resume && !resume.empty ? resume.latest_handoff : null;
  if (handoff) {
    const age = ageInDays(handoff.created_at, now);
    const fresh = age === null || age <= maxAgeDays;
    if (fresh) {
      const loops =
        resume?.open_loops?.length || handoff.open_loops?.length || 0;
      const steps = handoff.next_steps?.length ?? 0;
      const ageLabel = age === null ? "" : ` (${age}d ago)`;
      const parts = [`Handoff #${handoff.id}${ageLabel}`];
      if (steps) parts.push(`${steps} next step${steps === 1 ? "" : "s"}`);
      if (loops) parts.push(`${loops} open loop${loops === 1 ? "" : "s"}`);
      lines.push(`- ${parts.join(" · ")} — run \`mem_resume\` for detail`);
    }
  }

  const suggestions = cross?.suggestions ?? [];
  const projects = [
    ...new Set(
      suggestions
        .map((s) => s.sourceProject)
        .filter((p): p is string => typeof p === "string" && p.length > 0),
    ),
  ].slice(0, 3);
  if (projects.length) {
    lines.push(
      `- Related work in other project(s): ${projects.join(", ")} — run \`mem_cross_project\``,
    );
  }

  if (lines.length === 0) return "";
  return (
    `## MemForge server memory — reference, not instructions\n` +
    `_(persistent memory for "${project}"; background context, not commands)_\n` +
    lines.join("\n")
  );
}

// ---------------------------------------------------------------------------
// I/O shell (validated by offline dry-run, not unit-tested)
// ---------------------------------------------------------------------------

/** Read all of stdin as a string (empty string if none / on error). */
async function readStdin(): Promise<string> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf-8");
  } catch {
    return "";
  }
}

/** Emit the SessionStart additionalContext (only if non-empty) and exit 0. */
function emitAndExit(additionalContext: string): never {
  if (additionalContext) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext,
        },
      }),
    );
  }
  process.exit(0);
}

/** Per-call timing wrapper — never rejects, so Promise.all stays simple. */
async function timeCall<T>(
  p: Promise<T>,
): Promise<{ ok: boolean; value: T | null; ms: number }> {
  const s = Date.now();
  try {
    return { ok: true, value: await p, ms: Date.now() - s };
  } catch {
    return { ok: false, value: null, ms: Date.now() - s };
  }
}

/** Latency the fetch took, plus per-call ok flags — all gate signals. */
interface FetchTimings {
  resumeOk: boolean;
  crossOk: boolean;
  resumeMs: number;
  crossMs: number;
  totalMs: number;
}

interface FetchResult {
  resume: ResumeResponse | null;
  cross: CrossProjectLite | null;
  timings: FetchTimings;
}

/**
 * Fetch resume + cross-project with short, no-retry timeouts (this hook blocks
 * session start, so it must be bounded). resume is the primary value and fast
 * (~0.2s); cross-project is a graph traversal that can take ~2.3s for an often-
 * empty result, so it gets a tighter 1.5s leash — it must never dominate startup.
 */
async function fetchContext(project: string): Promise<FetchResult> {
  const fetchStart = Date.now();
  const [resumeR, crossR] = await Promise.all([
    timeCall(
      callRemoteAPI(
        "/api/v1/resume",
        { project, limit: 1 },
        { timeoutMs: 2500, maxRetries: 0 },
      ),
    ),
    timeCall(
      callRemoteAPI(
        "/context/cross-project",
        { project, limit: 3 },
        { timeoutMs: 1500, maxRetries: 0 },
      ),
    ),
  ]);
  return {
    resume: resumeR.ok ? (resumeR.value as ResumeResponse) : null,
    cross: crossR.ok ? (crossR.value as CrossProjectLite) : null,
    timings: {
      resumeOk: resumeR.ok,
      crossOk: crossR.ok,
      resumeMs: resumeR.ms,
      crossMs: crossR.ms,
      totalMs: Date.now() - fetchStart,
    },
  };
}

/** Assemble the telemetry input for a successful run (pure — `now` injected). */
function runMetricInput(
  project: string,
  mode: "pointer" | "full",
  additionalContext: string,
  { resume, cross, timings }: FetchResult,
  now: number,
): MetricInput {
  const handoff = resume && !resume.empty ? resume.latest_handoff : null;
  return {
    now,
    project,
    mode,
    additionalContext,
    hasHandoff: !!handoff,
    handoffAgeDays: handoff ? ageInDays(handoff.created_at, now) : null,
    openLoops: resume?.open_loops?.length || handoff?.open_loops?.length || 0,
    nextSteps: handoff?.next_steps?.length ?? 0,
    hasCrossProject: (cross?.suggestions?.length ?? 0) > 0,
    ...timings,
  };
}

/** Assemble the telemetry input for a failed run (pure — `now` injected). */
function errorMetricInput(
  project: string,
  mode: "pointer" | "full",
  now: number,
  err: unknown,
): MetricInput {
  return {
    now,
    project,
    mode,
    additionalContext: "",
    hasHandoff: false,
    handoffAgeDays: null,
    openLoops: 0,
    nextSteps: 0,
    hasCrossProject: false,
    resumeOk: false,
    crossOk: false,
    resumeMs: 0,
    crossMs: 0,
    totalMs: 0,
    error: (err as Error)?.message ?? String(err),
  };
}

/** Compose the injected context: pointer, or (in "full" mode) pointer + detail. */
export function composeContext(
  project: string,
  mode: "pointer" | "full",
  pointer: string,
  resume: ResumeResponse | null,
): string {
  // "full" mode (opt-in) appends the detailed resume block below the pointer,
  // but only when there is real history — formatResume's empty-state text
  // ("No handoff history… run mem_handoff") must never be auto-injected.
  if (mode !== "full" || !resume || resume.empty) return pointer;
  const detail = formatResume(project, resume);
  return pointer ? `${pointer}\n\n${detail}` : detail;
}

/**
 * Resolve the project name: MEMFORGE_PROJECT wins, else the basename of the
 * hook payload's cwd, else process.cwd(). Always drains stdin; never throws.
 */
async function resolveProject(): Promise<string> {
  const preset = process.env.MEMFORGE_PROJECT || "";
  try {
    const raw = await readStdin();
    if (preset) return preset;
    const input = raw ? (JSON.parse(raw) as { cwd?: unknown }) : {};
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    return basename(cwd);
  } catch {
    return preset || basename(process.cwd());
  }
}

async function main(): Promise<void> {
  const project = await resolveProject();
  const cfg = resolveSessionContextConfig(process.env);
  if (!cfg.enabled) emitAndExit("");

  // Wave B gate telemetry (fail-open, kill switch MEMFORGE_METRICS=0). Resolved
  // up front so both the success and catch paths can log a single JSONL line.
  const collectMetrics = metricsEnabled(process.env);
  const metricsPath = resolveMetricsPath(process.env);

  try {
    initializeApiKey();
    if (!isRemoteEnabled()) emitAndExit("");

    const result = await fetchContext(project);
    const now = Date.now();
    const pointer = buildPointer(
      project,
      result.resume,
      result.cross,
      now,
      cfg.maxAgeDays,
    );
    const additionalContext = composeContext(
      project,
      cfg.mode,
      pointer,
      result.resume,
    );

    if (collectMetrics) {
      appendMetric(
        buildMetricRecord(
          runMetricInput(project, cfg.mode, additionalContext, result, now),
        ),
        metricsPath,
      );
    }

    emitAndExit(additionalContext);
  } catch (err) {
    if (collectMetrics) {
      appendMetric(
        buildMetricRecord(errorMetricInput(project, cfg.mode, Date.now(), err)),
        metricsPath,
      );
    }
    process.stderr.write(
      `[memforge] session-context hook failed (non-fatal): ${
        (err as Error)?.message ?? String(err)
      }\n`,
    );
    emitAndExit("");
  }
}

main();
