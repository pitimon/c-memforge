#!/usr/bin/env bun
/**
 * Dependency Check Script
 *
 * Verifies that the required thedotmack/claude-mem plugin is installed.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface InstallVersion {
  version: string;
  bun: string;
  installedAt: string;
}

/**
 * Check if claude-mem plugin is installed.
 * Checks multiple indicators: .install-version file, plugin cache dir, or claude-mem DB.
 */
export function isClaudeMemInstalled(): boolean {
  const home = homedir();
  const marketplacePath = join(home, ".claude/plugins/marketplaces/thedotmack");
  const versionFile = join(marketplacePath, ".install-version");
  const cachePath = join(home, ".claude/plugins/cache/thedotmack/claude-mem");
  const dbPath = join(home, ".claude-mem/claude-mem.db");

  return (
    (existsSync(marketplacePath) && existsSync(versionFile)) ||
    (existsSync(marketplacePath) && existsSync(cachePath)) ||
    existsSync(dbPath)
  );
}

/**
 * Get claude-mem plugin version.
 */
export function getClaudeMemVersion(): string | null {
  const versionFile = join(
    homedir(),
    ".claude/plugins/marketplaces/thedotmack/.install-version",
  );
  if (!existsSync(versionFile)) return null;
  try {
    const data: InstallVersion = JSON.parse(readFileSync(versionFile, "utf-8"));
    return data.version;
  } catch {
    return null;
  }
}

/**
 * Check dependency and exit if not found.
 */
export function checkDependency(): void {
  console.log("Checking dependencies...");
  console.log("");

  if (!isClaudeMemInstalled()) {
    console.error("❌ Required: thedotmack/claude-mem plugin");
    console.error("");
    console.error("Install with:");
    console.error("  /plugin marketplace add thedotmack/claude-mem");
    console.error("");
    process.exit(1);
  }

  const version = getClaudeMemVersion();
  console.log(`✓ claude-mem ${version || "unknown"} detected`);
  console.log("");
  console.log("All dependencies satisfied!");
}

// Run if executed directly
if (import.meta.main) {
  checkDependency();
}
