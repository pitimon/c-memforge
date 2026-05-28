/**
 * Tests for the JSONL token-usage parser (Phase 3, memforge ADR-003).
 *
 * Builds a temp ~/.claude-style projects tree with synthetic JSONL lines and
 * asserts per-(date, model) aggregation, the corruption guard, dedup, and the
 * camelCase output boundary. Pure fs — no network, no real Claude data.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { aggregateUsage, resolveProjectDirs } from "../jsonl-parser";

let root: string;
let env: Record<string, string | undefined>;

/** Build a usage line (Anthropic SDK shape). */
function line(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: "2026-05-29T10:00:00.000Z",
    requestId: `req-${Math.round(Number(over.__seq ?? 0))}`,
    message: {
      id: `msg-${Math.round(Number(over.__seq ?? 0))}`,
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 5000,
      },
    },
    ...over,
  });
}

function writeSession(project: string, file: string, lines: string[]): void {
  const dir = join(root, ".claude", "projects", project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), lines.join("\n"));
}

describe("aggregateUsage", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cmf-jsonl-"));
    env = { CLAUDE_CONFIG_DIR: join(root, ".claude") };
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("aggregates token usage per (date, model)", () => {
    writeSession("proj-a", "s1.jsonl", [
      line({ __seq: 1 }),
      line({ __seq: 2 }),
    ]);
    const { rows } = aggregateUsage({ env });
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({
      date: "2026-05-29",
      model: "claude-sonnet-4-6",
      inputTokens: 200, // 100 + 100
      outputTokens: 100,
      cacheCreationTokens: 400,
      cacheReadTokens: 10000,
    });
  });

  test("renames cache_*_input_tokens → cache*Tokens at the boundary", () => {
    writeSession("p", "s.jsonl", [line({ __seq: 1 })]);
    const { rows } = aggregateUsage({ env });
    expect(rows[0].cacheCreationTokens).toBe(200);
    expect(rows[0].cacheReadTokens).toBe(5000);
  });

  test("splits aggregation across models and dates", () => {
    writeSession("p", "s.jsonl", [
      line({ __seq: 1 }),
      line({
        __seq: 2,
        message: {
          id: "m2",
          model: "claude-opus-4-7",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }),
      line({ __seq: 3, timestamp: "2026-05-28T10:00:00.000Z" }),
    ]);
    const { rows } = aggregateUsage({ env });
    // (05-28, sonnet), (05-29, opus), (05-29, sonnet) = 3 rows
    expect(rows.length).toBe(3);
    const sonnet29 = rows.find(
      (r) => r.date === "2026-05-29" && r.model === "claude-sonnet-4-6",
    );
    expect(sonnet29?.inputTokens).toBe(100);
  });

  test("skips lines without a usage block (prefilter)", () => {
    writeSession("p", "s.jsonl", [
      JSON.stringify({ type: "user", text: "hello" }),
      line({ __seq: 1 }),
    ]);
    const { rows } = aggregateUsage({ env });
    expect(rows.length).toBe(1);
    expect(rows[0].inputTokens).toBe(100);
  });

  test("skips corrupt lines (null in sensitive field) without aborting file", () => {
    writeSession("p", "s.jsonl", [
      '{"requestId":null,"message":{"usage":{"input_tokens":1}}}',
      line({ __seq: 1 }),
    ]);
    const { rows, linesSkipped } = aggregateUsage({ env });
    expect(linesSkipped).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBe(1); // the good line still parsed
  });

  test("skips malformed JSON without throwing", () => {
    writeSession("p", "s.jsonl", [
      '{"message":{"usage":{ broken json',
      line({ __seq: 1 }),
    ]);
    const { rows } = aggregateUsage({ env });
    expect(rows.length).toBe(1);
  });

  test("dedups by (messageId, requestId) — same message counted once", () => {
    const dup = line({ __seq: 7 });
    writeSession("p", "s.jsonl", [dup, dup]); // identical msg-7/req-7
    const { rows } = aggregateUsage({ env });
    expect(rows[0].inputTokens).toBe(100); // NOT 200
  });

  test("skips <synthetic> model", () => {
    writeSession("p", "s.jsonl", [
      line({
        __seq: 1,
        message: { id: "m", model: "<synthetic>", usage: { input_tokens: 1 } },
      }),
    ]);
    const { rows } = aggregateUsage({ env });
    expect(rows.length).toBe(0);
  });

  test("since filter excludes older days", () => {
    writeSession("p", "s.jsonl", [
      line({ __seq: 1, timestamp: "2026-05-20T10:00:00.000Z" }),
      line({ __seq: 2, timestamp: "2026-05-29T10:00:00.000Z" }),
    ]);
    const { rows } = aggregateUsage({ env, since: "2026-05-25" });
    expect(rows.length).toBe(1);
    expect(rows[0].date).toBe("2026-05-29");
  });

  test("tz override buckets by the given timezone (ccusage parity)", () => {
    // 2026-05-28T19:00Z = 2026-05-29 02:00 in Asia/Bangkok (UTC+7).
    writeSession("p", "s.jsonl", [
      line({ __seq: 1, timestamp: "2026-05-28T19:00:00.000Z" }),
    ]);
    const utc = aggregateUsage({ env, tz: "UTC" });
    expect(utc.rows[0].date).toBe("2026-05-28");
    const bkk = aggregateUsage({ env, tz: "Asia/Bangkok" });
    expect(bkk.rows[0].date).toBe("2026-05-29"); // crosses local midnight
  });

  test("missing projects dir → empty result, no throw", () => {
    const { rows, filesScanned } = aggregateUsage({
      env: { CLAUDE_CONFIG_DIR: join(root, "does-not-exist") },
    });
    expect(rows).toEqual([]);
    expect(filesScanned).toBe(0);
  });
});

describe("resolveProjectDirs", () => {
  test("uses CLAUDE_CONFIG_DIR (comma-separated) when set", () => {
    const dirs = resolveProjectDirs({ CLAUDE_CONFIG_DIR: "/a,/b" });
    expect(dirs).toEqual([join("/a", "projects"), join("/b", "projects")]);
  });

  test("falls back to ~/.claude/projects when unset", () => {
    const dirs = resolveProjectDirs({});
    expect(dirs.length).toBe(1);
    expect(dirs[0].endsWith(join(".claude", "projects"))).toBe(true);
  });
});
