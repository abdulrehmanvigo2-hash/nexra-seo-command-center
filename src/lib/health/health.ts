/**
 * The public health check (Phase 5, checkpoint 5.5, design note 5.1 part D2,
 * decision Q8).
 *
 * `GET /api/health` answers two things only: that the application is serving,
 * and whether its database responds. The body is fixed in shape —
 * `{ status, time, database }` — and carries no row, id, count, project,
 * version, environment variable name, error text or configuration detail, so
 * a public caller learns nothing it could not learn from the status code.
 *
 *   * 200 `ok`: the database answered within the timeout, or this deployment
 *     keeps no database (the fixture data source), which is not a fault.
 *   * 503 `degraded`: the database did not answer, answered with an error,
 *     or took longer than the timeout.
 *
 * The probe is handed in, so the rule is tested without a database; the
 * route supplies a bounded read whose result is discarded.
 */

export type DatabaseProbe = (signal: AbortSignal) => Promise<void>;

export type HealthBody = {
  readonly status: "ok" | "degraded";
  readonly time: string;
  readonly database: "reachable" | "unreachable" | "not-configured";
};

export type HealthAnswer = { readonly httpStatus: 200 | 503; readonly body: HealthBody };

/** How long the database may take to answer before the check calls it unreachable. */
export const HEALTH_DB_TIMEOUT_MS = 2_000;

export async function checkHealth(options: {
  /** Null when this deployment keeps no database. */
  readonly probe: DatabaseProbe | null;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}): Promise<HealthAnswer> {
  const now = options.now ?? (() => new Date());
  const time = () => now().toISOString();
  if (options.probe === null) return { httpStatus: 200, body: { status: "ok", time: time(), database: "not-configured" } };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
      controller.abort();
    }, options.timeoutMs ?? HEALTH_DB_TIMEOUT_MS);
  });
  let reachable: boolean;
  try {
    const outcome = await Promise.race([options.probe(controller.signal).then(() => "answered" as const), timedOut]);
    reachable = outcome === "answered";
  } catch {
    reachable = false;
  } finally {
    clearTimeout(timer);
  }
  return reachable
    ? { httpStatus: 200, body: { status: "ok", time: time(), database: "reachable" } }
    : { httpStatus: 503, body: { status: "degraded", time: time(), database: "unreachable" } };
}
