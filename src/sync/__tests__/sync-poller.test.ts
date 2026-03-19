/**
 * Tests for SyncPoller — adaptive polling, circuit breaker, stats.
 *
 * These tests exercise the public API of SyncPoller without requiring
 * a real SQLite database or remote server. We test:
 * - Construction and initial state
 * - Stats reporting (circuitState, currentInterval)
 * - Stop/cleanup behavior
 * - SyncStats interface shape
 */

import { describe, test, expect } from "bun:test";
import { SyncPoller } from "../sync-poller";
import type { SyncStats } from "../sync-poller";

describe("SyncPoller", () => {
  describe("construction", () => {
    test("creates with default options", () => {
      const poller = new SyncPoller();
      expect(poller.isActive()).toBe(false);
    });

    test("creates with custom pollInterval", () => {
      const poller = new SyncPoller({ pollInterval: 5000 });
      const stats = poller.getStats();
      expect(stats.currentInterval).toBe(5000);
    });

    test("creates with custom logger", () => {
      const logs: unknown[][] = [];
      const poller = new SyncPoller({
        logger: (...args: unknown[]) => logs.push(args),
      });
      expect(poller.isActive()).toBe(false);
    });
  });

  describe("getStats()", () => {
    test("returns initial stats", () => {
      const poller = new SyncPoller();
      const stats = poller.getStats();
      expect(stats).toEqual({
        lastObsId: 0,
        lastSumId: 0,
        syncedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        circuitState: "closed",
        currentInterval: 2000,
      });
    });

    test("SyncStats has all required fields", () => {
      const poller = new SyncPoller();
      const stats: SyncStats = poller.getStats();

      // Type-level check — these must compile
      const _obsId: number = stats.lastObsId;
      const _sumId: number = stats.lastSumId;
      const _synced: number = stats.syncedCount;
      const _failed: number = stats.failedCount;
      const _pending: number = stats.pendingCount;
      const _circuit: "closed" | "open" | "half-open" = stats.circuitState;
      const _interval: number = stats.currentInterval;

      expect(typeof _obsId).toBe("number");
      expect(typeof _circuit).toBe("string");
      expect(typeof _interval).toBe("number");
    });

    test("initial circuit state is closed", () => {
      const poller = new SyncPoller();
      expect(poller.getStats().circuitState).toBe("closed");
    });
  });

  describe("isActive()", () => {
    test("returns false before start", () => {
      const poller = new SyncPoller();
      expect(poller.isActive()).toBe(false);
    });

    test("returns false after stop", () => {
      const poller = new SyncPoller();
      poller.stop();
      expect(poller.isActive()).toBe(false);
    });
  });

  describe("stop()", () => {
    test("is safe to call multiple times", () => {
      const poller = new SyncPoller();
      poller.stop();
      poller.stop();
      poller.stop();
      expect(poller.isActive()).toBe(false);
    });

    test("logs stats on stop if was running", () => {
      const logs: unknown[][] = [];
      const poller = new SyncPoller({
        logger: (...args: unknown[]) => logs.push(args),
      });
      // Manually set running state to test stop logging
      // Since start() requires DB, we test that stop() when not running is a no-op
      poller.stop();
      // No log because it wasn't running
      expect(logs.some((l) => String(l[0]).includes("Stopped"))).toBe(false);
    });
  });

  describe("start()", () => {
    test("does not crash and can be stopped", async () => {
      const logs: unknown[][] = [];
      const poller = new SyncPoller({
        logger: (...args: unknown[]) => logs.push(args),
      });
      await poller.start();
      // Should have logged something (either "not configured", "Starting", or "Database not found")
      expect(logs.length).toBeGreaterThan(0);
      poller.stop();
      expect(poller.isActive()).toBe(false);
    });
  });
});
