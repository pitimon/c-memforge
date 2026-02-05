#!/usr/bin/env bun
/**
 * Setup Script
 *
 * Interactive setup for API key configuration.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';
import { isClaudeMemInstalled, getClaudeMemVersion } from './check-dependency';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const CONFIG_PATH = join(PLUGIN_ROOT, 'config.local.json');
const CONFIG_EXAMPLE = join(PLUGIN_ROOT, 'config.example.json');

interface Config {
  apiKey: string;
  serverUrl: string;
  syncEnabled: boolean;
  pollInterval: number;
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
 * Main setup function.
 */
async function setup(): Promise<void> {
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

  // 2. Load or create config
  let config: Config;
  if (existsSync(CONFIG_PATH)) {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } else if (existsSync(CONFIG_EXAMPLE)) {
    copyFileSync(CONFIG_EXAMPLE, CONFIG_PATH);
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } else {
    config = {
      apiKey: '',
      serverUrl: 'https://memclaude.thaicloud.ai',
      syncEnabled: true,
      pollInterval: 2000
    };
  }

  // 3. Check if already configured
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  if (config.apiKey) {
    console.log('Current configuration:');
    console.log(`  API Key: ${mask(config.apiKey)}`);
    console.log(`  Server: ${config.serverUrl}`);
    console.log(`  Sync: ${config.syncEnabled ? 'enabled' : 'disabled'}`);
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

  // 4. Interactive setup
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

  rl.close();

  // 5. Validate
  if (!config.apiKey) {
    console.error('');
    console.error('❌ API key is required');
    console.error('');
    process.exit(1);
  }

  // 6. Save config
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Configuration Complete!                     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`Config saved to: ${CONFIG_PATH}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Add plugin to Claude Code:');
  console.log(`     /plugin add ${PLUGIN_ROOT}`);
  console.log('');
  console.log('  2. (Optional) Start sync service:');
  console.log('     bun run sync');
  console.log('');
}

// Run
setup().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
