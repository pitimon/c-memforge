/**
 * MCP Audit Logger
 *
 * Structured audit logging for tool invocations.
 * Addresses Finding #7 (CWE-778): No structured audit logging.
 *
 * Outputs single-line JSON to stderr (stdout reserved for JSON-RPC).
 */

interface AuditEntry {
  ts: string;
  tool: string;
  args_keys: string[];
  duration_ms: number;
  success: boolean;
  error?: string;
}

/**
 * Write a structured audit log entry to stderr.
 */
export function auditLog(
  tool: string,
  args: Record<string, unknown>,
  durationMs: number,
  success: boolean,
  error?: string,
): void {
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    tool,
    args_keys: Object.keys(args),
    duration_ms: durationMs,
    success,
  };

  if (error) {
    // Truncate error messages to avoid log bloat
    entry.error = error.length > 200 ? error.slice(0, 200) + "..." : error;
  }

  try {
    process.stderr.write(`[audit] ${JSON.stringify(entry)}\n`);
  } catch {
    // Never let logging failures propagate
  }
}
