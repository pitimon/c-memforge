/**
 * Regression tests for the SessionStart hook resolver in
 * `.claude-plugin/hooks/hooks.json` (issue #81).
 *
 * The resolver is shell, not TypeScript, so these tests execute the *actual*
 * command string from hooks.json against a throwaway cache fixture (pointed at
 * via CLAUDE_CONFIG_DIR). Each fixture version gets a stub hook that prints its
 * own version, so the assertion is "which copy did the resolver actually exec",
 * not "does the string look right".
 *
 * The bug being locked out: the old fallback used `ls -dt | head -1` (newest
 * *mtime*), so touching a stale cache directory silently redirected the hook to
 * an older — or entirely hook-less — copy.
 */
import { describe, expect, it, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOOKS_JSON = join(import.meta.dir, "../../../.claude-plugin/hooks/hooks.json");

/** The real command string shipped to Claude Code. */
const COMMAND: string = JSON.parse(
  await Bun.file(HOOKS_JSON).text(),
).hooks.SessionStart[0].hooks[0].command;

const CACHE_REL = "plugins/cache/pitimon-c-memforge/memforge-client";
const roots: string[] = [];

/** Build a fake CLAUDE_CONFIG_DIR whose cache holds `versions`. */
function makeFixture(versions: { v: string; withHook: boolean }[]): string {
  const root = mkdtempSync(join(tmpdir(), "cmem-resolver-"));
  roots.push(root);
  for (const { v, withHook } of versions) {
    const dir = join(root, CACHE_REL, v);
    mkdirSync(join(dir, "src", "hooks"), { recursive: true });
    if (withHook) {
      // Stub stands in for the real hook: identifies which copy was exec'd.
      writeFileSync(
        join(dir, "src", "hooks", "session-context.ts"),
        `console.log("RESOLVED=${v}");\n`,
      );
    }
  }
  return root;
}

/** Run the real resolver command; returns trimmed stdout (empty when it exits early). */
function runResolver(configDir: string): string {
  return execFileSync("bash", ["-c", COMMAND], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_PLUGIN_ROOT: "", // force the cache-scan fallback under test
    },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    input: "{}",
  }).trim();
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe("hooks.json SessionStart resolver", () => {
  it("picks the highest SEMVER version, not the lexically largest", () => {
    // Lexical sort would rank "2.9.0" above "2.14.0" — the trap plain `sort` falls into.
    const root = makeFixture([
      { v: "2.9.0", withHook: true },
      { v: "2.13.0", withHook: true },
      { v: "2.14.0", withHook: true },
    ]);
    expect(runResolver(root)).toBe("RESOLVED=2.14.0");
  });

  it("ignores mtime — a freshly touched OLD copy must not win (issue #81)", () => {
    const root = makeFixture([
      { v: "2.13.0", withHook: true },
      { v: "2.14.0", withHook: true },
    ]);
    // Make the stale copy the newest by mtime: this is exactly what broke before.
    const now = new Date();
    utimesSync(join(root, CACHE_REL, "2.13.0"), now, now);
    expect(runResolver(root)).toBe("RESOLVED=2.14.0");
  });

  it("skips a newer copy that has no hook file and falls back to the next version", () => {
    // Legacy copies (< 2.12.0) predate the hook entirely; selecting one made the
    // resolver's `[ -f ... ] || exit 0` guard fire and inject nothing at all.
    const root = makeFixture([
      { v: "2.11.0", withHook: false },
      { v: "2.12.0", withHook: true },
      { v: "2.15.0", withHook: false },
    ]);
    expect(runResolver(root)).toBe("RESOLVED=2.12.0");
  });

  it("exits 0 with no output when no cached copy has a hook", () => {
    const root = makeFixture([
      { v: "2.10.2", withHook: false },
      { v: "2.11.0", withHook: false },
    ]);
    expect(runResolver(root)).toBe("");
  });

  it("exits 0 with no output when the cache directory does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "cmem-resolver-empty-"));
    roots.push(root);
    expect(runResolver(root)).toBe("");
  });

  it("prefers CLAUDE_PLUGIN_ROOT over the cache scan when it is valid", () => {
    const root = makeFixture([{ v: "2.14.0", withHook: true }]);
    const pinned = mkdtempSync(join(tmpdir(), "cmem-resolver-pinned-"));
    roots.push(pinned);
    mkdirSync(join(pinned, "src", "hooks"), { recursive: true });
    writeFileSync(
      join(pinned, "src", "hooks", "session-context.ts"),
      'console.log("RESOLVED=pinned");\n',
    );
    const out = execFileSync("bash", ["-c", COMMAND], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: root, CLAUDE_PLUGIN_ROOT: pinned },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      input: "{}",
    }).trim();
    expect(out).toBe("RESOLVED=pinned");
  });
});
