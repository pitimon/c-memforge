/**
 * Pipeline Health Diagnosis
 *
 * 4-layer matrix that distinguishes upstream-of-sync failures
 * (Gap A: claude-mem hooks not capturing) from sync-side failures
 * (Gap B: poller behind, Gap C: server rejects).
 *
 *   transcripts (~/.claude/projects/*.jsonl mtime)
 *      ↓ Gap A — claude-mem PostToolUse hook not running
 *   claude-mem.db observations COUNT(*)
 *      ↓ Gap B — sync poller behind / circuit open
 *   ~/.memforge/.sync-watermark.json lastObservationId
 *      ↓ Gap C — server reject / quota exceeded / network
 *   server quota.observations.used
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";

const SECONDS_PER_HOUR = 3600;
const GAP_A_RATIO_THRESHOLD = 5; // captured << activity → partial hook failure
const GAP_B_LAG_THRESHOLD = 50; // unsynced > 50 → poller behind

type CircuitState = "closed" | "open" | "half-open";

export interface SyncStatsInput {
  syncedCount: number;
  failedCount: number;
  pendingCount: number;
  circuitState: CircuitState;
}

export interface PipelineHealthInputs {
  transcriptsDir: string;
  dbPath: string;
  watermarkPath: string;
  windowHours: number;
  syncStats: SyncStatsInput;
  serverLifetimeUsed?: number | null;
}

export interface ActivityLayer {
  transcriptCount: number;
  windowHours: number;
  error?: string;
}

export interface CapturedLayer {
  obsCount: number;
  latestObsId: number;
  windowHours: number;
  dbPath: string;
  dbExists: boolean;
  error?: string;
}

export interface SyncCursorLayer {
  lastObsId: number;
  unsyncedCount: number;
  watermarkExists: boolean;
  error?: string;
}

export interface ServerLayer {
  lifetimeUsed: number | null;
}

export interface SyncHealth {
  failedCount: number;
  pendingCount: number;
  circuitState: CircuitState;
}

export interface Gap {
  layer: "A" | "B" | "C";
  severity: "info" | "warning" | "critical";
  message: string;
  hint: string;
}

export type Verdict = "healthy" | "warning" | "critical";

export interface PipelineHealth {
  activity: ActivityLayer;
  captured: CapturedLayer;
  syncCursor: SyncCursorLayer;
  server: ServerLayer;
  sync: SyncHealth;
  gaps: Gap[];
  verdict: Verdict;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type TranscriptResult = { count: number; error?: string };

function countTranscriptsInWindow(
  rootDir: string,
  windowSeconds: number,
): TranscriptResult {
  if (!existsSync(rootDir)) return { count: 0 };

  const cutoff = Date.now() - windowSeconds * 1000;
  let count = 0;

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(rootDir);
  } catch (e) {
    return {
      count: 0,
      error: `cannot read transcripts dir: ${errorMessage(e)}`,
    };
  }

  for (const projectName of projectDirs) {
    const projectPath = join(rootDir, projectName);
    let projectStat;
    try {
      projectStat = statSync(projectPath);
    } catch {
      continue;
    }
    if (!projectStat.isDirectory()) continue;

    let entries: string[];
    try {
      entries = readdirSync(projectPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      try {
        const stat = statSync(join(projectPath, entry));
        if (stat.mtimeMs >= cutoff) count++;
      } catch {
        /* skip unreadable file */
      }
    }
  }

  return { count };
}

type DbResult =
  | { kind: "missing" }
  | { kind: "ok"; obsCount: number; latestObsId: number }
  | { kind: "error"; message: string };

function queryClaudeMemStats(dbPath: string, windowSeconds: number): DbResult {
  if (!existsSync(dbPath)) return { kind: "missing" };

  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const cutoffEpoch = Math.floor(Date.now() / 1000) - windowSeconds;

    const countRow = db
      .query(
        "SELECT COUNT(*) as c FROM observations WHERE created_at_epoch > ?",
      )
      .get(cutoffEpoch) as { c: number } | null;

    const maxRow = db.query("SELECT MAX(id) as m FROM observations").get() as {
      m: number | null;
    } | null;

    return {
      kind: "ok",
      obsCount: countRow?.c ?? 0,
      latestObsId: maxRow?.m ?? 0,
    };
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }
}

type WatermarkResult =
  | { kind: "missing" }
  | { kind: "ok"; lastObsId: number }
  | { kind: "error"; message: string };

