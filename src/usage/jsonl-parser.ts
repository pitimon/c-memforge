/**
 * Claude Code JSONL token-usage parser (Phase 3, memforge ADR-003).
 *
 * Reads Claude Code session transcripts from ~/.claude/projects/<proj>/*.jsonl
 * and aggregates real per-(date, model) token usage. Pure TypeScript, ZERO
 * runtime dependencies (node:fs / os / path only) — the c-memforge machine does
 * NOT need `ccusage` installed.
 *
 * Logic ported from ryoppippi/ccusage (MIT) — see memforge
 * reports/research-ccusage-architecture-2026-05-28.md (verified citations):
 *   - byte-substring prefilter `"usage":{` before JSON.parse (skip ~95% lines)
 *   - 11-field null-skip corruption guard
 *   - dedup by (messageId, requestId) — sidechain replays reuse messageId
 *   - skip-on-failure per line (one bad line never aborts a file)
 *
 * Aggregation is keyed (date, model). The server endpoint POST /api/usage/tokens
 * UPSERTs with replace semantics, so a full re-scan each run is idempotent —
 * no watermark / byte-offset state needed (ADR-003 §Idempotency over watermarks).
 */

import { closeSync, openSync, readdirSync, readSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Minimal env shape — avoids depending on the NodeJS namespace under bun-types. */
type EnvLike = Record<string, string | undefined>;

/** One aggregated row, ready for POST /api/usage/tokens (camelCase boundary). */
export interface DailyUsageRow {
  date: string; // YYYY-MM-DD (UTC by default; see dateKey tz option)
  model: string; // e.g. "claude-sonnet-4-6"
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** Raw Anthropic SDK usage block as written in the JSONL line. */
interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface RawLine {
  timestamp?: string;
  requestId?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: RawUsage;
  };
}

/**
 * Fields whose presence as `null` marks a corrupted/partial JSONL write.
 * Ported verbatim from ccusage is_unsupported_nullable_field (mod.rs:316-332).
 */
const NULL_SKIP_FIELDS = [
  '"id":null',
  '"cwd":null',
  '"model":null',
  '"speed":null',
  '"costUSD":null',
  '"version":null',
  '"sessionId":null',
  '"requestId":null',
  '"isApiErrorMessage":null',
  '"cache_read_input_tokens":null',
  '"cache_creation_input_tokens":null',
];

/**
 * Resolve Claude Code config directories.
 * Order: CLAUDE_CONFIG_DIR (comma-separated) → ~/.claude. De-duplicated.
 */
export function resolveProjectDirs(env: EnvLike = process.env): string[] {
  const dirs = new Set<string>();
  const override = env.CLAUDE_CONFIG_DIR;
  if (override) {
    for (const d of override.split(",")) {
      const trimmed = d.trim();
      if (trimmed) dirs.add(join(trimmed, "projects"));
    }
  }
  if (dirs.size === 0) {
    dirs.add(join(homedir(), ".claude", "projects"));
  }
  return [...dirs];
}

/** Recursively collect *.jsonl files under a directory. Missing dir → []. */
function collectJsonlFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // missing / unreadable dir — skip silently (new user)
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectJsonlFiles(full));
    } else if (name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

/** Read buffer size. 64 KiB is a page-friendly default; override only in tests. */
const DEFAULT_CHUNK_BYTES = 64 * 1024;

/**
 * Upper bound on a caller-supplied `chunkBytes`. Past this the buffer is itself
 * the memory problem this module exists to avoid, so an over-large value is
 * rejected rather than honoured.
 */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Reject a read size that cannot do the job, loudly.
 *
 * `chunkBytes: 0` is the case worth the noise: `readSync` into a zero-length
 * buffer returns 0, which `readLines` cannot distinguish from end-of-file, so
 * EVERY file would read as empty and `aggregateUsage` would return `rows: []`
 * with no error and no `linesSkipped` — a wrong answer wearing the shape of a
 * right one. Throwing is safe for the production path: the only caller,
 * `usage-sync.ts:49`, passes no `chunkBytes` at all.
 */
function assertChunkBytes(n: number): number {
  const size = Math.floor(n);
  if (!Number.isFinite(n) || size < 1 || size > MAX_CHUNK_BYTES) {
    throw new RangeError(
      `aggregateUsage: chunkBytes must be a finite number in [1, ${MAX_CHUNK_BYTES}] ` +
        `(fractional values are floored), got ${n}`,
    );
  }
  return size;
}

/**
 * Yield a file's lines without materialising it.
 *
 * On a file that is read start-to-finish without error, emits exactly the
 * sequence `readFileSync(file,"utf-8").split("\n")` would, so per-line callers
 * need no change — but live bytes are bounded by `buf.length` plus the longest
 * single line rather than by the file size. The previous `readFileSync` +
 * `split("\n")` held BOTH full copies simultaneously, which on this author's
 * 130 MB transcript is ~260 MB of live heap for one file.
 *
 * Two documented divergences from that equivalence, both in the error direction:
 * a mid-read failure yields a PREFIX where `readFileSync` would have thrown and
 * yielded nothing (see the caller's note), and a file above `readFileSync`'s
 * string cap is readable here and was not before.
 *
 * Three details that are load-bearing, not incidental:
 *
 * 1. **`{stream:true}` across chunk boundaries.** A multi-byte codepoint split
 *    by a chunk edge must be carried, not decoded in halves. What per-chunk
 *    decoding actually costs is narrower than it looks, and worth stating
 *    precisely so the guard is not later removed as ceremony: the U+FFFD lands
 *    inside a JSON *string value* (bytes >= 0x80 cannot occur elsewhere in valid
 *    JSONL, and 0x0A never appears as a UTF-8 continuation byte, so line
 *    splitting is unaffected). `JSON.parse` therefore still SUCCEEDS and token
 *    totals are unchanged — measured across chunk sizes 1..90 on a
 *    Thai-plus-emoji line: 61 sizes produced U+FFFD, 0 parse failures, 0 wrong
 *    totals. What breaks is the equivalence above: the emitted line is not what
 *    `readFileSync` produced. The one path where that becomes a data defect is
 *    the dedup key — `(message.id, requestId)` — which corrupts under 16 of
 *    those 90 sizes IF either field is non-ASCII, double-counting the row.
 *    Today both are ASCII (`msg_01…`, `req_…`), so this is a guard against a
 *    format change, not a bug being fixed. Covered by "utf-8 codepoint
 *    straddling a chunk boundary".
 * 2. **`ignoreBOM: true`.** Despite the name, this is what makes a BOM appear in
 *    the output — the default (`false`) silently strips it. `readFileSync` does
 *    not strip it, so `true` is what preserves the old behaviour.
 * 3. **Splits on "\n" only.** A CRLF file keeps its trailing "\r", exactly as
 *    `split("\n")` left it.
 *
 * The buffer may be shared across concurrent generators, but the decoder may
 * not: `buf` is fully drained into `pending` before any `yield`, so a resumed
 * generator only ever touches string state — whereas a hoisted decoder would
 * carry a truncated codepoint from one file into the next file's first line,
 * which is the very bug this function exists to prevent, resurrected at file
 * granularity. Hence one decoder per call, one buffer per scan.
 *
 * @param buf caller-owned scratch buffer, reused across files — allocating one
 *   per file would trade a size problem for a churn problem. Must be non-empty.
 * @internal exported for tests. Consume it fully or via `for...of`, which runs
 *   the `finally` on `break`. A manually `.next()`-driven generator that is
 *   abandoned never runs `finally` and leaks its fd; enough of those yields
 *   EMFILE, which surfaces here as an unreadable file — i.e. a silent undercount.
 */
export function* readLines(file: string, buf: Buffer): Generator<string> {
  // Same trap as chunkBytes: readSync into an empty buffer returns 0, which is
  // indistinguishable from EOF, so the file would silently yield one empty line.
  if (buf.length === 0) {
    throw new RangeError("readLines: buf must be non-empty");
  }
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return; // unreadable file — skip (permission, race)
  }
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let pending = "";
  try {
    for (;;) {
      let n: number;
      try {
        n = readSync(fd, buf, 0, buf.length, null);
      } catch {
        return; // read error mid-file — keep what was already yielded
      }
      if (n === 0) break;
      pending += decoder.decode(buf.subarray(0, n), { stream: true });
      let start = 0;
      let nl: number;
      while ((nl = pending.indexOf("\n", start)) !== -1) {
        yield pending.slice(start, nl);
        start = nl + 1;
      }
      if (start > 0) pending = pending.slice(start);
    }
    pending += decoder.decode(); // flush a truncated trailing sequence
    yield pending; // final segment — split("\n") always produces one
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* already gone; nothing left to release */
    }
  }
}

