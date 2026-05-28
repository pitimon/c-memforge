/**
 * Usage sync — push measured per-(date, model) token usage to MemForge.
 *
 * Phase 3 (memforge ADR-003). Reads local Claude Code JSONL transcripts via the
 * dependency-free parser (no `ccusage` install required), then POSTs the
 * aggregate to the server's replace-semantics endpoint POST /api/usage/tokens.
 *
 * Because the server UPSERTs by (date, model), a full re-scan each push is
 * idempotent — re-sending today's growing totals refreshes the row instead of
 * inflating it. No watermark / offset state is kept here (ADR-003).
 */

import { remoteSync } from "../sync/remote-sync";
import { aggregateUsage } from "./jsonl-parser";

const USAGE_TIMEOUT_MS = 30000;

/** Result of one usage-push attempt (never throws — callers log and continue). */
export interface UsagePushResult {
  pushed: number; // rows accepted by the server
  scannedFiles: number;
  skipped: number; // skipped attempt (not configured / nothing to send)
  error?: string;
}

/**
 * Parse local JSONL and push the aggregate to the server.
 *
 * @param sinceDays how many days back to include (default 7) — bounds the scan
 *   to a recent window so the daily card stays cheap. Day-level grain per ADR-003.
 */
export async function pushUsage(
  sinceDays = 7,
  log: (...args: unknown[]) => void = console.error,
): Promise<UsagePushResult> {
  const config = remoteSync.getConfig();
  if (!config || !config.syncEnabled) {
    return { pushed: 0, scannedFiles: 0, skipped: 1 };
  }

  // Lower bound = today - (sinceDays - 1), UTC, YYYY-MM-DD.
  const since = new Date(Date.now() - (sinceDays - 1) * 86400_000)
    .toISOString()
    .slice(0, 10);

  let rows;
  let scannedFiles = 0;
  try {
    const result = aggregateUsage({ since });
    rows = result.rows;
    scannedFiles = result.filesScanned;
  } catch (e) {
    // Parser must never crash the poller — log and bail.
    const error = e instanceof Error ? e.message : String(e);
    log("[UsageSync] parse failed:", error);
    return { pushed: 0, scannedFiles: 0, skipped: 1, error };
  }

  if (rows.length === 0) {
    return { pushed: 0, scannedFiles, skipped: 1 };
  }

  try {
    const response = await fetch(`${config.serverUrl}/api/usage/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify({ items: rows }),
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
      log("[UsageSync] push rejected:", error);
      return { pushed: 0, scannedFiles, skipped: 0, error };
    }

    const body = (await response.json().catch(() => ({}))) as {
      upserted?: number;
    };
    const pushed = body.upserted ?? rows.length;
    log(
      `[UsageSync] pushed ${pushed} (date,model) rows from ${scannedFiles} files`,
    );
    return { pushed, scannedFiles, skipped: 0 };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log("[UsageSync] push failed:", error);
    return { pushed: 0, scannedFiles, skipped: 0, error };
  }
}
