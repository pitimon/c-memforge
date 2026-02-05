/**
 * Remote Sync Service
 *
 * Handles syncing observations from local claude-mem to remote server.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '../..');
const CONFIG_PATH = join(PLUGIN_ROOT, 'config.local.json');

interface Config {
  apiKey: string;
  serverUrl: string;
  syncEnabled: boolean;
  pollInterval: number;
}

interface SyncResult {
  success: boolean;
  error?: string;
}

/**
 * Remote sync service for pushing observations to server.
 */
export class RemoteSync {
  private config: Config | null = null;
  private pendingQueue: Array<Record<string, unknown>> = [];

  constructor() {
    this.loadConfig();
  }

  /**
   * Load configuration from plugin's config.local.json.
   */
  private loadConfig(): void {
    if (!existsSync(CONFIG_PATH)) {
      console.error('Config not found. Run: bun run setup');
      return;
    }

    try {
      const config: Config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      if (config.apiKey && config.serverUrl) {
        this.config = config;
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  /**
   * Reload configuration (useful if config changes).
   */
  reloadConfig(): void {
    this.loadConfig();
  }

  /**
   * Check if sync is configured and enabled.
   */
  isConfigured(): boolean {
    return this.config !== null && this.config.syncEnabled;
  }

  /**
   * Get current configuration.
   */
  getConfig(): Config | null {
    return this.config;
  }

  /**
   * Sync a single observation to the remote server.
   */
  async syncObservation(observation: Record<string, unknown>): Promise<SyncResult> {
    if (!this.config || !this.config.syncEnabled) {
      return { success: false, error: 'Sync not configured or disabled' };
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/api/sync/observation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify(observation),
        signal: AbortSignal.timeout(30000) // 30s timeout
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.pendingQueue.push(observation);
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      return { success: true };
    } catch (err) {
      this.pendingQueue.push(observation);
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Sync multiple observations in batch.
   */
  async syncBatch(observations: Record<string, unknown>[]): Promise<{ synced: number; failed: number }> {
    if (!this.config || !this.config.syncEnabled) {
      return { synced: 0, failed: observations.length };
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/api/sync/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify({ observations }),
        signal: AbortSignal.timeout(60000) // 60s timeout for batch
      });

      if (!response.ok) {
        // Fall back to individual sync
        let synced = 0;
        for (const obs of observations) {
          const result = await this.syncObservation(obs);
          if (result.success) synced++;
        }
        return { synced, failed: observations.length - synced };
      }

      const result = await response.json() as { synced?: number };
      return { synced: result.synced || observations.length, failed: 0 };
    } catch (err) {
      // Queue all for retry
      this.pendingQueue.push(...observations);
      return { synced: 0, failed: observations.length };
    }
  }

  /**
   * Retry pending failed syncs.
   */
  async retryPending(): Promise<number> {
    const pending = [...this.pendingQueue];
    this.pendingQueue = [];
    let synced = 0;

    for (const item of pending) {
      const result = await this.syncObservation(item);
      if (result.success) synced++;
    }

    return synced;
  }

  /**
   * Get count of pending items.
   */
  getPendingCount(): number {
    return this.pendingQueue.length;
  }

  /**
   * Clear pending queue.
   */
  clearPending(): void {
    this.pendingQueue = [];
  }
}

// Singleton instance
export const remoteSync = new RemoteSync();
