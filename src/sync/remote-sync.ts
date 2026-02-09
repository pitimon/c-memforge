/**
 * Remote Sync Service
 *
 * Handles syncing observations from local claude-mem to remote server.
 */

import { readFileSync } from 'fs';
import { pendingQueue } from './pending-queue';
import { resolveConfigPath } from '../mcp/api-client';

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

  constructor() {
    this.loadConfig();
  }

  /**
   * Load configuration from resolved config path.
   */
  private loadConfig(): void {
    const configPath = resolveConfigPath();
    if (!configPath) {
      console.error('Config not found. Run: bun run setup');
      return;
    }

    try {
      const config: Config = JSON.parse(readFileSync(configPath, 'utf-8'));
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
   * Uses /api/sync/push endpoint with observations array wrapper.
   */
  async syncObservation(observation: Record<string, unknown>): Promise<SyncResult> {
    if (!this.config || !this.config.syncEnabled) {
      return { success: false, error: 'Sync not configured or disabled' };
    }

    try {
      // Server expects observations wrapped in an array
      const response = await fetch(`${this.config.serverUrl}/api/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify({ observations: [observation] }),
        signal: AbortSignal.timeout(30000) // 30s timeout
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        pendingQueue.add(observation);
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      return { success: true };
    } catch (err) {
      pendingQueue.add(observation);
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Sync multiple observations in batch.
   * Uses /api/sync/push endpoint which handles multiple observations.
   */
  async syncBatch(observations: Record<string, unknown>[]): Promise<{ synced: number; failed: number }> {
    if (!this.config || !this.config.syncEnabled) {
      return { synced: 0, failed: observations.length };
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/api/sync/push`, {
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

      const result = await response.json() as { observations?: { inserted: number; updated: number } };
      const totalSynced = (result.observations?.inserted || 0) + (result.observations?.updated || 0);
      return { synced: totalSynced || observations.length, failed: 0 };
    } catch (err) {
      // Queue all for retry via persistent disk queue
      for (const obs of observations) {
        pendingQueue.add(obs);
      }
      return { synced: 0, failed: observations.length };
    }
  }

  /**
   * Retry pending failed syncs from persistent disk queue.
   */
  async retryPending(): Promise<number> {
    const retryItems = pendingQueue.getRetryItems();
    let synced = 0;

    for (const item of retryItems) {
      const result = await this.syncObservation(item.observation);
      if (result.success) {
        pendingQueue.remove(item.id);
        synced++;
      } else {
        pendingQueue.incrementRetry(item.id);
      }
    }

    return synced;
  }

  /**
   * Get count of pending items.
   */
  getPendingCount(): number {
    return pendingQueue.size();
  }

  /**
   * Sync summaries to the remote server.
   * Uses /api/sync/push endpoint with summaries array wrapper.
   */
  async syncSummaries(summaries: Record<string, unknown>[]): Promise<{ synced: number; failed: number }> {
    if (!this.config || !this.config.syncEnabled) {
      return { synced: 0, failed: summaries.length };
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/api/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify({ summaries }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        return { synced: 0, failed: summaries.length };
      }

      const result = await response.json() as { summaries?: { inserted: number; updated: number } };
      const totalSynced = (result.summaries?.inserted || 0) + (result.summaries?.updated || 0);
      return { synced: totalSynced || summaries.length, failed: 0 };
    } catch {
      return { synced: 0, failed: summaries.length };
    }
  }

  /**
   * Clear pending queue.
   */
  clearPending(): void {
    pendingQueue.clear();
  }
}

// Singleton instance
export const remoteSync = new RemoteSync();
