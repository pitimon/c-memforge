/**
 * Status Tool Handler
 *
 * Diagnostic tool for checking MemForge client configuration and connectivity.
 */

import type { ToolDefinition } from "../types";
import {
  getConfigSource,
  getRemoteUrl,
  getApiKey,
  isRemoteEnabled,
  getRole,
  getTier,
  wrapSuccess,
} from "../api-client";
import { syncPoller } from "../mcp-server";

/**
 * Mask API key for display.
 */
function maskKey(key: string): string {
  if (!key) return "(not set)";
  return `configured (${key.length} chars)`;
}

/** mem_status tool definition */
export const memStatus: ToolDefinition = {
  name: "mem_status",
  description:
    "Diagnostic tool — check client config, API key, server connectivity, and sync status. " +
    "Use FIRST when troubleshooting connection issues or verifying setup.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    const lines: string[] = ["## MemForge Client Status\n"];

    // Config source
    const source = getConfigSource();
    lines.push(`**Config:** ${source || "not found"}`);
    lines.push(`**Role:** ${getRole()}`);
    const tier = getTier();
    lines.push(`**Tier:** ${tier || "unknown (legacy key)"}`);
    lines.push(`**API Key:** ${maskKey(getApiKey())}`);
    lines.push(`**Server:** ${getRemoteUrl()}`);
    lines.push("");

    if (!isRemoteEnabled()) {
      lines.push("**Status:** Not configured");
      lines.push("");
      lines.push('Run `bun run setup "your-api-key"` to configure.');
      return wrapSuccess(lines.join("\n"));
    }

    // Connectivity check
    const serverUrl = getRemoteUrl();
    const apiKey = getApiKey();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const start = Date.now();
      const healthResponse = await fetch(`${serverUrl}/health`, {
        signal: controller.signal,
      });
      const latency = Date.now() - start;

      if (!healthResponse.ok) {
        lines.push(
          `**Connectivity:** Server returned ${healthResponse.status}`,
        );
        lines.push(`**Latency:** ${latency}ms`);
      } else {
        lines.push(`**Connectivity:** OK`);
        lines.push(`**Latency:** ${latency}ms`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lines.push(`**Connectivity:** Failed - ${message}`);
      lines.push("");
      lines.push("Check your network or server URL.");
      clearTimeout(timeoutId);
      return wrapSuccess(lines.join("\n"));
    } finally {
      clearTimeout(timeoutId);
    }

    // Auth check
    const authController = new AbortController();
    const authTimeoutId = setTimeout(() => authController.abort(), 10000);

    try {
      const authResponse = await fetch(`${serverUrl}/api/stats`, {
        headers: { "X-API-Key": apiKey },
        signal: authController.signal,
      });

      if (authResponse.ok) {
        lines.push(`**Auth:** Valid`);
        if (getTier() === "free") {
          lines.push(
            "  _Free tier: vector/hybrid search restricted. Use FTS mode._",
          );
        }
      } else if (authResponse.status === 401 || authResponse.status === 403) {
        lines.push(`**Auth:** Invalid API key (${authResponse.status})`);
        lines.push("");
        lines.push(
          "Get a valid key at: https://memclaude.thaicloud.ai/settings",
        );
      } else {
        lines.push(`**Auth:** Server error (${authResponse.status})`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lines.push(`**Auth:** Check failed - ${message}`);
    } finally {
      clearTimeout(authTimeoutId);
    }

    // Sync stats
    lines.push("");
    if (syncPoller?.isActive()) {
      const stats = syncPoller.getStats();
      lines.push(
        `**Sync:** ${stats.syncedCount} synced, ${stats.failedCount} failed, pending: ${stats.pendingCount}`,
      );
      if (stats.circuitState !== "closed") {
        lines.push(`**Circuit:** ${stats.circuitState}`);
      }
    } else if (syncPoller) {
      lines.push("**Sync:** starting...");
    } else {
      lines.push("**Sync:** not running");
    }

    return wrapSuccess(lines.join("\n"));
  },
};

/** All status handlers */
export const statusHandlers: ToolDefinition[] = [memStatus];
