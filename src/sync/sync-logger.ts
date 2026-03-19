/**
 * Structured Logger for SyncPoller
 *
 * Adds ISO timestamps and log levels to sync log messages.
 * Writes to stderr (MCP stdout = JSON-RPC).
 */

type LogLevel = "INFO" | "WARN" | "ERROR";

export function createSyncLogger(): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    const message = args
      .map((a) => (a instanceof Error ? a.message : String(a)))
      .join(" ");

    // Determine level from message content
    let level: LogLevel = "INFO";
    if (
      message.includes("error") ||
      message.includes("ERROR") ||
      message.includes("Failed") ||
      message.includes("Circuit OPEN")
    ) {
      level = "ERROR";
    } else if (
      message.includes("WARN") ||
      message.includes("Gave up") ||
      message.includes("unreachable")
    ) {
      level = "WARN";
    }

    process.stderr.write(`[${timestamp}] [${level}] ${message}\n`);
  };
}
