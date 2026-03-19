/**
 * Pending Queue
 *
 * In-memory queue for failed sync operations.
 * Items are retried during the poll cycle.
 * Lost on process restart — safe because server dedup
 * handles overlap when SyncPoller re-queries MAX(id).
 */

interface QueueItem {
  id: number;
  observation: Record<string, unknown>;
  addedAt: string;
  retryCount: number;
}

/**
 * In-memory queue for failed sync items.
 */
export class PendingQueue {
  private items: QueueItem[] = [];
  private maxRetries = 5;

  /**
   * Add item to queue.
   */
  add(observation: Record<string, unknown>): void {
    const id = observation.id as number;

    // Check if already in queue
    const existing = this.items.find((item) => item.id === id);
    if (existing) {
      existing.retryCount++;
      return;
    }

    this.items.push({
      id,
      observation,
      addedAt: new Date().toISOString(),
      retryCount: 0,
    });
  }

  /**
   * Remove item from queue.
   */
  remove(id: number): void {
    this.items = this.items.filter((item) => item.id !== id);
  }

  /**
   * Get items ready for retry.
   */
  getRetryItems(): QueueItem[] {
    return this.items.filter((item) => item.retryCount < this.maxRetries);
  }

  /**
   * Increment retry count for an item.
   */
  incrementRetry(id: number): void {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.retryCount++;
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
  }

  /**
   * Clear only failed items (exceeded max retries).
   */
  clearFailed(): void {
    this.items = this.items.filter((item) => item.retryCount < this.maxRetries);
  }
}

// Singleton instance
export const pendingQueue = new PendingQueue();
