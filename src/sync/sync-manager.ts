#!/usr/bin/env bun
/**
 * Sync Manager
 *
 * Process lifecycle manager for the database watcher.
 * Commands: start, stop, status
 *
 * Used by hooks to auto-start/stop the sync watcher
 * when Claude Code sessions begin and end.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { openSync } from 'fs';
import { resolveConfigPath } from '../mcp/api-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '../..');
const CLAUDE_MEM_DIR = join(homedir(), '.claude-mem');
const PID_FILE = join(CLAUDE_MEM_DIR, 'memforge-sync.pid');
const LOG_FILE = join(CLAUDE_MEM_DIR, 'memforge-sync.log');
const DB_WATCHER_PATH = join(__dirname, 'db-watcher.ts');

/**
 * Resolve the full path to the bun executable.
 * Checks process.execPath (when run via bun), then common install locations.
 */
function resolveBunPath(): string {
  // If currently running under bun, use the same executable
  if (process.execPath && process.execPath.endsWith('bun')) {
    return process.execPath;
  }

  // Check common bun install locations
  const candidates = [
    join(homedir(), '.bun', 'bin', 'bun'),
    '/usr/local/bin/bun',
    '/usr/bin/bun',
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Fallback to bare 'bun' (hope it's in PATH)
  return 'bun';
}

interface PidInfo {
  pid: number;
  startedAt: string;
  pluginRoot: string;
}

/**
 * Output a hook-compatible JSON response.
 */
function hookResponse(message: string): void {
  console.log(JSON.stringify({
    continue: true,
    suppressOutput: true,
    message
  }));
}

/**
 * Ensure the .claude-mem directory exists.
 */
function ensureDir(): void {
  if (!existsSync(CLAUDE_MEM_DIR)) {
    mkdirSync(CLAUDE_MEM_DIR, { recursive: true });
  }
}

/**
 * Read PID info from file.
 */
function readPidInfo(): PidInfo | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    return JSON.parse(readFileSync(PID_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Check if a process with given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the database watcher as a detached background process.
 */
function start(): void {
  // Check config exists
  const configPath = resolveConfigPath();
  if (!configPath) {
    hookResponse('Sync not configured. Run: bun run setup');
    return;
  }

  // Check if sync is enabled in config
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (!config.syncEnabled) {
      hookResponse('Sync disabled in config');
      return;
    }
  } catch {
    hookResponse('Failed to read config');
    return;
  }

  // Check if already running
  const pidInfo = readPidInfo();
  if (pidInfo && isProcessAlive(pidInfo.pid)) {
    hookResponse(`Watcher already running (PID: ${pidInfo.pid})`);
    return;
  }

  // Clean up stale PID file
  if (pidInfo) {
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  }

  ensureDir();

  // Open log file for stdout/stderr redirection
  const logFd = openSync(LOG_FILE, 'a');

  // Spawn detached watcher process with resolved bun path
  const bunPath = resolveBunPath();
  const child = spawn(bunPath, [DB_WATCHER_PATH], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: PLUGIN_ROOT,
    env: { ...process.env }
  });

  if (!child.pid) {
    hookResponse('Failed to start watcher');
    return;
  }

  // Write PID file
  const info: PidInfo = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    pluginRoot: PLUGIN_ROOT
  };
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));

  // Detach child so this process can exit
  child.unref();

  hookResponse(`Watcher started (PID: ${child.pid})`);
}

/**
 * Stop the database watcher.
 */
function stop(): void {
  const pidInfo = readPidInfo();

  if (!pidInfo) {
    hookResponse('Watcher not running (no PID file)');
    return;
  }

  if (isProcessAlive(pidInfo.pid)) {
    try {
      process.kill(pidInfo.pid, 'SIGTERM');
    } catch (err) {
      hookResponse(`Failed to stop watcher: ${err}`);
      return;
    }
  }

  // Remove PID file
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }

  hookResponse(`Watcher stopped (PID: ${pidInfo.pid})`);
}

/**
 * Show watcher status.
 */
function status(): void {
  const pidInfo = readPidInfo();

  if (!pidInfo) {
    console.log('Status: NOT RUNNING (no PID file)');
    return;
  }

  const alive = isProcessAlive(pidInfo.pid);
  console.log(`Status: ${alive ? 'RUNNING' : 'STOPPED (stale PID)'}`);
  console.log(`PID: ${pidInfo.pid}`);
  console.log(`Started: ${pidInfo.startedAt}`);
  console.log(`Plugin: ${pidInfo.pluginRoot}`);
  console.log(`Log: ${LOG_FILE}`);

  if (!alive) {
    // Clean up stale PID file
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    console.log('(Cleaned up stale PID file)');
  }
}

// CLI entry point
if (import.meta.main) {
  const command = process.argv[2];

  switch (command) {
    case 'start':
      start();
      break;
    case 'stop':
      stop();
      break;
    case 'status':
      status();
      break;
    default:
      console.log('Usage: sync-manager <start|stop|status>');
      process.exit(1);
  }
}
