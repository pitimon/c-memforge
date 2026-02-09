#!/usr/bin/env bun
/**
 * Database Watcher
 *
 * Polls the local claude-mem SQLite database for new observations
 * and syncs them to the remote server.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { remoteSync } from './remote-sync';

const MEMFORGE_DIR = join(homedir(), '.memforge');
const DB_PATH = join(homedir(), '.claude-mem/claude-mem.db');
const WATERMARK_PATH = join(MEMFORGE_DIR, '.sync-watermark.json');
const DEFAULT_POLL_INTERVAL = 2000; // 2 seconds

interface Watermark {
  lastObservationId: number;
  lastSummaryId: number;
  updatedAt: string;
}

function loadWatermark(): Watermark | null {
  try {
    if (existsSync(WATERMARK_PATH)) {
      return JSON.parse(readFileSync(WATERMARK_PATH, 'utf-8'));
    }
  } catch { /* ignore parse errors, start fresh */ }
  return null;
}

function saveWatermark(obsId: number, sumId: number): void {
  if (!existsSync(MEMFORGE_DIR)) {
    mkdirSync(MEMFORGE_DIR, { recursive: true });
  }
  const watermark: Watermark = {
    lastObservationId: obsId,
    lastSummaryId: sumId,
    updatedAt: new Date().toISOString()
  };
  writeFileSync(WATERMARK_PATH, JSON.stringify(watermark, null, 2));
}

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

/**
 * Database watcher that polls for new observations.
 */
export class DatabaseWatcher {
  private db: Database | null = null;
  private lastRowId = 0;
  private lastSummaryId = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollInterval: number;
  private isRunning = false;

  constructor(pollInterval?: number) {
    this.pollInterval = pollInterval || DEFAULT_POLL_INTERVAL;
  }

