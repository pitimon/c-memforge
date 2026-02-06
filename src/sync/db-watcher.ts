#!/usr/bin/env bun
/**
 * Database Watcher
 *
 * Polls the local claude-mem SQLite database for new observations
 * and syncs them to the remote server.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { remoteSync } from './remote-sync';

const DB_PATH = join(homedir(), '.claude-mem/claude-mem.db');
const DEFAULT_POLL_INTERVAL = 2000; // 2 seconds

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
  sdk_session_id: number | null;  // Joined from sdk_sessions table
}

/**
 * Database watcher that polls for new observations.
 */
export class DatabaseWatcher {
  private db: Database | null = null;
  private lastRowId = 0;
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

      // Get initial max rowid
      const row = this.db.query('SELECT MAX(id) as maxId FROM observations').get() as { maxId: number | null };
      this.lastRowId = row?.maxId || 0;
      console.log(`Starting from observation ID: ${this.lastRowId}`);
      console.log('');
      console.log('Watching for new observations... (Ctrl+C to stop)');
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

      if (rows.length === 0) return;

      console.log(`Found ${rows.length} new observation(s)`);

      // Map all rows to server format
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

      // Batch sync all observations at once
      const result = await remoteSync.syncBatch(observations);
      console.log(`  Batch result: ${result.synced} synced, ${result.failed} failed`);

      // Update lastRowId to the highest processed ID
      this.lastRowId = rows[rows.length - 1].id;

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

    const pendingCount = remoteSync.getPendingCount();
    if (pendingCount > 0) {
      console.log(`Warning: ${pendingCount} observation(s) pending sync`);
    }

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
