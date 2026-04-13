/**
 * MCP Server API Client
 *
 * Centralized API communication with the remote server.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ToolResponse } from "./types";

// Get plugin root directory
const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "../..");

// Canonical config location
const CANONICAL_CONFIG = join(homedir(), ".memforge", "config.json");
const LEGACY_CONFIG = join(PLUGIN_ROOT, "config.local.json");

// API Configuration
const DEFAULT_REMOTE_URL = "https://memclaude.thaicloud.ai";
const REMOTE_TIMEOUT_MS = 30000; // 30 seconds - vector search needs ~2-3s for embedding + similarity
const SEARCH_TIMEOUT_MS = 60000; // 60 seconds for search operations (embedding generation can be slow)

// API Key and URL loading
let remoteApiKey = process.env.CLAUDE_MEM_API_KEY || "";
let remoteApiUrl = process.env.CLAUDE_MEM_REMOTE_URL || DEFAULT_REMOTE_URL;

// Role-based access control
let pluginRole: "client" | "admin" = "client";

// Cached tier from server (fetched async on startup, informational only)
let cachedTier: string | null = null;

// Track which config was loaded for diagnostics
let configSource: string | null = null;

/** Plugin config interface */
interface PluginConfig {
  apiKey?: string;
  serverUrl?: string;
  syncEnabled?: boolean;
  pollInterval?: number;
  role?: "client" | "admin";
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
    return JSON.parse(readFileSync(configPath, "utf-8"));
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
      if (validateServerUrl(pluginConfig.serverUrl)) {
        remoteApiUrl = pluginConfig.serverUrl;
      } else {
        process.stderr.write(
          `[memforge] WARNING: serverUrl rejected by allowlist, using default: ${DEFAULT_REMOTE_URL}\n`,
        );
        remoteApiUrl = DEFAULT_REMOTE_URL;
      }
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
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      remoteApiKey = settings.CLAUDE_MEM_API_KEY || "";
      configSource = settingsPath;
    } catch {
      // Settings not found, remote will be disabled
    }
  }
}

/** Get current plugin role */
export function getRole(): "client" | "admin" {
  return pluginRole;
}

/** Get cached tier from server (null = unknown/not fetched) */
export function getTier(): string | null {
  return cachedTier;
}

/**
 * Fetch tier from /api/auth/me and cache in memory.
 * Non-blocking: logs on failure, defaults to null.
 * Uses raw fetch (not callRemoteAPI) — /api/auth/me is not in ALLOWED_API_PATHS.
 */