  /**
   * Start watching the database.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Watcher already running');
      return;
    }

    // Check if sync is configured
    if (!remoteSync.isConfigured()) {
      console.error('Sync not configured. Run: bun run setup');
      process.exit(1);
    }

    const config = remoteSync.getConfig();
    if (config?.pollInterval) {
      this.pollInterval = config.pollInterval;
    }

    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  MemForge Database Watcher                   ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log(`Server: ${config?.serverUrl}`);
    console.log(`Poll interval: ${this.pollInterval}ms`);
    console.log(`Database: ${DB_PATH}`);
    console.log('');

    if (!existsSync(DB_PATH)) {
      console.log('Database not found. Waiting for claude-mem to create it...');
      await this.watchForDbCreation();
      return;
    }

    await this.connectAndPoll();
  }

  /**
   * Wait for database file to be created.
   */
  private async watchForDbCreation(): Promise<void> {
    const checkInterval = setInterval(() => {
      if (existsSync(DB_PATH)) {
        clearInterval(checkInterval);
        console.log('Database found!');
        this.connectAndPoll();
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Connect to database and start polling.
   */
  private async connectAndPoll(): Promise<void> {
    try {
      // Open in read-only mode (WAL compatible)
      this.db = new Database(DB_PATH, { readonly: true });
      this.isRunning = true;

      // Restore watermark from disk, fall back to MAX(id) on first run
      const watermark = loadWatermark();
      if (watermark) {
        this.lastRowId = watermark.lastObservationId;
        this.lastSummaryId = watermark.lastSummaryId;
        console.log(`Restored watermark: observation ID: ${this.lastRowId}, summary ID: ${this.lastSummaryId}`);
      } else {
        const obsRow = this.db.query('SELECT MAX(id) as maxId FROM observations').get() as { maxId: number | null };
        this.lastRowId = obsRow?.maxId || 0;
        const sumRow = this.db.query('SELECT MAX(id) as maxId FROM session_summaries').get() as { maxId: number | null };
        this.lastSummaryId = sumRow?.maxId || 0;
        saveWatermark(this.lastRowId, this.lastSummaryId);
        console.log(`First run — starting from observation ID: ${this.lastRowId}, summary ID: ${this.lastSummaryId}`);
      }
      console.log('');
      console.log('Watching for new observations and summaries... (Ctrl+C to stop)');
      console.log('');

      // Start polling
      this.pollTimer = setInterval(() => this.checkNewRows(), this.pollInterval);

      // Handle graceful shutdown
      process.on('SIGINT', () => this.stop());
      process.on('SIGTERM', () => this.stop());
    } catch (error) {
      console.error('Failed to connect to database:', error);
      process.exit(1);
    }
  }

  /**
   * Check for new rows in the database.
   */
  private async checkNewRows(): Promise<void> {
    if (!this.db) return;

    try {
      const rows = this.db.query(`
        SELECT o.id, o.type, o.title, o.subtitle, o.narrative, o.project, o.text,
               o.facts, o.concepts, o.files_read, o.files_modified,
               o.created_at, o.created_at_epoch, o.memory_session_id,
               o.prompt_number, o.discovery_tokens, s.id as sdk_session_id
        FROM observations o
        LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
        WHERE o.id > $lastRowId
        ORDER BY o.id ASC
      `).all({ $lastRowId: this.lastRowId }) as ObservationRow[];

      // Sync observations
      if (rows.length > 0) {
        console.log(`Found ${rows.length} new observation(s)`);

        const observations = rows.map(row => ({
          id: row.id,
          sdk_session_id: row.sdk_session_id || 1,
          type: row.type,
          title: row.title,
          subtitle: row.subtitle,
          narrative: row.narrative,
          project: row.project,
          text: row.text,
          facts: row.facts || '[]',
          concepts: row.concepts || '[]',
          files_read: row.files_read || '[]',
          files_modified: row.files_modified || '[]',
          created_at: row.created_at,
          created_at_epoch: row.created_at_epoch || Math.floor(Date.now() / 1000),
          prompt_number: row.prompt_number || 0,
          discovery_tokens: row.discovery_tokens || 0
        }));

        const result = await remoteSync.syncBatch(observations);
        console.log(`  Observations: ${result.synced} synced, ${result.failed} failed`);
        if (result.failed === 0) {
          this.lastRowId = rows[rows.length - 1].id;
          saveWatermark(this.lastRowId, this.lastSummaryId);
        }
      }

      // Sync summaries
      await this.checkNewSummaries();

      // Retry pending if any
      const pendingCount = remoteSync.getPendingCount();
      if (pendingCount > 0) {
        console.log(`Retrying ${pendingCount} pending item(s)...`);
        const retried = await remoteSync.retryPending();
        if (retried > 0) {
          console.log(`  ✓ Retried ${retried} item(s)`);
        }
      }
    } catch (error) {
      // Database might be locked, retry next poll
      console.error('Poll error:', error);
    }
  }

  /**
   * Check for new summaries in the database.
   */
  private async checkNewSummaries(): Promise<void> {
    if (!this.db) return;

    const summaryRows = this.db.query(`
      SELECT s.id, s.memory_session_id, s.project, s.request, s.investigated,
             s.learned, s.completed, s.next_steps, s.files_read, s.files_edited,
             s.notes, s.prompt_number, s.created_at, s.created_at_epoch,
             s.discovery_tokens, ss.id as sdk_session_id
      FROM session_summaries s
      LEFT JOIN sdk_sessions ss ON s.memory_session_id = ss.memory_session_id
      WHERE s.id > $lastSummaryId
      ORDER BY s.id ASC
    `).all({ $lastSummaryId: this.lastSummaryId }) as SummaryRow[];

    if (summaryRows.length === 0) return;

    console.log(`Found ${summaryRows.length} new summary(ies)`);

    const summaries = summaryRows.map(row => ({
      id: row.id,
      sdk_session_id: row.sdk_session_id || 1,
      memory_session_id: row.memory_session_id,
      project: row.project,
      request: row.request,
      investigated: row.investigated,
      learned: row.learned,
      completed: row.completed,
      next_steps: row.next_steps,
      files_read: row.files_read || '[]',
      files_edited: row.files_edited || '[]',
      notes: row.notes,
      prompt_number: row.prompt_number || 0,
      created_at: row.created_at,
      created_at_epoch: row.created_at_epoch || Math.floor(Date.now() / 1000),
      discovery_tokens: row.discovery_tokens || 0
    }));

    const result = await remoteSync.syncSummaries(summaries);
    console.log(`  Summaries: ${result.synced} synced, ${result.failed} failed`);
    if (result.failed === 0) {
      this.lastSummaryId = summaryRows[summaryRows.length - 1].id;
      saveWatermark(this.lastRowId, this.lastSummaryId);
    }
  }

  /**
   * Stop the watcher.
   */
  stop(): void {
    console.log('');
    console.log('Stopping watcher...');

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.isRunning = false;
    saveWatermark(this.lastRowId, this.lastSummaryId);

    const pendingCount = remoteSync.getPendingCount();
    if (pendingCount > 0) {
      console.log(`Warning: ${pendingCount} observation(s) pending sync`);
    }

    console.log(`Watermark saved: obs=${this.lastRowId}, sum=${this.lastSummaryId}`);
    console.log('Watcher stopped.');
    process.exit(0);
  }
}

// Run if executed directly
if (import.meta.main) {
  const watcher = new DatabaseWatcher();
  watcher.start().catch((error) => {
    console.error('Failed to start watcher:', error);
    process.exit(1);
  });
}
