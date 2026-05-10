/**
 * Status Tool Handler
 *
 * Diagnostic tool for checking MemForge client configuration and connectivity.
 */

import { homedir } from "os";
import { join } from "path";
import type { ToolDefinition } from "../types";
import {
  getConfigSource,
  getRemoteUrl,
  getApiKey,
  isRemoteEnabled,
  getRole,
  getTier,
  getQuota,
  fetchAndCacheTier,
  wrapSuccess,
} from "../api-client";
import { syncPoller } from "../mcp-server";
import {
  computePipelineHealth,
  renderPipelineHealth,
  type SyncStatsInput,
} from "./pipeline-health";

const TRANSCRIPTS_DIR = join(homedir(), ".claude", "projects");
const CLAUDE_MEM_DB = join(homedir(), ".claude-mem", "claude-mem.db");
const SYNC_WATERMARK = join(homedir(), ".memforge", ".sync-watermark.json");
const PIPELINE_WINDOW_HOURS = 24;

const ZERO_SYNC_STATS: SyncStatsInput = {
  syncedCount: 0,
  failedCount: 0,
  pendingCount: 0,
  circuitState: "closed",
};

async function appendPipelineHealth(
  lines: string[],
  syncStats: SyncStatsInput,
): Promise<void> {
  try {
    const quota = getQuota();
    const health = await computePipelineHealth({
      transcriptsDir: TRANSCRIPTS_DIR,
      dbPath: CLAUDE_MEM_DB,
      watermarkPath: SYNC_WATERMARK,
      windowHours: PIPELINE_WINDOW_HOURS,
      syncStats,
      serverLifetimeUsed: quota?.observations.used ?? null,
    });
    lines.push(...renderPipelineHealth(health));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safe =
      "`" + message.replace(/`/g, "ʼ").replace(/[\r\n]+/g, " ") + "`";
    lines.push(`\n_Pipeline health check skipped: ${safe}_`);
  }
}

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
      // Pipeline Health is local-only — still useful when remote is unconfigured
      // so users can verify claude-mem is producing observations locally.
      await appendPipelineHealth(lines, ZERO_SYNC_STATS);
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

    // Refresh tier + quota from server
    await fetchAndCacheTier();

    // Auth + quota check via /api/auth/me
    const authController = new AbortController();
    const authTimeoutId = setTimeout(() => authController.abort(), 10000);

    try {
      const authResponse = await fetch(`${serverUrl}/api/auth/me`, {
        headers: { "X-API-Key": apiKey },
        signal: authController.signal,
      });

      if (authResponse.ok) {
        lines.push(`**Auth:** Valid`);

        // Show quota if server returns it
        const quota = getQuota();
        if (quota) {
          const obsLimit = quota.observations.limit;
          const obsUsed = quota.observations.used ?? 0;
          const isUnlimited =
            obsLimit === null || obsLimit === undefined || obsLimit === 0;
          const limitStr = isUnlimited
            ? "Unlimited"
            : obsLimit.toLocaleString();
          const pct = isUnlimited ? 0 : Math.round((obsUsed / obsLimit) * 100);
          const synthLimit = quota.synthesis.limit_per_day;
          const synthStr =
            synthLimit === null || synthLimit === undefined
              ? "Unlimited"
              : `${synthLimit}`;
          const rateStr =
            quota.rate_limit === 0 || quota.rate_limit === null
              ? "No limit"
              : `${quota.rate_limit} req/min`;

          lines.push("");
          lines.push("### Quota");
          lines.push(
            `**Observations:** ${obsUsed.toLocaleString()} / ${limitStr}${isUnlimited ? "" : ` (${pct}%)`}`,
          );
          lines.push(`**Synthesis:** ${synthStr}/day`);
          lines.push(`**Search Modes:** ${quota.search_modes.join(", ")}`);
          lines.push(`**Rate Limit:** ${rateStr}`);

          if (!isUnlimited && pct >= 90) {
            lines.push(
              `\n> **Warning:** ${pct}% of observation quota used. Consider upgrading your tier.`,
            );
          }
        }

        if (getTier() === "free") {
          lines.push(
            "\n_Free tier: vector/hybrid search restricted. Use FTS mode._",
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

    // Sync stats — capture for pipeline-health input regardless of branch
    lines.push("");
    let pipelineSyncStats: SyncStatsInput = ZERO_SYNC_STATS;
    if (syncPoller?.isActive()) {
      const stats = syncPoller.getStats();
      lines.push(
        `**Sync:** ${stats.syncedCount} synced, ${stats.failedCount} failed, pending: ${stats.pendingCount}`,
      );
      if (stats.circuitState !== "closed") {
        lines.push(`**Circuit:** ${stats.circuitState}`);
      }
      pipelineSyncStats = {
        syncedCount: stats.syncedCount,
        failedCount: stats.failedCount,
        pendingCount: stats.pendingCount,
        circuitState: stats.circuitState,
      };
    } else if (syncPoller) {
      lines.push("**Sync:** starting...");
    } else {
      lines.push("**Sync:** not running");
    }

    // Pipeline Health — runs unconditionally so Gap A (claude-mem.db missing)
    // is visible even when poller is inactive. See handlers/pipeline-health.ts.
    await appendPipelineHealth(lines, pipelineSyncStats);

    return wrapSuccess(lines.join("\n"));
  },
};

/** All status handlers */
export const statusHandlers: ToolDefinition[] = [memStatus];
