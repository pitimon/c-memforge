#!/usr/bin/env bun
/**
 * Setup Script
 *
 * Configure API key for MemForge client.
 *
 * Usage:
 *   bun run setup [api-key]     # Quick setup with API key
 *   bun run setup               # Interactive setup
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';
import { isClaudeMemInstalled, getClaudeMemVersion } from './check-dependency';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const MEMFORGE_DIR = join(homedir(), '.memforge');
const CONFIG_PATH = join(MEMFORGE_DIR, 'config.json');
const LEGACY_CONFIG = join(PLUGIN_ROOT, 'config.local.json');
const CONFIG_EXAMPLE = join(PLUGIN_ROOT, 'config.example.json');
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

/**
 * Resolve the full path to the bun executable for hook commands.
 */
function resolveBunPath(): string {
  if (process.execPath && process.execPath.endsWith('bun')) {
    return process.execPath;
  }
  const candidates = [
    join(homedir(), '.bun', 'bin', 'bun'),
    '/usr/local/bin/bun',
    '/usr/bin/bun',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'bun';
}

interface Config {
  apiKey: string;
  serverUrl: string;
  syncEnabled: boolean;
  pollInterval: number;
  role: 'client' | 'admin';
}

/**
 * Prompt user for input.
 */
function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())));
}

/**
 * Mask API key for display.
 */
function mask(key: string): string {
  if (!key) return '(not set)';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

/**
 * Migrate config from legacy location to canonical path.
 */
function migrateConfigIfNeeded(): void {
  if (existsSync(CONFIG_PATH)) return; // Already migrated
  if (!existsSync(LEGACY_CONFIG)) return; // Nothing to migrate

  console.log('Migrating config to ~/.memforge/config.json...');
  if (!existsSync(MEMFORGE_DIR)) {
    mkdirSync(MEMFORGE_DIR, { recursive: true });
  }
  const legacyContent = readFileSync(LEGACY_CONFIG, 'utf-8');
  writeFileSync(CONFIG_PATH, legacyContent);
  console.log('  Config migrated successfully');
}

/**
 * Register SessionStart hook in ~/.claude/settings.json (idempotent).
 */
function registerHooks(): void {
  const bunPath = resolveBunPath();
  const hookCommand = `${bunPath} "${PLUGIN_ROOT}/src/sync/sync-manager.ts" start`;

  let settings: Record<string, unknown> = {};
  if (existsSync(CLAUDE_SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
    } catch {
      console.error('  Warning: Could not parse ~/.claude/settings.json');
      return;
    }
  }

  // Ensure hooks structure exists
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const sessionStart = (hooks.SessionStart ?? []) as Array<Record<string, unknown>>;

  // Check if our hook is already registered
  const alreadyRegistered = sessionStart.some((entry) => {
    const entryHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
    return entryHooks?.some((h) => typeof h.command === 'string' && h.command.includes('sync-manager.ts'));
  });

  if (alreadyRegistered) {
    console.log('  SessionStart hook already registered');
    removeStopHook(settings);
    return;
  }

  // Add our SessionStart hook
  sessionStart.push({
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: hookCommand,
        timeout: 30
      }
    ]
  });

  hooks.SessionStart = sessionStart;
  settings.hooks = hooks;

  // Ensure .claude directory exists
  const claudeDir = join(homedir(), '.claude');
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log('  SessionStart hook registered in ~/.claude/settings.json');

  removeStopHook(settings);
}

/**
 * Remove any memforge Stop hooks from settings.json.
 */
function removeStopHook(settings?: Record<string, unknown>): void {
  if (!settings) {
    if (!existsSync(CLAUDE_SETTINGS_PATH)) return;
    try {
      settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
    } catch {
      return;
    }
  }

  const hooks = (settings!.hooks ?? {}) as Record<string, unknown>;
  const stopHooks = hooks.Stop as Array<Record<string, unknown>> | undefined;
  if (!stopHooks || !Array.isArray(stopHooks)) return;

  const filtered = stopHooks.filter((entry) => {
    const entryHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
    return !entryHooks?.some((h) => typeof h.command === 'string' && h.command.includes('sync-manager.ts'));
  });

  if (filtered.length === stopHooks.length) return; // No memforge Stop hooks found

  if (filtered.length === 0) {
    delete hooks.Stop;
  } else {
    hooks.Stop = filtered;
  }
  settings!.hooks = hooks;
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log('  Removed old Stop hook from settings.json');
}

/**
 * Load existing config with migration support.
 */