function readWatermark(path: string): WatermarkResult {
  if (!existsSync(path)) return { kind: "missing" };
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as { lastObservationId?: number };
    return { kind: "ok", lastObsId: parsed.lastObservationId ?? 0 };
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
}

function detectGapA(
  activity: ActivityLayer,
  captured: CapturedLayer,
): Gap | null {
  if (!captured.dbExists) {
    return {
      layer: "A",
      severity: "critical",
      message: "claude-mem.db not found",
      hint: "Install claude-mem plugin: /plugin marketplace add thedotmack/claude-mem",
    };
  }

  if (captured.error) {
    return {
      layer: "A",
      severity: "critical",
      message: `claude-mem.db query failed: ${captured.error}`,
      hint: "Schema may have drifted or DB is locked/corrupt. Check ~/.claude-mem/claude-mem.db integrity.",
    };
  }

  if (activity.transcriptCount > 0 && captured.obsCount === 0) {
    return {
      layer: "A",
      severity: "critical",
      message: `${activity.transcriptCount} transcripts modified but 0 observations captured`,
      hint: "Check claude-mem PostToolUse hook in ~/.claude/settings.json — observations are not being produced",
    };
  }

  if (
    captured.obsCount > 0 &&
    activity.transcriptCount > captured.obsCount * GAP_A_RATIO_THRESHOLD
  ) {
    return {
      layer: "A",
      severity: "warning",
      message: `${activity.transcriptCount} transcripts but only ${captured.obsCount} obs (ratio >${GAP_A_RATIO_THRESHOLD}x)`,
      hint: "claude-mem may be partially failing — check ~/.claude-mem/logs/ for errors",
    };
  }

  return null;
}

function detectGapB(syncCursor: SyncCursorLayer, sync: SyncHealth): Gap | null {
  if (sync.circuitState === "open") {
    return {
      layer: "B",
      severity: "critical",
      message: `Sync circuit OPEN — ${syncCursor.unsyncedCount} obs waiting`,
      hint: "Server unreachable. Check connectivity above; sync resumes after cooldown.",
    };
  }

  if (syncCursor.unsyncedCount > GAP_B_LAG_THRESHOLD) {
    return {
      layer: "B",
      severity: "warning",
      message: `${syncCursor.unsyncedCount} obs unsynced (cursor lag > ${GAP_B_LAG_THRESHOLD})`,
      hint: "Poller is behind. Check sync-poller logs (stderr); may catch up automatically.",
    };
  }

  return null;
}

function detectGapC(sync: SyncHealth): Gap | null {
  if (sync.failedCount > 0) {
    return {
      layer: "C",
      severity: "warning",
      message: `${sync.failedCount} obs failed to sync since process start`,
      hint: "Server rejected uploads — check tier quota, API key validity, or server logs.",
    };
  }
  return null;
}

function computeVerdict(gaps: Gap[]): Verdict {
  if (gaps.some((g) => g.severity === "critical")) return "critical";
  if (gaps.some((g) => g.severity === "warning")) return "warning";
  return "healthy";
}

function buildActivityLayer(
  result: TranscriptResult,
  windowHours: number,
): ActivityLayer {
  return {
    transcriptCount: result.count,
    windowHours,
    ...(result.error ? { error: result.error } : {}),
  };
}

function buildCapturedLayer(
  result: DbResult,
  dbPath: string,
  windowHours: number,
): CapturedLayer {
  if (result.kind === "ok") {
    return {
      obsCount: result.obsCount,
      latestObsId: result.latestObsId,
      windowHours,
      dbPath,
      dbExists: true,
    };
  }
  if (result.kind === "missing") {
    return {
      obsCount: 0,
      latestObsId: 0,
      windowHours,
      dbPath,
      dbExists: false,
    };
  }
  return {
    obsCount: 0,
    latestObsId: 0,
    windowHours,
    dbPath,
    dbExists: true,
    error: result.message,
  };
}

function buildSyncCursorLayer(
  result: WatermarkResult,
  latestObsId: number,
): SyncCursorLayer {
  if (result.kind === "ok") {
    return {
      lastObsId: result.lastObsId,
      unsyncedCount: Math.max(0, latestObsId - result.lastObsId),
      watermarkExists: true,
    };
  }
  if (result.kind === "missing") {
    return {
      lastObsId: 0,
      unsyncedCount: latestObsId,
      watermarkExists: false,
    };
  }
  return {
    lastObsId: 0,
    unsyncedCount: latestObsId,
    watermarkExists: true,
    error: result.message,
  };
}

