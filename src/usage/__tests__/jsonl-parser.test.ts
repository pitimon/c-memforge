/**
 * Tests for the JSONL token-usage parser (Phase 3, memforge ADR-003).
 *
 * Builds a temp ~/.claude-style projects tree with synthetic JSONL lines and
 * asserts per-(date, model) aggregation, the corruption guard, dedup, and the
 * camelCase output boundary. Pure fs — no network, no real Claude data.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { aggregateUsage, readLines, resolveProjectDirs } from "../jsonl-parser";

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

/** Drain readLines fully (`for...of` semantics, so `finally` runs). */
function drain(file: string, buf: Buffer = Buffer.alloc(64)): string[] {
  return [...readLines(file, buf)];
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

/**
 * Streaming-reader regression suite.
 *
 * `readLines` replaced `readFileSync(f,"utf-8").split("\n")`, so that expression
 * IS the contract — every case below asserts the new reader against it rather
 * than against a hand-written expectation. That makes *behavioural equivalence*
 * a checked claim.
 *
 * Two things it deliberately does NOT check, so nobody reads more into a green
 * run than it earns:
 *
 * - **Memory.** No assertion here observes heap or RSS. The ~795 MB -> ~276 MB
 *   figure in the PR was measured out-of-band on a frozen 401-file corpus; this
 *   suite would stay green if the bound regressed.
 * - **The refactor itself.** Because `readFileSync().split()` is the oracle,
 *   reverting `aggregateUsage` to it passes every test below. These guard the
 *   reader's behaviour, not its continued existence.
 *
 * The chunk-boundary cases guard a NARROWER failure than "wrong totals", and
 * the distinction is why they are written against the oracle rather than against
 * parsed output: a codepoint decoded in halves yields U+FFFD *inside a JSON
 * string value*, so `JSON.parse` still succeeds and token counts are unaffected.
 * What regresses is equivalence with `readFileSync`. The one case where that
 * turns into a data defect is a non-ASCII `message.id`/`requestId`, which would
 * corrupt the dedup key and double-count; both are ASCII today.
 */
describe("readLines (streaming)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cmf-stream-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Assert the reader reproduces readFileSync().split("\n") exactly. */
  function expectMatchesSplit(content: string, chunkBytes: number): void {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, content);
    const got = [...readLines(f, Buffer.alloc(chunkBytes))];
    expect(got).toEqual(readFileSync(f, "utf-8").split("\n"));
  }

  test("utf-8 codepoint straddling a chunk boundary (Thai, 3 bytes)", () => {
    // Sweep the pad length so the boundary lands on every byte of "ก" (E0 B8 81).
    for (let pad = 0; pad < 8; pad++) {
      expectMatchesSplit(`${"a".repeat(pad)}ก-tail\nsecond\n`, 8);
    }
  });

  test("utf-8 codepoint straddling a chunk boundary (emoji, 4 bytes)", () => {
    for (let pad = 0; pad < 8; pad++) {
      expectMatchesSplit(`${"a".repeat(pad)}🔥-tail\nsecond\n`, 8);
    }
  });

  test("a single line longer than the chunk", () => {
    expectMatchesSplit(`${"x".repeat(500)}\nshort\n`, 16);
  });

  test("file with no trailing newline", () => {
    expectMatchesSplit("alpha\nbeta", 4);
  });

  test("BOM is preserved, matching readFileSync (ignoreBOM:true)", () => {
    // TextDecoder's default (ignoreBOM:false) STRIPS the BOM; readFileSync does
    // not. Split at 4 so the flag, not luck, is what makes them agree.
    expectMatchesSplit("\uFEFFalpha\nbeta", 4);
  });

  test("CRLF keeps its carriage return, as split() left it", () => {
    expectMatchesSplit("alpha\r\nbeta\r\n", 4);
  });

  test("empty file", () => {
    expectMatchesSplit("", 8);
  });

  test("chunk boundary exactly on the newline", () => {
    expectMatchesSplit("abc\ndef\n", 4);
  });

  test("unreadable file yields nothing rather than throwing", () => {
    const got = [...readLines(join(dir, "does-not-exist.jsonl"), Buffer.alloc(8))];
    expect(got).toEqual([]);
  });
});

