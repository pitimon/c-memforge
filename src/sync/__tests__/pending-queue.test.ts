/**
 * Tests for PendingQueue — in-memory retry queue for failed sync operations.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { PendingQueue } from "../pending-queue";

describe("PendingQueue", () => {
  let queue: PendingQueue;

  beforeEach(() => {
    queue = new PendingQueue();
  });

  test("starts empty", () => {
    expect(queue.size()).toBe(0);
    expect(queue.getRetryItems()).toEqual([]);
  });

  test("add() inserts item", () => {
    queue.add({ id: 1, title: "test" });
    expect(queue.size()).toBe(1);
  });

  test("add() deduplicates by id", () => {
    queue.add({ id: 1, title: "first" });
    queue.add({ id: 1, title: "second" });
    expect(queue.size()).toBe(1);
  });

  test("add() increments retryCount on duplicate", () => {
    queue.add({ id: 1, title: "test" });
    queue.add({ id: 1, title: "test" });
    queue.add({ id: 1, title: "test" });
    const items = queue.getRetryItems();
    expect(items[0].retryCount).toBe(2);
  });

  test("remove() deletes item by id", () => {
    queue.add({ id: 1, title: "a" });
    queue.add({ id: 2, title: "b" });
    queue.remove(1);
    expect(queue.size()).toBe(1);
  });

  test("getRetryItems() excludes items exceeding max retries", () => {
    queue.add({ id: 1, title: "test" });
    // Increment retry 5 times to exceed maxRetries (5)
    for (let i = 0; i < 5; i++) {
      queue.incrementRetry(1);
    }
    expect(queue.getRetryItems()).toEqual([]);
    expect(queue.size()).toBe(1); // still in queue, just not retryable
  });

  test("clearFailed() removes items exceeding max retries", () => {
    queue.add({ id: 1, title: "will-fail" });
    queue.add({ id: 2, title: "will-succeed" });
    for (let i = 0; i < 5; i++) {
      queue.incrementRetry(1);
    }
    queue.clearFailed();
    expect(queue.size()).toBe(1); // only id:2 remains
  });

  test("clear() removes all items", () => {
    queue.add({ id: 1, title: "a" });
    queue.add({ id: 2, title: "b" });
    queue.clear();
    expect(queue.size()).toBe(0);
  });

  test("incrementRetry() on non-existent id is no-op", () => {
    queue.incrementRetry(999);
    expect(queue.size()).toBe(0);
  });
});
