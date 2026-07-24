#!/usr/bin/env bun
/**
 * Aggregate Wave A hook telemetry for the Wave B go/no-go gate.
 *
 * Usage:  bun scripts/wave-metrics-report.ts [path-to-metrics.jsonl]
 * Default path resolves the same way the hook writes it
 * (MEMFORGE_METRICS_FILE → CLAUDE_CONFIG_DIR → ~/.claude/c-memforge-metrics.jsonl).
 *
 * Reports the objective gate signals; the behavioral "usefulness" signal is a
 * manual tally kept alongside (see CHANGELOG 2.13.0 / issue #76).
 */

import { readFileSync } from "fs";
import { resolveMetricsPath, type MetricRecord } from "../src/hooks/metrics-logger";

const path = process.argv[2] || resolveMetricsPath(process.env);

let raw: string;
try {
  raw = readFileSync(path, "utf-8");
} catch {
  console.error(`No metrics file at ${path} — hook has not run yet (or metrics disabled).`);
  process.exit(1);
}

const recs: MetricRecord[] = raw
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l) as MetricRecord;
    } catch {
      return null;
    }
  })
  .filter((r): r is MetricRecord => r !== null);

const n = recs.length;
if (n === 0) {
  console.error(`Metrics file ${path} has no parseable records yet.`);
  process.exit(1);
}

const pct = (arr: number[], p: number): number =>
  arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))]! : 0;

const emitted = recs.filter((r) => r.emitted);
const errors = recs.filter((r) => r.error).length;
const withHandoff = recs.filter((r) => r.has_handoff).length;
const withCross = recs.filter((r) => r.has_cross_project).length;
const tokens = emitted.map((r) => r.tokens_est).sort((a, b) => a - b);
const totalMs = recs.map((r) => r.total_ms).sort((a, b) => a - b);
const projects = new Set(recs.map((r) => r.project));

const rate = (k: number) => `${((100 * k) / n).toFixed(0)}% (${k}/${n})`;

console.log(`Wave A hook telemetry — ${path}`);
console.log(`  runs=${n}  projects=${projects.size}  errors=${errors}`);
console.log(`  emission_rate = ${rate(emitted.length)}`);
console.log(`  with_handoff  = ${rate(withHandoff)}`);
console.log(`  with_cross    = ${rate(withCross)}`);
console.log(
  `  pointer_tokens (emitted only): p50=${pct(tokens, 0.5)} p90=${pct(tokens, 0.9)} max=${tokens[tokens.length - 1] ?? 0}`,
);
console.log(
  `  total_ms: p50=${pct(totalMs, 0.5)} p90=${pct(totalMs, 0.9)} max=${totalMs[totalMs.length - 1] ?? 0}`,
);
console.log("");
console.log("Gate read: low emission_rate OR pointer already covers the need → Wave B likely unnecessary.");
console.log("           frequent emission BUT residual per-prompt gaps (manual tally) → build Wave B.");
