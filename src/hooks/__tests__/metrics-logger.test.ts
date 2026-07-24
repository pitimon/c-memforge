/**
 * Tests for Wave A hook telemetry (metrics-logger).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildMetricRecord,
  resolveMetricsPath,
  metricsEnabled,
  appendMetric,
  type MetricInput,
} from "../metrics-logger";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function baseInput(overrides: Partial<MetricInput> = {}): MetricInput {
  return {
    now: NOW,
    project: "memforge",
    mode: "pointer",
    additionalContext: "",
    hasHandoff: false,
    handoffAgeDays: null,
    openLoops: 0,
    nextSteps: 0,
    hasCrossProject: false,
    resumeOk: true,
    crossOk: true,
    resumeMs: 200,
    crossMs: 300,
    totalMs: 320,
    ...overrides,
  };
}

describe("buildMetricRecord", () => {
  test("emitted=false + zero tokens when additionalContext is empty", () => {
    const rec = buildMetricRecord(baseInput({ additionalContext: "" }));
    expect(rec.emitted).toBe(false);
    expect(rec.chars).toBe(0);
    expect(rec.tokens_est).toBe(0);
  });

  test("emitted=true + token estimate rounds up chars/4", () => {
    const rec = buildMetricRecord(
      baseInput({ additionalContext: "x".repeat(10) }),
    );
    expect(rec.emitted).toBe(true);
    expect(rec.chars).toBe(10);
    expect(rec.tokens_est).toBe(3); // ceil(10/4)
  });

  test("passes through handoff / cross-project facts", () => {
    const rec = buildMetricRecord(
      baseInput({
        additionalContext: "pointer",
        hasHandoff: true,
        handoffAgeDays: 2,
        openLoops: 3,
        nextSteps: 4,
        hasCrossProject: true,
      }),
    );
    expect(rec.has_handoff).toBe(true);
    expect(rec.handoff_age_days).toBe(2);
    expect(rec.open_loops).toBe(3);
    expect(rec.next_steps).toBe(4);
    expect(rec.has_cross_project).toBe(true);
  });

  test("ts is derived from the injected now (no wall-clock dependency)", () => {
    const rec = buildMetricRecord(baseInput());
    expect(rec.ts).toBe("2026-07-24T12:00:00.000Z");
  });

  test("error is truncated to 200 chars and omitted when absent", () => {
    const clean = buildMetricRecord(baseInput());
    expect(clean.error).toBeUndefined();
    const noisy = buildMetricRecord(
      baseInput({ error: "e".repeat(500) }),
    );
    expect(noisy.error?.length).toBe(200);
  });
});

describe("resolveMetricsPath", () => {
  test("MEMFORGE_METRICS_FILE wins", () => {
    expect(resolveMetricsPath({ MEMFORGE_METRICS_FILE: "/tmp/m.jsonl" })).toBe(
      "/tmp/m.jsonl",
    );
  });

  test("falls back to CLAUDE_CONFIG_DIR", () => {
    expect(resolveMetricsPath({ CLAUDE_CONFIG_DIR: "/cfg" })).toBe(
      join("/cfg", "c-memforge-metrics.jsonl"),
    );
  });

  test("defaults under ~/.claude", () => {
    const p = resolveMetricsPath({});
    expect(p.endsWith(join(".claude", "c-memforge-metrics.jsonl"))).toBe(true);
  });
});

describe("metricsEnabled", () => {
  test("disabled only when explicitly '0'", () => {
    expect(metricsEnabled({ MEMFORGE_METRICS: "0" })).toBe(false);
    expect(metricsEnabled({ MEMFORGE_METRICS: "1" })).toBe(true);
    expect(metricsEnabled({})).toBe(true);
  });
});

describe("appendMetric", () => {
  const tmpFile = join(tmpdir(), `cmemforge-metrics-test-${process.pid}.jsonl`);

  afterEach(() => {
    if (existsSync(tmpFile)) rmSync(tmpFile);
  });

  test("appends one JSON line per call", () => {
    const rec = buildMetricRecord(baseInput({ additionalContext: "abc" }));
    appendMetric(rec, tmpFile);
    appendMetric(rec, tmpFile);
    const lines = readFileSync(tmpFile, "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).chars).toBe(3);
  });

  test("fail-open: unwritable path does not throw", () => {
    const rec = buildMetricRecord(baseInput());
    expect(() =>
      appendMetric(rec, "/nonexistent-dir-xyz/deep/metrics.jsonl"),
    ).not.toThrow();
  });
});
