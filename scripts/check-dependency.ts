#!/usr/bin/env bun
/**
 * Dependency Check Script
 *
 * Verifies that the required thedotmack/claude-mem plugin is installed.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface InstallVersion {
  version: string;
  bun: string;
  installedAt: string;
}

/**
 * Check if claude-mem plugin is installed.
 */
export function isClaudeMemInstalled(): boolean {
  const installPath = join(homedir(), '.claude/plugins/marketplaces/thedotmack');
  const versionFile = join(installPath, '.install-version');
  return existsSync(installPath) && existsSync(versionFile);
}

/**
 * Get claude-mem plugin version.
 */
export function getClaudeMemVersion(): string | null {
  const versionFile = join(homedir(), '.claude/plugins/marketplaces/thedotmack/.install-version');
  if (!existsSync(versionFile)) return null;
  try {
    const data: InstallVersion = JSON.parse(readFileSync(versionFile, 'utf-8'));
    return data.version;
  } catch {
    return null;
  }
}

/**
 * Check dependency and exit if not found.
 */
export function checkDependency(): void {
  console.log('Checking dependencies...');
  console.log('');

  if (!isClaudeMemInstalled()) {
    console.error('❌ Required: thedotmack/claude-mem plugin');
    console.error('');
    console.error('Install with:');
    console.error('  /plugin marketplace add thedotmack/claude-mem');
    console.error('');
    process.exit(1);
  }

  const version = getClaudeMemVersion();
  console.log(`✓ claude-mem ${version || 'unknown'} detected`);
  console.log('');
  console.log('All dependencies satisfied!');
}

// Run if executed directly
if (import.meta.main) {
  checkDependency();
}
