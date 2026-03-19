/**
 * Sync Poller
 *
 * In-process polling of claude-mem SQLite database for new observations
 * and summaries. Replaces the detached db-watcher daemon.
 *
 * Key differences from DatabaseWatcher:
 * - No process.exit() — MCP server must stay alive
 * - No standalone entry point — always imported
 * - Watermark in-memory only (server dedup handles restart overlap)
 * - Logger injected (MCP stdout = JSON-RPC, must use stderr)
 * - All errors caught — never crashes host process
 * - Adaptive polling: speeds up when active, slows down when idle
 * - Circuit breaker: suppresses HTTP calls during server outages
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import { remoteSync } from "./remote-sync";

const DB_PATH = join(homedir(), ".claude-mem/claude-mem.db");
const DEFAULT_POLL_INTERVAL = 2000;
const DB_WAIT_INTERVAL = 5000;
const MAX_DB_WAIT_ATTEMPTS = 60; // 5 minutes max wait

// Adaptive polling constants
const MIN_POLL_INTERVAL = 1000; // 1s when active
const MAX_POLL_INTERVAL = 10000; // 10s when idle
const IDLE_THRESHOLD = 5; // idle after 5 consecutive empty polls

// Circuit breaker constants
const CIRCUIT_THRESHOLD = 3; // open after 3 consecutive sync failures
const CIRCUIT_COOLDOWN = 30000; // 30s cooldown before retry probe

interface ObservationRow {
  id: number;
  type: string | null;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  project: string | null;
  text: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  created_at: string | null;
  created_at_epoch: number | null;
  memory_session_id: string | null;
  prompt_number: number | null;
  discovery_tokens: number | null;
  sdk_session_id: number | null;
}

interface SummaryRow {
  id: number;
  memory_session_id: string | null;
  project: string | null;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null;
  files_edited: string | null;
  notes: string | null;
  prompt_number: number | null;
  created_at: string | null;
  created_at_epoch: number | null;
  discovery_tokens: number | null;
  sdk_session_id: number | null;
}

interface SyncPollerOptions {
  pollInterval?: number;
  logger?: (...args: unknown[]) => void;
}

export interface SyncStats {
  lastObsId: number;
  lastSumId: number;
  syncedCount: number;
  failedCount: number;
  pendingCount: number;
  circuitState: "closed" | "open" | "half-open";
  currentInterval: number;
}

export class SyncPoller {
  private db: Database | null = null;
  private lastObsId = 0;
  private lastSumId = 0;
  private syncedCount = 0;
  private failedCount = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private dbWaitTimer: ReturnType<typeof setInterval> | null = null;
  private basePollInterval: number;
  private currentInterval: number;
  private log: (...args: unknown[]) => void;
  private running = false;

  // Adaptive polling state
  private consecutiveEmpty = 0;

  // Circuit breaker state
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(options?: SyncPollerOptions) {
    this.basePollInterval = options?.pollInterval || DEFAULT_POLL_INTERVAL;
    this.currentInterval = this.basePollInterval;
    this.log = options?.logger || console.error;
  }

  async start(): Promise<void> {
    if (this.running) return;

    if (!remoteSync.isConfigured()) {
      this.log("[SyncPoller] Sync not configured, skipping");
      return;
    }

    this.running = true;
    this.log(`[SyncPoller] Starting (interval=${this.basePollInterval}ms)`);

    if (!existsSync(DB_PATH)) {
      this.log("[SyncPoller] Database not found, waiting for claude-mem...");
      await this.waitForDb();
      return;
    }

    this.connectAndPoll();
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.dbWaitTimer) {
      clearInterval(this.dbWaitTimer);
      this.dbWaitTimer = null;
    }

    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* ignore close errors */
      }
      this.db = null;
    }

    this.log(
      `[SyncPoller] Stopped (synced=${this.syncedCount}, failed=${this.failedCount})`,
    );
  }

  isActive(): boolean {
    return this.running && this.pollTimer !== null;
  }

  getStats(): SyncStats {
    return {
      lastObsId: this.lastObsId,
      lastSumId: this.lastSumId,
      syncedCount: this.syncedCount,
      failedCount: this.failedCount,
      pendingCount: remoteSync.getPendingCount(),
      circuitState: this.getCircuitState(),
      currentInterval: this.currentInterval,
    };
  }

  private getCircuitState(): "closed" | "open" | "half-open" {
    if (this.consecutiveFailures < CIRCUIT_THRESHOLD) return "closed";
    if (Date.now() >= this.circuitOpenUntil) return "half-open";
    return "open";
  }

  private isCircuitOpen(): boolean {
    return this.getCircuitState() === "open";
  }

  private getAdaptiveInterval(): number {
    if (this.consecutiveEmpty >= IDLE_THRESHOLD) {
      const backoff =
        this.basePollInterval *
        Math.pow(1.5, this.consecutiveEmpty - IDLE_THRESHOLD);
      return Math.min(Math.round(backoff), MAX_POLL_INTERVAL);
    }
    return MIN_POLL_INTERVAL;
  }

  private scheduleNextPoll(interval: number): void {
    if (!this.running) return;
    this.currentInterval = interval;
    this.pollTimer = setTimeout(() => this.poll(), interval);
  }

  private async waitForDb(): Promise<void> {
    let attempts = 0;
    this.dbWaitTimer = setInterval(() => {
      attempts++;
      if (existsSync(DB_PATH)) {
        clearInterval(this.dbWaitTimer!);
        this.dbWaitTimer = null;
        this.log("[SyncPoller] Database found");
        this.connectAndPoll();
      } else if (attempts >= MAX_DB_WAIT_ATTEMPTS) {
        clearInterval(this.dbWaitTimer!);
        this.dbWaitTimer = null;
        this.log("[SyncPoller] Gave up waiting for database");
        this.running = false;
      }
    }, DB_WAIT_INTERVAL);
  }

  private connectAndPoll(): void {
    try {
      this.db = new Database(DB_PATH, { readonly: true });

      // Initialize watermark from MAX(id) — server dedup handles any overlap
      const obsRow = this.db
        .query("SELECT MAX(id) as maxId FROM observations")
        .get() as { maxId: number | null } | null;
      this.lastObsId = obsRow?.maxId || 0;

      const sumRow = this.db
        .query("SELECT MAX(id) as maxId FROM session_summaries")
        .get() as { maxId: number | null } | null;
      this.lastSumId = sumRow?.maxId || 0;

      this.log(
        `[SyncPoller] Connected (obs=${this.lastObsId}, sum=${this.lastSumId})`,
      );

      this.scheduleNextPoll(this.basePollInterval);
    } catch (error) {
      this.log("[SyncPoller] Failed to connect:", error);
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    if (!this.db || !this.running) return;

    // Circuit breaker: skip sync when remote is known to be down
    if (this.isCircuitOpen()) {
      this.scheduleNextPoll(CIRCUIT_COOLDOWN);
      return;
    }

    let hadData = false;
    let hadSyncError = false;

    try {
      const obsCount = await this.checkNewObservations();
      const sumCount = await this.checkNewSummaries();
      hadData = obsCount > 0 || sumCount > 0;

      // Retry pending if any
      const pendingCount = remoteSync.getPendingCount();
      if (pendingCount > 0) {
        const retried = await remoteSync.retryPending();
        if (retried > 0) {
          this.syncedCount += retried;
        }
      }

      // Success — reset circuit breaker
      if (this.consecutiveFailures > 0) {
        this.log("[SyncPoller] Remote connection restored");
      }
      this.consecutiveFailures = 0;
    } catch (error) {
      this.log("[SyncPoller] Poll error:", error);
      hadSyncError = true;
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= CIRCUIT_THRESHOLD) {
        this.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN;
        this.log(
          `[SyncPoller] Circuit OPEN — remote unreachable (${this.consecutiveFailures} failures), retry in ${CIRCUIT_COOLDOWN / 1000}s`,
        );
      }
    }

    // Adaptive polling: speed up when active, slow down when idle
    if (hadData) {
      this.consecutiveEmpty = 0;
      this.scheduleNextPoll(MIN_POLL_INTERVAL);
    } else if (hadSyncError) {
      this.scheduleNextPoll(this.basePollInterval);
    } else {
      this.consecutiveEmpty++;
      this.scheduleNextPoll(this.getAdaptiveInterval());
    }
  }

  private async checkNewObservations(): Promise<number> {
    if (!this.db) return 0;

    const rows = this.db
      .query(
        `
      SELECT o.id, o.type, o.title, o.subtitle, o.narrative, o.project, o.text,
             o.facts, o.concepts, o.files_read, o.files_modified,
             o.created_at, o.created_at_epoch, o.memory_session_id,
             o.prompt_number, o.discovery_tokens, s.id as sdk_session_id
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      WHERE o.id > $lastObsId
      ORDER BY o.id ASC
    `,
      )
      .all({ $lastObsId: this.lastObsId }) as ObservationRow[];

    if (rows.length === 0) return 0;

    const observations = rows.map((row) => ({
      id: row.id,
      sdk_session_id: row.sdk_session_id || 1,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      narrative: row.narrative,
      project: row.project,
      text: row.text,
      facts: row.facts || "[]",
      concepts: row.concepts || "[]",
      files_read: row.files_read || "[]",
      files_modified: row.files_modified || "[]",
      created_at: row.created_at,
      created_at_epoch: row.created_at_epoch || Math.floor(Date.now() / 1000),
      prompt_number: row.prompt_number || 0,
      discovery_tokens: row.discovery_tokens || 0,
    }));

    const result = await remoteSync.syncBatch(observations);
    this.syncedCount += result.synced;
    this.failedCount += result.failed;

    if (result.failed === 0) {
      this.lastObsId = rows[rows.length - 1].id;
    }

    return rows.length;
  }

  private async checkNewSummaries(): Promise<number> {
    if (!this.db) return 0;

    const rows = this.db
      .query(
        `
      SELECT s.id, s.memory_session_id, s.project, s.request, s.investigated,
             s.learned, s.completed, s.next_steps, s.files_read, s.files_edited,
             s.notes, s.prompt_number, s.created_at, s.created_at_epoch,
             s.discovery_tokens, ss.id as sdk_session_id
      FROM session_summaries s
      LEFT JOIN sdk_sessions ss ON s.memory_session_id = ss.memory_session_id
      WHERE s.id > $lastSumId
      ORDER BY s.id ASC
    `,
      )
      .all({ $lastSumId: this.lastSumId }) as SummaryRow[];

    if (rows.length === 0) return 0;

    const summaries = rows.map((row) => ({
      id: row.id,
      sdk_session_id: row.sdk_session_id || 1,
      memory_session_id: row.memory_session_id,
      project: row.project,
      request: row.request,
      investigated: row.investigated,
      learned: row.learned,
      completed: row.completed,
      next_steps: row.next_steps,
      files_read: row.files_read || "[]",
      files_edited: row.files_edited || "[]",
      notes: row.notes,
      prompt_number: row.prompt_number || 0,
      created_at: row.created_at,
      created_at_epoch: row.created_at_epoch || Math.floor(Date.now() / 1000),
      discovery_tokens: row.discovery_tokens || 0,
    }));

    const result = await remoteSync.syncSummaries(summaries);
    this.syncedCount += result.synced;
    this.failedCount += result.failed;

    if (result.failed === 0) {
      this.lastSumId = rows[rows.length - 1].id;
    }

    return rows.length;
  }
}