function loadConfig(): Config {
  // Try canonical path first
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
  // Try legacy path
  if (existsSync(LEGACY_CONFIG)) {
    return JSON.parse(readFileSync(LEGACY_CONFIG, 'utf-8'));
  }
  // Try example
  if (existsSync(CONFIG_EXAMPLE)) {
    return JSON.parse(readFileSync(CONFIG_EXAMPLE, 'utf-8'));
  }
  // Default
  return {
    apiKey: '',
    serverUrl: 'https://memclaude.thaicloud.ai',
    syncEnabled: true,
    pollInterval: 2000,
    role: 'client'
  };
}

/**
 * Save config to canonical path.
 */
function saveConfig(config: Config): void {
  if (!existsSync(MEMFORGE_DIR)) {
    mkdirSync(MEMFORGE_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Quick setup with API key from argument.
 */
async function quickSetup(apiKey: string): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  MemForge Client - Quick Setup               ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // Check claude-mem dependency
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

  // Migrate old config if needed
  migrateConfigIfNeeded();

  // Load or create config
  const config = loadConfig();
  config.apiKey = apiKey;
  if (!config.role) config.role = 'client';

  // Save config to canonical location
  saveConfig(config);

  console.log(`✓ API key configured: ${mask(apiKey)}`);
  console.log(`✓ Server: ${config.serverUrl}`);
  console.log(`✓ Config saved to: ${CONFIG_PATH}`);
  console.log('');

  // Register hooks
  console.log('Registering hooks...');
  registerHooks();
  console.log('');

  console.log('Configuration complete! Restart Claude Code to use the plugin.');
  console.log('');
}

/**
 * Interactive setup.
 */
async function interactiveSetup(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  MemForge Client Setup                       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // 1. Check claude-mem dependency
  console.log('Checking dependencies...');
  if (!isClaudeMemInstalled()) {
    console.error('');
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

  // 2. Migrate old config if needed
  migrateConfigIfNeeded();

  // 3. Load config
  const config = loadConfig();
  if (!config.role) config.role = 'client';

  // 4. Check if already configured
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  if (config.apiKey) {
    console.log('Current configuration:');
    console.log(`  API Key: ${mask(config.apiKey)}`);
    console.log(`  Server: ${config.serverUrl}`);
    console.log(`  Sync: ${config.syncEnabled ? 'enabled' : 'disabled'}`);
    console.log(`  Role: ${config.role}`);
    console.log('');

    const reconfigure = await question(rl, 'Reconfigure? (y/N): ');
    if (reconfigure.toLowerCase() !== 'y') {
      console.log('');
      console.log('Configuration unchanged.');
      rl.close();
      return;
    }
    console.log('');
  }

  // 5. Interactive setup
  console.log('Get your API key at: https://memclaude.thaicloud.ai/settings');
  console.log('');

  // API Key
  const currentKeyDisplay = config.apiKey ? ` [${mask(config.apiKey)}]` : '';
  const apiKey = await question(rl, `API Key${currentKeyDisplay}: `);
  if (apiKey) config.apiKey = apiKey;

  // Server URL
  const serverUrl = await question(rl, `Server URL [${config.serverUrl}]: `);
  if (serverUrl) config.serverUrl = serverUrl;

  // Sync enabled
  const syncDefault = config.syncEnabled ? 'Y/n' : 'y/N';
  const syncInput = await question(rl, `Enable sync? (${syncDefault}): `);
  if (syncInput) {
    config.syncEnabled = syncInput.toLowerCase() === 'y';
  }

  // Role selection
  const roleDefault = config.role || 'client';
  const roleInput = await question(rl, `Role (client/admin) [${roleDefault}]: `);
  if (roleInput === 'admin') {
    config.role = 'admin';
  } else {
    config.role = 'client';
  }

  rl.close();

  // 6. Validate
  if (!config.apiKey) {
    console.error('');
    console.error('❌ API key is required');
    console.error('');
    process.exit(1);
  }

  // 7. Save config
  saveConfig(config);

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Configuration Complete!                     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`Config saved to: ${CONFIG_PATH}`);
  console.log('');

  // 8. Register hooks
  console.log('Registering hooks...');
  registerHooks();
  console.log('');

  console.log('Restart Claude Code to use the plugin.');
  console.log('');
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] && !args[0].startsWith('-')) {
    // Quick setup with API key from argument
    await quickSetup(args[0]);
  } else {
    // Interactive setup
    await interactiveSetup();
  }
}

// Run
main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
