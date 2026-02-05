/**
 * Pending Queue
 *
 * Persistent queue for failed sync operations.
 * Stores pending items to disk for retry after restart.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '../..');
const QUEUE_PATH = join(PLUGIN_ROOT, '.sync-queue.json');

interface QueueItem {
  id: number;
  observation: Record<string, unknown>;
  addedAt: string;
  retryCount: number;
}

/**
 * Persistent queue for failed sync items.
 */
export class PendingQueue {
  private items: QueueItem[] = [];
  private maxRetries = 5;

  constructor() {
    this.load();
  }

  /**
   * Load queue from disk.
   */
  private load(): void {
    try {
      if (existsSync(QUEUE_PATH)) {
        const data = JSON.parse(readFileSync(QUEUE_PATH, 'utf-8'));
        this.items = data.items || [];
      }
    } catch {
      this.items = [];
    }
  }

  /**
   * Save queue to disk.
   */
  private save(): void {
    try {
      const dir = dirname(QUEUE_PATH);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(QUEUE_PATH, JSON.stringify({ items: this.items }, null, 2));
    } catch (error) {
      console.error('Failed to save queue:', error);
    }
  }

  /**
   * Add item to queue.
   */
  add(observation: Record<string, unknown>): void {
    const id = observation.id as number;

    // Check if already in queue
    const existing = this.items.find(item => item.id === id);
    if (existing) {
      existing.retryCount++;
      this.save();
      return;
    }

    this.items.push({
      id,
      observation,
      addedAt: new Date().toISOString(),
      retryCount: 0
    });
    this.save();
  }

  /**
   * Remove item from queue.
   */
  remove(id: number): void {
    this.items = this.items.filter(item => item.id !== id);
    this.save();
  }

  /**
   * Get items ready for retry.
   */
  getRetryItems(): QueueItem[] {
    return this.items.filter(item => item.retryCount < this.maxRetries);
  }

  /**
   * Get items that exceeded max retries.
   */
  getFailedItems(): QueueItem[] {
    return this.items.filter(item => item.retryCount >= this.maxRetries);
  }

  /**
   * Increment retry count for an item.
   */
  incrementRetry(id: number): void {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.retryCount++;
      this.save();
    }
  }

  /**
   * Get queue size.
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Clear all items.
   */
  clear(): void {
    this.items = [];
    this.save();
  }

  /**
   * Clear only failed items (exceeded max retries).
   */
  clearFailed(): void {
    this.items = this.items.filter(item => item.retryCount < this.maxRetries);
    this.save();
  }
}

// Singleton instance
export const pendingQueue = new PendingQueue();