export async function computePipelineHealth(
  inputs: PipelineHealthInputs,
): Promise<PipelineHealth> {
  const windowSeconds = inputs.windowHours * SECONDS_PER_HOUR;

  const transcripts = countTranscriptsInWindow(
    inputs.transcriptsDir,
    windowSeconds,
  );
  const dbStats = queryClaudeMemStats(inputs.dbPath, windowSeconds);
  const watermark = readWatermark(inputs.watermarkPath);

  const activity = buildActivityLayer(transcripts, inputs.windowHours);
  const captured = buildCapturedLayer(
    dbStats,
    inputs.dbPath,
    inputs.windowHours,
  );
  const syncCursor = buildSyncCursorLayer(watermark, captured.latestObsId);
  const server: ServerLayer = {
    lifetimeUsed: inputs.serverLifetimeUsed ?? null,
  };
  const sync: SyncHealth = {
    failedCount: inputs.syncStats.failedCount,
    pendingCount: inputs.syncStats.pendingCount,
    circuitState: inputs.syncStats.circuitState,
  };

  const gaps: Gap[] = [];
  const gapA = detectGapA(activity, captured);
  if (gapA) gaps.push(gapA);
  const gapB = detectGapB(syncCursor, sync);
  if (gapB) gaps.push(gapB);
  const gapC = detectGapC(sync);
  if (gapC) gaps.push(gapC);

  return {
    activity,
    captured,
    syncCursor,
    server,
    sync,
    gaps,
    verdict: computeVerdict(gaps),
  };
}

const SEVERITY_ICON: Record<Gap["severity"], string> = {
  info: "ℹ",
  warning: "⚠",
  critical: "✗",
};

function inlineCode(s: string): string {
  // Escape backticks and collapse newlines/control chars before wrapping
  // in inline code — keeps markdown-renderer-injected paths/errors safe.
  const safe = s.replace(/`/g, "ʼ").replace(/[\r\n\t]+/g, " ");
  return "`" + safe + "`";
}

export function renderPipelineHealth(health: PipelineHealth): string[] {
  const { activity, captured, syncCursor, server, sync, gaps, verdict } =
    health;
  const win = `last ${activity.windowHours}h`;
  const lines: string[] = ["", "### Pipeline Health"];

  lines.push(
    `**Activity (${win}):** ${activity.transcriptCount.toLocaleString()} transcript file(s) modified`,
  );
  if (activity.error) {
    lines.push(`   _note: ${inlineCode(activity.error)}_`);
  }

  if (captured.dbExists && !captured.error) {
    lines.push(
      `**Captured (${win}):** ${captured.obsCount.toLocaleString()} obs in claude-mem.db (latest id=${captured.latestObsId})`,
    );
  } else if (!captured.dbExists) {
    lines.push(
      `**Captured:** claude-mem.db not found at ${inlineCode(captured.dbPath)}`,
    );
  } else {
    lines.push(`**Captured:** query failed (${inlineCode(captured.dbPath)})`);
    lines.push(`   _note: ${inlineCode(captured.error!)}_`);
  }

  if (syncCursor.watermarkExists && !syncCursor.error) {
    lines.push(
      `**Sync cursor:** obs #${syncCursor.lastObsId} (${syncCursor.unsyncedCount.toLocaleString()} unsynced)`,
    );
  } else if (syncCursor.error) {
    lines.push(`**Sync cursor:** watermark unreadable`);
    lines.push(`   _note: ${inlineCode(syncCursor.error)}_`);
  } else {
    lines.push(
      `**Sync cursor:** no watermark yet (${syncCursor.unsyncedCount} pending first sync)`,
    );
  }

  const serverLine =
    server.lifetimeUsed !== null
      ? `**Server (lifetime):** ${server.lifetimeUsed.toLocaleString()} obs accepted`
      : `**Server:** quota unknown`;
  lines.push(serverLine);

  lines.push(
    `**Sync workers:** synced ok, ${sync.failedCount} failed, ${sync.pendingCount} pending, circuit=${sync.circuitState}`,
  );

  lines.push("");

  if (verdict === "healthy") {
    lines.push("✓ **Healthy** — all 4 layers aligned.");
  } else {
    for (const gap of gaps) {
      lines.push(
        `${SEVERITY_ICON[gap.severity]} **Gap ${gap.layer}** (${gap.severity}): ${gap.message}`,
      );
      lines.push(`   → ${gap.hint}`);
    }
  }

  return lines;
}
