/**
 * Tests for MCP audit logger.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { auditLog } from "../audit-logger";

describe("auditLog", () => {
  let stderrOutput: string[];
  const originalWrite = process.stderr.write;

  beforeEach(() => {
    stderrOutput = [];
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  test("writes structured JSON to stderr", () => {
    auditLog("mem_search", { q: "test" }, 42, true);

    expect(stderrOutput).toHaveLength(1);
    const entry = JSON.parse(stderrOutput[0].replace("[audit] ", ""));
    expect(entry.tool).toBe("mem_search");
    expect(entry.args_keys).toEqual(["q"]);
    expect(entry.duration_ms).toBe(42);
    expect(entry.success).toBe(true);
    expect(entry.error).toBeUndefined();
  });

  test("includes error when provided", () => {
    auditLog("mem_search", {}, 10, false, "Something broke");

    const entry = JSON.parse(stderrOutput[0].replace("[audit] ", ""));
    expect(entry.success).toBe(false);
    expect(entry.error).toBe("Something broke");
  });

  test("truncates long error messages", () => {
    const longError = "x".repeat(300);
    auditLog("mem_search", {}, 10, false, longError);

    const entry = JSON.parse(stderrOutput[0].replace("[audit] ", ""));
    expect(entry.error.length).toBeLessThan(210);
    expect(entry.error).toContain("...");
  });

  test("logs only key names, not values", () => {
    auditLog("mem_ingest", { content: "secret data", title: "hi" }, 5, true);

    const raw = stderrOutput[0];
    expect(raw).not.toContain("secret data");
    const entry = JSON.parse(raw.replace("[audit] ", ""));
    expect(entry.args_keys).toEqual(["content", "title"]);
  });

  test("includes ISO timestamp", () => {
    auditLog("mem_status", {}, 1, true);

    const entry = JSON.parse(stderrOutput[0].replace("[audit] ", ""));
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
