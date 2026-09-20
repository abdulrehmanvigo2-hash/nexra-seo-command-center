import { looksLikeSecret } from "@/lib/agent-runs/safety";

/**
 * Structured server logs, one JSON object per line.
 *
 * A platform log drain (Vercel's, or any stdout collector) can filter and
 * alert on these without a monitoring vendor. What may appear is closed:
 * only the field names below are written, values must be short scalars, and a
 * string that looks like a credential is replaced. Task input, result text,
 * provider responses, headers, and lease tokens have no field here, so they
 * cannot be logged through this function by accident.
 */

export type LogLevel = "info" | "warn" | "error";

const FIELDS = [
  "runId",
  "projectId",
  "agentId",
  "taskType",
  "attempt",
  "executor",
  "from",
  "to",
  "outcome",
  "errorCode",
  "durationMs",
  "job",
  "count",
  "claimed",
  "recovered",
  "scheduled",
  "stoppedBy",
  "limit",
  "reason",
  "status",
  "route",
  // Crawl foundation. A crawl's own text — page titles, URLs beyond the host,
  // response bodies — has no field here and so cannot reach a log line.
  "crawlId",
  "host",
  "depth",
  "fetched",
  "discovered",
  "stopReason",
  "fetchState",
] as const;

export type LogField = (typeof FIELDS)[number];
export type LogFields = Partial<Record<LogField, string | number | boolean | null>>;

const MAX_STRING = 120;

function clean(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value !== "string") return typeof value === "number" && !Number.isFinite(value) ? null : value;
  if (looksLikeSecret(value)) return "[redacted]";
  const printable = value.replace(/[^\x20-\x7e]/g, "?");
  return printable.length > MAX_STRING ? `${printable.slice(0, MAX_STRING)}…` : printable;
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const entry: Record<string, string | number | boolean | null> = {
    level,
    event: clean(event) as string,
    at: new Date().toISOString(),
  };
  for (const name of FIELDS) {
    const value = fields[name];
    if (value !== undefined) entry[name] = clean(value);
  }
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