describe("aggregateUsage under a tiny read buffer", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cmf-jsonl-"));
    env = { CLAUDE_CONFIG_DIR: join(root, ".claude") };
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("multi-byte content aggregates identically at chunkBytes=8", () => {
    // A Thai cwd string is realistic: session paths carry non-ASCII in the wild.
    const lines = [
      line({ __seq: 1, cwd: "/บ้าน/โครงการ" }),
      line({ __seq: 2, cwd: "/บ้าน/โครงการ" }),
    ];
    writeSession("proj-utf8", "s1.jsonl", lines);
    const tiny = aggregateUsage({ env, chunkBytes: 8 });
    const normal = aggregateUsage({ env });
    expect(tiny.rows).toEqual(normal.rows);
    expect(tiny.linesSkipped).toBe(normal.linesSkipped);
    expect(tiny.rows[0].inputTokens).toBe(200);
  });
});

/**
 * Hostile values for the two knobs the streaming change introduced.
 *
 * `chunkBytes: 0` is the one that matters: readSync into a zero-length buffer
 * returns 0, readLines cannot tell that from EOF, so before validation every
 * file read as empty and aggregateUsage returned `rows: []` with no error and
 * no linesSkipped — the "false success" shape this repo's rules ban.
 *
 * They match the guard's MESSAGE, not just `RangeError`, and that is deliberate:
 * `Buffer.alloc` already throws RangeError for -1/NaN/Infinity/oversized on its
 * own, so a bare `toThrow(RangeError)` passed with the guard deleted for 5 of
 * these 6 values — it would have asserted Node's behaviour, not ours. Measured
 * on this file by replacing assertChunkBytes with a bare `Math.floor`:
 * 28 pass / 6 fail without the guard, 34 / 0 with it.
 */
describe("chunkBytes / buffer validation", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cmf-jsonl-"));
    env = { CLAUDE_CONFIG_DIR: join(root, ".claude") };
    writeSession("proj-v", "s1.jsonl", [line({ __seq: 1 })]);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("baseline: the fixture really does produce a row", () => {
    expect(aggregateUsage({ env }).rows.length).toBe(1);
  });

  for (const bad of [0, -1, 0.5, NaN, Infinity, 8 * 1024 * 1024 + 1]) {
    test(`chunkBytes=${bad} throws instead of silently returning no rows`, () => {
      expect(() => aggregateUsage({ env, chunkBytes: bad })).toThrow(
        /chunkBytes must be/,
      );
    });
  }

  test("a fractional but >=1 chunkBytes is floored, not rejected", () => {
    expect(aggregateUsage({ env, chunkBytes: 4.9 }).rows.length).toBe(1);
  });

  test("readLines rejects a zero-length buffer", () => {
    // Path need not exist — the guard is ordered before openSync on purpose, so
    // that a bad buffer cannot leak an fd. Uses a temp path rather than a real
    // machine file so the test states no dependency it does not have.
    expect(() =>
      drain(join(root, "nonexistent.jsonl"), Buffer.alloc(0)),
    ).toThrow(/buf must be non-empty/);
  });
});

/**
 * What a read failure looks like to the caller.
 *
 * `readFileSync` threw on any read error and `aggregateUsage`'s
 * `catch { continue }` dropped the whole file. Streaming cannot preserve that
 * atomicity: bytes already decoded have already been yielded. These pin the
 * resulting shape so the divergence is a recorded property, not a surprise.
 */
describe("readLines read failures", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cmf-readerr-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("open failure yields nothing and does not throw to the caller", () => {
    expect(drain(join(dir, "absent.jsonl"))).toEqual([]);
  });

  test("a read error after open yields nothing and does not throw", () => {
    // A directory opens successfully, then readSync fails with EISDIR — a real
    // errno path, no mocking. Stands in for EIO/EBADF mid-scan.
    expect(drain(dir)).toEqual([]);
  });
});
