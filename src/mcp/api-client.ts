/**
 * MCP Server API Client
 *
 * Centralized API communication with the remote server.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { ToolResponse } from './types';

// Get plugin root directory
const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '../..');

// Canonical config location
const CANONICAL_CONFIG = join(homedir(), '.memforge', 'config.json');
const LEGACY_CONFIG = join(PLUGIN_ROOT, 'config.local.json');

// API Configuration
const DEFAULT_REMOTE_URL = 'https://memclaude.thaicloud.ai';
const REMOTE_TIMEOUT_MS = 30000; // 30 seconds - vector search needs ~2-3s for embedding + similarity
const SEARCH_TIMEOUT_MS = 60000; // 60 seconds for search operations (embedding generation can be slow)

// API Key and URL loading
let remoteApiKey = process.env.CLAUDE_MEM_API_KEY || '';
let remoteApiUrl = process.env.CLAUDE_MEM_REMOTE_URL || DEFAULT_REMOTE_URL;

// Role-based access control
let pluginRole: 'client' | 'admin' = 'client';

// Track which config was loaded for diagnostics
let configSource: string | null = null;

/** Plugin config interface */
interface PluginConfig {
  apiKey?: string;
  serverUrl?: string;
  syncEnabled?: boolean;
  pollInterval?: number;
  role?: 'client' | 'admin';
}

/**
 * Resolve config file path with fallback.
 * Priority: ~/.memforge/config.json > PLUGIN_ROOT/config.local.json
 */
export function resolveConfigPath(): string | null {
  if (existsSync(CANONICAL_CONFIG)) {
    return CANONICAL_CONFIG;
  }
  if (existsSync(LEGACY_CONFIG)) {
    return LEGACY_CONFIG;
  }
  return null;
}

/** Load config from resolved path */
function loadPluginConfig(): PluginConfig | null {
  const configPath = resolveConfigPath();
  if (!configPath) return null;

  try {
    configSource = configPath;
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Initialize API key from plugin config or fallback to claude-mem settings */
export function initializeApiKey(): void {
  // First try plugin-specific config
  const pluginConfig = loadPluginConfig();
  if (pluginConfig?.apiKey) {
    remoteApiKey = pluginConfig.apiKey;
    if (pluginConfig.serverUrl) {
      remoteApiUrl = pluginConfig.serverUrl;
    }
    if (pluginConfig.role) {
      pluginRole = pluginConfig.role;
    }
    process.stderr.write(`[memforge] Config loaded from: ${configSource}\n`);
    return;
  }

  // Fallback to claude-mem settings
  if (!remoteApiKey) {
    try {
      const settingsPath = `${process.env.HOME}/.claude-mem/settings.json`;
      const fs = require('fs');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      remoteApiKey = settings.CLAUDE_MEM_API_KEY || '';
      configSource = settingsPath;
    } catch {
      // Settings not found, remote will be disabled
    }
  }
}

/** Get current plugin role */
export function getRole(): 'client' | 'admin' {
  return pluginRole;
}

/** Get config source path for diagnostics */
export function getConfigSource(): string | null {
  return configSource;
}

/** Check if remote API is enabled */
export function isRemoteEnabled(): boolean {
  return !!remoteApiKey;
}

/** Get remote API URL */
export function getRemoteUrl(): string {
  return remoteApiUrl;
}

/** Get remote API key */
export function getApiKey(): string {
  return remoteApiKey;
}

/** Endpoint mapping from local to remote */
const ENDPOINT_MAP: Record<string, string> = {
  '/hybrid': '/api/search/hybrid',
  '/vector': '/api/search/vector',
  '/search': '/api/search',
  '/timeline': '/api/timeline',
  '/recent': '/api/observations',
  '/observation': '/api/observations/batch',
};

/**
 * Call Remote API with timeout.
 *
 * @param endpoint - Local endpoint name (e.g., '/search')
 * @param params - Query parameters
 * @returns Promise resolving to API response data
 * @throws Error if remote not configured or API error
 */
export async function callRemoteAPI(
  endpoint: string,
  params: Record<string, unknown>
): Promise<unknown> {
  if (!isRemoteEnabled()) {
    throw new Error('Remote search not configured');
  }

  // Use longer timeout for search endpoints (embedding generation is slow)
  const isSearchEndpoint = ['/hybrid', '/vector', '/search'].includes(endpoint) ||
    endpoint.includes('/search');
  const timeout = isSearchEndpoint ? SEARCH_TIMEOUT_MS : REMOTE_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }

    const remoteEndpoint = ENDPOINT_MAP[endpoint] || endpoint;
    const url = `${remoteApiUrl}${remoteEndpoint}?${searchParams}`;

    const response = await fetch(url, {
      headers: { 'X-API-Key': remoteApiKey },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Remote API error (${response.status})`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make a POST request to the remote API.
 *
 * @param endpoint - API endpoint path
 * @param body - Request body
 * @returns Promise resolving to API response
 */
export async function postRemoteAPI(
  endpoint: string,
  body: Record<string, unknown>
): Promise<unknown> {
  if (!isRemoteEnabled()) {
    throw new Error('Remote search not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  try {
    const response = await fetch(`${remoteApiUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'X-API-Key': remoteApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make a DELETE request to the remote API.
 *
 * @param endpoint - API endpoint path
 * @returns Promise resolving to API response
 */
export async function deleteRemoteAPI(endpoint: string): Promise<unknown> {
  if (!isRemoteEnabled()) {
    throw new Error('Remote search not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  try {
    const response = await fetch(`${remoteApiUrl}${endpoint}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': remoteApiKey },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make a POST request to fetch observations by IDs.
 *
 * @param ids - Array of observation IDs
 * @returns Promise resolving to observations
 */
export async function fetchObservationsByIds(ids: number[]): Promise<unknown> {
  if (!isRemoteEnabled()) {
    throw new Error('Remote search not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${remoteApiUrl}/api/observations/batch`,
      {
        method: 'POST',
        headers: {
          'X-API-Key': remoteApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`Remote API error (${response.status})`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Wrap error in ToolResponse format.
 *
 * @param error - Error to wrap
 * @returns ToolResponse with error
 */
export function wrapError(error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Create success ToolResponse.
 *
 * @param text - Response text
 * @returns ToolResponse with content
 */
export function wrapSuccess(text: string): ToolResponse {
  return {
    content: [{ type: 'text' as const, text }],
  };
}
