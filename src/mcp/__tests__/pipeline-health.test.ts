/**
 * Tests for pipeline health diagnosis.
 *
 * Verifies the 4-layer matrix that distinguishes upstream-of-sync failures
 * (Gap A: hooks not capturing) from sync failures (Gap B/C).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import {
  computePipelineHealth,
  renderPipelineHealth,
  type PipelineHealthInputs,
} from "../handlers/pipeline-health";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "memforge-pipeline-test-"));
}

function createObservationsDb(path: string): Database {
  const db = new Database(path);
  db.run(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )
  `);
  return db;
}

function insertObs(db: Database, id: number, ageSeconds: number): void {
  const epoch = Math.floor(Date.now() / 1000) - ageSeconds;
  db.run(
    "INSERT INTO observations (id, memory_session_id, project, type, title, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      "sess-1",
      "test",
      "discovery",
      `obs-${id}`,
      new Date(epoch * 1000).toISOString(),
      epoch,
    ],
  );
}

function writeTranscript(dir: string, name: string, ageSeconds: number): void {
  const path = join(dir, name);
  writeFileSync(path, '{"role":"user"}\n');
  const mtime = (Date.now() - ageSeconds * 1000) / 1000;
  utimesSync(path, mtime, mtime);
}

describe("computePipelineHealth", () => {
  let workDir: string;
  let dbPath: string;
  let watermarkPath: string;
  let transcriptsDir: string;

  beforeEach(() => {
    workDir = createTempDir();
    dbPath = join(workDir, "claude-mem.db");
    watermarkPath = join(workDir, "watermark.json");
    transcriptsDir = join(workDir, "projects");
    mkdirSync(transcriptsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("healthy state — all layers aligned, no gaps", async () => {
    const projDir = join(transcriptsDir, "-Users-test-project");
    mkdirSync(projDir);
    writeTranscript(projDir, "session-1.jsonl", 60); // 1min ago
    writeTranscript(projDir, "session-2.jsonl", 3600); // 1hr ago

    const db = createObservationsDb(dbPath);
    insertObs(db, 1, 60);
    insertObs(db, 2, 3600);
    db.close();

    writeFileSync(
      watermarkPath,
      JSON.stringify({
        lastObservationId: 2,
        lastSummaryId: 0,
        updatedAt: new Date().toISOString(),
      }),
    );

    const inputs: PipelineHealthInputs = {
      transcriptsDir,
      dbPath,
      watermarkPath,
      windowHours: 24,
      syncStats: {
        syncedCount: 2,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "closed",
      },
    };

    const health = await computePipelineHealth(inputs);

    expect(health.activity.transcriptCount).toBe(2);
    expect(health.captured.obsCount).toBe(2);
    expect(health.captured.latestObsId).toBe(2);
    expect(health.syncCursor.lastObsId).toBe(2);
    expect(health.syncCursor.unsyncedCount).toBe(0);
    expect(health.gaps).toHaveLength(0);
    expect(health.verdict).toBe("healthy");
  });

  test("Gap A — activity exists but no obs captured (hooks broken)", async () => {
    const projDir = join(transcriptsDir, "-Users-test-project");
    mkdirSync(projDir);
    writeTranscript(projDir, "session-1.jsonl", 60);
    writeTranscript(projDir, "session-2.jsonl", 3600);
    writeTranscript(projDir, "session-3.jsonl", 7200);

    const db = createObservationsDb(dbPath);
    db.close();

    writeFileSync(
      watermarkPath,
      JSON.stringify({
        lastObservationId: 0,
        lastSummaryId: 0,
        updatedAt: new Date().toISOString(),
      }),
    );

    const health = await computePipelineHealth({
      transcriptsDir,
      dbPath,
      watermarkPath,
      windowHours: 24,
      syncStats: {
        syncedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "closed",
      },
    });

    expect(health.activity.transcriptCount).toBe(3);
    expect(health.captured.obsCount).toBe(0);

    const gapA = health.gaps.find((g) => g.layer === "A");
    expect(gapA).toBeDefined();
    expect(gapA?.severity).toBe("critical");
    expect(gapA?.hint.toLowerCase()).toContain("claude-mem");
    expect(health.verdict).toBe("critical");
  });

  test("Gap B — cursor lag (poller behind)", async () => {
    const db = createObservationsDb(dbPath);
    for (let i = 1; i <= 100; i++) insertObs(db, i, 60);
    db.close();

    writeFileSync(
      watermarkPath,
      JSON.stringify({
        lastObservationId: 30,
        lastSummaryId: 0,
        updatedAt: new Date().toISOString(),
      }),
    );

    const health = await computePipelineHealth({
      transcriptsDir,
      dbPath,
      watermarkPath,
      windowHours: 24,
      syncStats: {
        syncedCount: 30,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "open",
      },
    });

    expect(health.captured.latestObsId).toBe(100);
    expect(health.syncCursor.lastObsId).toBe(30);
    expect(health.syncCursor.unsyncedCount).toBe(70);

    const gapB = health.gaps.find((g) => g.layer === "B");
    expect(gapB).toBeDefined();
    expect(gapB?.message).toContain("70");
  });

  test("Gap C — failed uploads", async () => {
    const db = createObservationsDb(dbPath);
    insertObs(db, 1, 60);
    db.close();

    writeFileSync(
      watermarkPath,
      JSON.stringify({
        lastObservationId: 1,
        lastSummaryId: 0,
        updatedAt: new Date().toISOString(),
      }),
    );

    const health = await computePipelineHealth({
      transcriptsDir,
      dbPath,
      watermarkPath,
      windowHours: 24,
      syncStats: {
        syncedCount: 1,
        failedCount: 5,
        pendingCount: 2,
        circuitState: "closed",
      },
    });

    const gapC = health.gaps.find((g) => g.layer === "C");
    expect(gapC).toBeDefined();
    expect(gapC?.message).toContain("5");
  });

  test("graceful — claude-mem.db missing (claude-mem not installed)", async () => {
    const health = await computePipelineHealth({
      transcriptsDir,
      dbPath, // does not exist
      watermarkPath,
      windowHours: 24,
      syncStats: {
        syncedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "closed",
      },
    });

    expect(health.captured.dbExists).toBe(false);
    expect(health.captured.obsCount).toBe(0);
    // Should not throw — should report missing db with hint
    const dbGap = health.gaps.find((g) =>
      g.message.toLowerCase().includes("claude-mem.db"),
    );
    expect(dbGap).toBeDefined();
  });

  test("Gap A — db exists but query fails (schema drift)", async () => {
    // Write a non-SQLite file at dbPath. Database can open it
    // but the observations table query will throw.
    writeFileSync(dbPath, "not a sqlite database");

    writeFileSync(
      watermarkPath,
      JSON.stringify({
        lastObservationId: 0,
        lastSummaryId: 0,
        updatedAt: new Date().toISOString(),
      }),
    );

    const health = await computePipelineHealth({
      transcriptsDir,
      dbPath,
      watermarkPath,
      windowHours: 24,
      syncStats: {
        syncedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "closed",
      },
    });

    // Distinguish from missing-DB case: dbExists is true, but error is set
    expect(health.captured.dbExists).toBe(true);
    expect(health.captured.error).toBeDefined();

    const gap = health.gaps.find((g) => g.layer === "A");
    expect(gap).toBeDefined();
    expect(gap?.message).toContain("query failed");
    // Must NOT misdiagnose as "install claude-mem"
    expect(gap?.hint).not.toContain("Install claude-mem");
  });

  test("graceful — corrupt watermark file", async () => {
    const db = createObservationsDb(dbPath);
    insertObs(db, 1, 60);
    db.close();

    writeFileSync(watermarkPath, "this-is-not-json");

    const health = await computePipelineHealth({
      transcriptsDir,
      dbPath,
      watermarkPath,
      windowHours: 24,
      syncStats: {
        syncedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "closed",
      },
    });

    expect(health.syncCursor.error).toBeDefined();
    expect(health.syncCursor.lastObsId).toBe(0);
    // Should NOT silently report Gap A "no obs captured" — error is surfaced
    const gapA = health.gaps.find((g) => g.layer === "A");
    expect(gapA).toBeUndefined();
  });

  test("graceful — watermark missing (fresh install)", async () => {
    const db = createObservationsDb(dbPath);
    insertObs(db, 1, 60);
    db.close();

    const health = await computePipelineHealth({
      transcriptsDir,
      dbPath,
      watermarkPath, // does not exist
      windowHours: 24,
      syncStats: {
        syncedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "closed",
      },
    });

    expect(health.syncCursor.watermarkExists).toBe(false);
    expect(health.syncCursor.lastObsId).toBe(0);
    // Fresh install with 1 obs — should show as unsynced lag, not as a B-gap warning
    expect(health.syncCursor.unsyncedCount).toBe(1);
  });

  test("transcript count respects windowHours filter", async () => {
    const projDir = join(transcriptsDir, "-Users-test");
    mkdirSync(projDir);
    writeTranscript(projDir, "fresh.jsonl", 60); // 1min — in window
    writeTranscript(projDir, "old.jsonl", 90000); // 25hr — out of window
    writeTranscript(projDir, "ancient.jsonl", 7 * 86400); // 7d — out of window

    const db = createObservationsDb(dbPath);
    db.close();

    const health = await computePipelineHealth({
      transcriptsDir,
      dbPath,
      watermarkPath,
      windowHours: 24,
      syncStats: {
        syncedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "closed",
      },
    });

    expect(health.activity.transcriptCount).toBe(1);
  });

  test("captured count respects windowHours filter", async () => {
    const db = createObservationsDb(dbPath);
    insertObs(db, 1, 60); // in window
    insertObs(db, 2, 90000); // out of window
    db.close();

    const health = await computePipelineHealth({
      transcriptsDir,
      dbPath,
      watermarkPath,
      windowHours: 24,
      syncStats: {
        syncedCount: 2,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "closed",
      },
    });

    expect(health.captured.obsCount).toBe(1);
    expect(health.captured.latestObsId).toBe(2); // MAX over all rows
  });
});

describe("renderPipelineHealth", () => {
  test("emits expected section headings and labels", () => {
    const lines = renderPipelineHealth({
      activity: { transcriptCount: 5, windowHours: 24 },
      captured: {
        obsCount: 5,
        latestObsId: 100,
        windowHours: 24,
        dbPath: "/tmp/x.db",
        dbExists: true,
      },
      syncCursor: { lastObsId: 100, unsyncedCount: 0, watermarkExists: true },
      server: { lifetimeUsed: 1234 },
      sync: { failedCount: 0, pendingCount: 0, circuitState: "closed" },
      gaps: [],
      verdict: "healthy",
    });

    const text = lines.join("\n");
    expect(text).toContain("Pipeline Health");
    expect(text).toContain("Activity (last 24h)");
    expect(text).toContain("Captured (last 24h)");
    expect(text).toContain("Sync cursor");
    expect(text).toContain("Healthy");
  });

  test("escapes markdown control chars in dbPath (no injection)", () => {
    const lines = renderPipelineHealth({
      activity: { transcriptCount: 0, windowHours: 24 },
      captured: {
        obsCount: 0,
        latestObsId: 0,
        windowHours: 24,
        dbPath: "/tmp/evil`# Healthy\n* fake",
        dbExists: false,
      },
      syncCursor: { lastObsId: 0, unsyncedCount: 0, watermarkExists: true },
      server: { lifetimeUsed: null },
      sync: { failedCount: 0, pendingCount: 0, circuitState: "closed" },
      gaps: [],
      verdict: "critical",
    });
    const text = lines.join("\n");
    // Backtick must be replaced (would otherwise close the inline-code wrap)
    expect(text).not.toMatch(/`\/tmp\/evil`/);
    // Newline inside path must be collapsed (otherwise it can break the inline-code wrap)
    expect(text).not.toMatch(/evil.*Healthy\n\* fake/);
    // The path must still be visible in some escaped form
    expect(text).toContain("evil");
    expect(text).toContain("Healthy");
  });

  test("renders error notes when a layer fails to read", () => {
    const lines = renderPipelineHealth({
      activity: { transcriptCount: 0, windowHours: 24, error: "EACCES" },
      captured: {
        obsCount: 0,
        latestObsId: 0,
        windowHours: 24,
        dbPath: "/tmp/x.db",
        dbExists: true,
        error: "no such table: observations",
      },
      syncCursor: {
        lastObsId: 0,
        unsyncedCount: 0,
        watermarkExists: true,
        error: "Unexpected token",
      },
      server: { lifetimeUsed: null },
      sync: { failedCount: 0, pendingCount: 0, circuitState: "closed" },
      gaps: [],
      verdict: "warning",
    });
    const text = lines.join("\n");
    expect(text).toContain("EACCES");
    expect(text).toContain("query failed");
    expect(text).toContain("no such table");
    expect(text).toContain("watermark unreadable");
    expect(text).toContain("Unexpected token");
  });

  test("renders gap warnings with hints", () => {
    const lines = renderPipelineHealth({
      activity: { transcriptCount: 10, windowHours: 24 },
      captured: {
        obsCount: 0,
        latestObsId: 0,
        windowHours: 24,
        dbPath: "/tmp/x.db",
        dbExists: true,
      },
      syncCursor: { lastObsId: 0, unsyncedCount: 0, watermarkExists: true },
      server: { lifetimeUsed: 0 },
      sync: { failedCount: 0, pendingCount: 0, circuitState: "closed" },
      gaps: [
        {
          layer: "A",
          severity: "critical",
          message: "10 transcripts modified but 0 observations captured",
          hint: "Check claude-mem PostToolUse hook in ~/.claude/settings.json",
        },
      ],
      verdict: "critical",
    });

    const text = lines.join("\n");
    expect(text).toContain("Gap A");
    expect(text).toContain("PostToolUse hook");
  });
});