export async function fetchAndCacheTier(): Promise<void> {
  if (!isRemoteEnabled()) return;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${remoteApiUrl}/api/auth/me`, {
      headers: { "X-API-Key": remoteApiKey },
      signal: controller.signal,
    });
    if (response.ok) {
      const data = (await response.json()) as { data?: { tier?: string } };
      cachedTier = data.data?.tier || null;
    }
  } catch {
    // Non-blocking — tier stays null on failure
  } finally {
    clearTimeout(timeoutId);
  }
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

/** Allowed server hostnames for SSRF protection */
const ALLOWED_HOSTS = ["memclaude.thaicloud.ai"];

/** Cloud metadata IPs that must always be blocked */
const BLOCKED_METADATA_HOSTS = new Set([
  "169.254.169.254", // AWS/GCP IMDS
  "metadata.google.internal", // GCP
  "100.100.100.200", // Alibaba Cloud
]);

/**
 * Check if a hostname is a private/internal IP.
 */
function isPrivateHost(hostname: string): boolean {
  return (
    hostname === "0.0.0.0" ||
    hostname === "[::]" ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    hostname === "::1" ||
    /^fc00/i.test(hostname) ||
    /^fd/i.test(hostname) ||
    BLOCKED_METADATA_HOSTS.has(hostname)
  );
}

/**
 * Validate a server URL against the allowlist.
 * Allows: HTTPS to allowed hosts, or localhost/127.0.0.1 for dev.
 * Set MEMFORGE_ALLOW_CUSTOM_URL=1 to bypass hostname allowlist
 * (still enforces HTTPS and blocks cloud metadata endpoints).
 */
function validateServerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Always block cloud metadata and private IPs, even with bypass
    if (isPrivateHost(parsed.hostname)) return false;

    // Bypass mode: skip hostname allowlist but enforce HTTPS
    if (process.env.MEMFORGE_ALLOW_CUSTOM_URL === "1") {
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      }
      return parsed.protocol === "https:";
    }

    // Allow localhost for development (HTTP and HTTPS)
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    }

    // Require HTTPS for remote hosts
    if (parsed.protocol !== "https:") return false;

    // Check against allowlist
    return ALLOWED_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/** Endpoint mapping from local to remote */
const ENDPOINT_MAP: Record<string, string> = {
  "/hybrid": "/api/search/hybrid",
  "/vector": "/api/search/vector",
  "/search": "/api/search",
  "/timeline": "/api/timeline",
  "/recent": "/api/observations",
  "/observation": "/api/observations/batch",
  "/context/cross-project": "/api/context/cross-project",
  "/context/stable": "/api/context/stable",
};

/** Allowed direct API paths (not in ENDPOINT_MAP) */
const ALLOWED_API_PATHS = new Set([
  "/api/timeline",
  "/api/workflows",
  "/api/ingest",
  "/api/entity",
  "/api/triplets",
  "/api/stats",
  "/api/observations",
  "/api/observations/batch",
  "/api/search",
  "/api/search/hybrid",
  "/api/search/vector",
  "/api/context/cross-project",
  "/api/context/stable",
  "/api/teams",
  "/api/snapshots",
  "/api/skills",
  "/api/search/temporal",
  "/api/observations/drift-check",
  "/health",
]);

/**
 * Resolve endpoint with strict allowlist.
 * Rejects unknown endpoints to prevent URL injection.
 */
function resolveEndpoint(endpoint: string): string {
  // Check mapped endpoints first
  const mapped = ENDPOINT_MAP[endpoint];
  if (mapped) return mapped;

  // Check direct API paths
  if (ALLOWED_API_PATHS.has(endpoint)) return endpoint;

  // Normalize to prevent path traversal (e.g., /api/entity/../secret)
  const normalized = new URL(endpoint, "http://dummy").pathname;

  // Check prefix match for parameterized paths (e.g., /api/entity/foo)
  for (const allowed of ALLOWED_API_PATHS) {
    if (normalized.startsWith(allowed + "/")) return normalized;
  }

  throw new Error(`Unknown endpoint: ${endpoint}`);
}

/** Max retries for transient network errors */
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 2000];

/**
 * Check if an error is retryable (network/TLS errors, not HTTP 4xx).
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Never retry timeout aborts — they are intentional
    if (error.name === "AbortError") return false;

    const msg = error.message.toLowerCase();
    return (
      msg.includes("fetch failed") ||
      msg.includes("certificate") ||
      msg.includes("ssl") ||
      msg.includes("tls") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("socket")
    );
  }
  return false;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Remote API with timeout and retry for transient errors.
 *
 * @param endpoint - Local endpoint name (e.g., '/search')
 * @param params - Query parameters
 * @returns Promise resolving to API response data
 * @throws Error if remote not configured or API error
 */
export async function callRemoteAPI(
  endpoint: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!isRemoteEnabled()) {
    throw new Error("Remote search not configured");
  }

  // Use longer timeout for search endpoints (embedding generation is slow)
  const isSearchEndpoint =
    ["/hybrid", "/vector", "/search"].includes(endpoint) ||
    endpoint.includes("/search");
  const timeout = isSearchEndpoint ? SEARCH_TIMEOUT_MS : REMOTE_TIMEOUT_MS;

  const remoteEndpoint = resolveEndpoint(endpoint);

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }

  const url = `${remoteApiUrl}${remoteEndpoint}?${searchParams}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        headers: { "X-API-Key": remoteApiKey },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Remote API error (${response.status})`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        throw error;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError;
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
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!isRemoteEnabled()) {
    throw new Error("Remote search not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  try {
    const resolvedEndpoint = resolveEndpoint(endpoint);
    const response = await fetch(`${remoteApiUrl}${resolvedEndpoint}`, {
      method: "POST",
      headers: {
        "X-API-Key": remoteApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make a PATCH request to the remote API.
 * Used for observation updates (pin, importance, event_date).
 */
export async function patchRemoteAPI(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!isRemoteEnabled()) {
    throw new Error("Remote search not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  try {
    const resolvedEndpoint = resolveEndpoint(endpoint);
    const response = await fetch(`${remoteApiUrl}${resolvedEndpoint}`, {
      method: "PATCH",
      headers: {
        "X-API-Key": remoteApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
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
    throw new Error("Remote search not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  try {
    const resolvedEndpoint = resolveEndpoint(endpoint);
    const response = await fetch(`${remoteApiUrl}${resolvedEndpoint}`, {
      method: "DELETE",
      headers: { "X-API-Key": remoteApiKey },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
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
    throw new Error("Remote search not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  try {
    const response = await fetch(`${remoteApiUrl}/api/observations/batch`, {
      method: "POST",
      headers: {
        "X-API-Key": remoteApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
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
 * Wrap error in ToolResponse format.
 *
 * @param error - Error to wrap
 * @returns ToolResponse with error
 */
export function wrapError(error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
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
    content: [{ type: "text" as const, text }],
  };
}

// Exported for testing only
export const _testing = {
  validateServerUrl,
  isPrivateHost,
  isRetryableError,
};
