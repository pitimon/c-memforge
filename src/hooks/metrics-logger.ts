#!/usr/bin/env bun
/**
 * Wave A hook telemetry — Wave B gate instrumentation (memforge-client #76).
 *
 * Appends ONE JSONL line per active SessionStart-hook run so we can measure,
 * over a real soak window, whether the Wave A pointer alone closes the passive-
 * memory gap (→ Wave B unnecessary) or leaves a residual gap (→ build Wave B).
 *
 * Gate signals captured: emission rate, injected token cost, which content
 * types fired (handoff / cross-project = the non-redundant-vs-claude-mem layer),
 * and fetch latency (validates the 2.5s/1.5s timeout budget).
 *
 * Contract: FAIL-OPEN, identical to the hook itself. Nothing here may throw,
 * block, or break a session — a telemetry failure is silently swallowed.
 * Kill switch: MEMFORGE_METRICS=0. Path override: MEMFORGE_METRICS_FILE.
 */

import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** One line of telemetry. Flat + JSON-serializable for easy aggregation. */
export interface MetricRecord {
  ts: string;
  project: string;
  mode: "pointer" | "full";
  emitted: boolean;
  chars: number;
  tokens_est: number;
  has_handoff: boolean;
  handoff_age_days: number | null;
  open_loops: number;
  next_steps: number;
  has_cross_project: boolean;
  resume_ok: boolean;
  cross_ok: boolean;
  resume_ms: number;
  cross_ms: number;
  total_ms: number;
  error?: string;
}

/** Resolved hook state fed into buildMetricRecord (keeps the builder pure). */
export interface MetricInput {
  now: number;
  project: string;
  mode: "pointer" | "full";
  additionalContext: string;
  hasHandoff: boolean;
  handoffAgeDays: number | null;
  openLoops: number;
  nextSteps: number;
  hasCrossProject: boolean;
  resumeOk: boolean;
  crossOk: boolean;
  resumeMs: number;
  crossMs: number;
  totalMs: number;
  error?: string;
}

/** Pure — build the metric record from resolved hook state (unit-tested). */
export function buildMetricRecord(input: MetricInput): MetricRecord {
  const chars = input.additionalContext.length;
  const rec: MetricRecord = {
    ts: new Date(input.now).toISOString(),
    project: input.project,
    mode: input.mode,
    emitted: chars > 0,
    chars,
    tokens_est: Math.ceil(chars / 4),
    has_handoff: input.hasHandoff,
    handoff_age_days: input.handoffAgeDays,
    open_loops: input.openLoops,
    next_steps: input.nextSteps,
    has_cross_project: input.hasCrossProject,
    resume_ok: input.resumeOk,
    cross_ok: input.crossOk,
    resume_ms: input.resumeMs,
    cross_ms: input.crossMs,
    total_ms: input.totalMs,
  };
  if (input.error) rec.error = input.error.slice(0, 200);
  return rec;
}

/** Resolve the metrics file path (env override → CLAUDE_CONFIG_DIR → ~/.claude). */
export function resolveMetricsPath(env: NodeJS.ProcessEnv): string {
  if (env.MEMFORGE_METRICS_FILE) return env.MEMFORGE_METRICS_FILE;
  const base = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(base, "c-memforge-metrics.jsonl");
}

/** True unless the metrics kill switch (MEMFORGE_METRICS=0) is set. */
export function metricsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.MEMFORGE_METRICS !== "0";
}

/** Fail-open append of one JSONL line. Never throws. */
export function appendMetric(record: MetricRecord, path: string): void {
  try {
    appendFileSync(path, JSON.stringify(record) + "\n");
  } catch {
    // Telemetry must never break the hook.
  }
}