/**
 * Derive a YYYY-MM-DD key from an ISO timestamp. Returns null if unparseable.
 *
 * Buckets by UTC by default. **UTC is deliberate**: the MemForge server's
 * Measured query (activity.ts) derives its date-range bounds from the UI window
 * in UTC, so client and server MUST agree on the day-labeling timezone — a
 * local-tz client + UTC server silently drops the current day for UTC+ users
 * (memforge ADR-003 review, 2026-05-29). The aggregate over any multi-day
 * window is timezone-invariant; only single-day boundaries differ (an accepted
 * day-grain limitation). Verified byte-exact vs `ccusage --timezone UTC` for
 * opus/sonnet/haiku on real transcripts.
 *
 * An explicit `tz` (IANA, e.g. "Asia/Bangkok") overrides — pass the SAME tz to
 * the server's activity endpoint to keep both sides aligned at local-day grain.
 * en-CA locale renders as YYYY-MM-DD.
 */
function dateKey(ts: string | undefined, tz?: string): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  if (!tz) return d.toISOString().slice(0, 10); // UTC default
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz,
    }).format(d);
  } catch {
    // Invalid tz string → fall back to UTC slice (still deterministic).
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Parse all JSONL transcripts and aggregate token usage per (date, model).
 *
 * @param opts.since optional YYYY-MM-DD lower bound (inclusive) — skip older days
 * @param opts.tz   optional IANA timezone for day bucketing (default: system
 *                  local, matching `ccusage daily`). e.g. "UTC", "Asia/Bangkok"
 * @returns sorted array of DailyUsageRow (by date, then model)
 */
export function aggregateUsage(
  opts: {
    since?: string;
    env?: EnvLike;
    tz?: string;
    /** Read-buffer size. Tuning/testing knob; the default suits real corpora. */
    chunkBytes?: number;
  } = {},
): {
  rows: DailyUsageRow[];
  filesScanned: number;
  linesSkipped: number;
} {
  const {
    since,
    tz,
    env = process.env,
    chunkBytes = DEFAULT_CHUNK_BYTES,
  } = opts;
  const files = resolveProjectDirs(env).flatMap(collectJsonlFiles);

  // Aggregate keyed `${date}\0${model}`; dedup keyed `${messageId}\0${requestId}`.
  const agg = new Map<string, DailyUsageRow>();
  const seen = new Set<string>();
  let linesSkipped = 0;

  // One scratch buffer for the whole scan — see readLines' @param note.
  const readBuf = Buffer.alloc(assertChunkBytes(chunkBytes));

  for (const file of files) {
    // readLines yields NOTHING if the file cannot be opened, and yields a
    // PREFIX if a read fails partway through. The prefix case is new: the
    // previous readFileSync path was per-file atomic — a file was either fully
    // counted or fully dropped — and streaming cannot preserve that, because
    // the earlier lines are already merged into `agg` by the time the read
    // fails. Neither case is counted or reported anywhere; `filesScanned`
    // below is `files.length`, fixed at enumeration time, so a scan that read
    // one file of forty still reports forty. That undercount then goes to a
    // replace-semantics endpoint (`usage-sync.ts:6`), which overwrites the
    // server's correct row.
    //
    // NOT TRACKED YET — no issue is filed for this as of this commit; do not
    // read the paragraph above as an accepted-and-scheduled risk. It predates
    // streaming (readFileSync had the same unreported-drop shape, minus the
    // prefix) and fixing it needs a return-shape change plus a push policy —
    // "did this scan see everything?" has to reach usage-sync before it POSTs.
    for (const line of readLines(file, readBuf)) {
      // Hot-path prefilter: most lines have no usage block.
      if (line.indexOf('"usage":{') === -1) continue;
      // Corruption guard: skip lines with a null in any sensitive field.
      if (NULL_SKIP_FIELDS.some((f) => line.indexOf(f) !== -1)) {
        linesSkipped++;
        continue;
      }

      let parsed: RawLine;
      try {
        parsed = JSON.parse(line) as RawLine;
      } catch {
        linesSkipped++;
        continue; // malformed line — never abort the file
      }

      const usage = parsed.message?.usage;
      const model = parsed.message?.model;
      if (!usage || !model || model === "<synthetic>") {
        linesSkipped++;
        continue;
      }

      const date = dateKey(parsed.timestamp, tz);
      if (!date) {
        linesSkipped++;
        continue;
      }
      if (since && date < since) continue;

      // Dedup: (messageId, requestId). Sidechain replays reuse messageId, so
      // messageId alone is insufficient (ccusage usage_dedupe_hash).
      const msgId = parsed.message?.id ?? "";
      const reqId = parsed.requestId ?? "";
      if (msgId || reqId) {
        const dk = `${msgId}\0${reqId}`;
        if (seen.has(dk)) continue;
        seen.add(dk);
      }

      const key = `${date}\0${model}`;
      const row = agg.get(key) ?? {
        date,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      row.inputTokens += usage.input_tokens ?? 0;
      row.outputTokens += usage.output_tokens ?? 0;
      row.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      row.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      agg.set(key, row);
    }
  }

  const rows = [...agg.values()].sort((a, b) =>
    a.date === b.date
      ? a.model.localeCompare(b.model)
      : a.date.localeCompare(b.date),
  );

  return { rows, filesScanned: files.length, linesSkipped };
}
