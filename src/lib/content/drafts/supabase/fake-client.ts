import type { PostgrestError } from "@supabase/supabase-js";

/**
 * An in-memory stand-in for the Supabase client, for testing the draft store
 * without a database.
 *
 * It implements only the call shapes `./store.ts` uses, and enforces the two
 * unique keys the migration declares — one draft per Writer run, one row per
 * (draft, version) — because those are what the store's idempotency rests
 * on, and the two version guards — no update to a version's identity or
 * text (only fact_check), and no delete of a version, the parent's cascade
 * included — because those are what the history's permanence rests on.
 * Every other constraint lives in Postgres; `store.test.ts` checks the rows
 * the store emits against the migration's bounds separately.
 *
 * Test-only.
 */

export type FakeDraftTable = "nexra_content_drafts" | "nexra_content_draft_versions";

type Row = Record<string, unknown>;

export type FakeFailure = {
  readonly table: FakeDraftTable;
  readonly operation: "insert" | "select" | "update" | "delete" | "rpc";
  readonly error: PostgrestError;
};

export function postgrestError(code: string, message: string, details = ""): PostgrestError {
  return { code, message, details, hint: "", name: "PostgrestError" } as PostgrestError;
}

const UNIQUE: Record<FakeDraftTable, readonly (readonly string[])[]> = {
  nexra_content_drafts: [["source_writer_run_id"]],
  nexra_content_draft_versions: [["draft_id", "version"]],
};

const DEFAULTS: Record<FakeDraftTable, Row> = {
  nexra_content_drafts: {
    status: "drafting",
    current_version: 1,
    approved_version: null,
    approved_by: null,
    approved_at: null,
    published_version: null,
    published_at: null,
    remote_content_id: null,
    remote_target: null,
    created_at: "2026-09-22T12:00:00.000Z",
    updated_at: "2026-09-22T12:00:00.000Z",
  },
  nexra_content_draft_versions: {
    fact_check: null,
    created_at: "2026-09-22T12:00:00.000Z",
  },
};

export class FakeDraftSupabase {
  readonly rows: Record<FakeDraftTable, Row[]> = {
    nexra_content_drafts: [],
    nexra_content_draft_versions: [],
  };

  /** Every write the store issued, in order. */
  readonly writes: { readonly table: FakeDraftTable; readonly operation: "insert" | "update" | "delete" | "rpc" }[] = [];

  private failures: FakeFailure[] = [];
  private nextId = 1;

  failNext(failure: FakeFailure): void {
    this.failures.push(failure);
  }

  from(table: FakeDraftTable): FakeQuery {
    return new FakeQuery(this, table);
  }

  mint(): string {
    const value = this.nextId.toString(16).padStart(12, "0");
    this.nextId += 1;
    return `00000000-0000-4000-8000-${value}`;
  }

  /**
   * The one function the store calls, with the semantics the migration gives
   * it: lookup by draft and project, archived refused, expected version
   * checked, the next version inserted and the parent advanced together.
   * Sequential here, where the real one holds a row lock.
   */
  async rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: PostgrestError | null }> {
    if (name !== "nexra_content_draft_save_version") {
      return { data: null, error: postgrestError("42883", `function ${name} does not exist`) };
    }
    const error = this.failureFor("nexra_content_drafts", "rpc");
    this.writes.push({ table: "nexra_content_drafts", operation: "rpc" });
    if (error) return { data: null, error };
    const draft = this.rows.nexra_content_drafts.find(
      (row) => row.id === args.p_draft_id && row.project_id === args.p_project_id,
    );
    if (draft === undefined) return { data: { outcome: "not-found" }, error: null };
    if (draft.status === "archived") return { data: { outcome: "archived" }, error: null };
    if (draft.current_version !== args.p_expected_version) {
      return { data: { outcome: "stale", current_version: draft.current_version }, error: null };
    }
    const next = (draft.current_version as number) + 1;
    if (this.rows.nexra_content_draft_versions.some((row) => row.draft_id === draft.id && row.version === next)) {
      return { data: null, error: postgrestError("23505", "duplicate key value violates unique constraint") };
    }
    const version: Row = {
      id: this.mint(),
      ...DEFAULTS.nexra_content_draft_versions,
      draft_id: draft.id,
      version: next,
      origin: "operator",
      title: args.p_title,
      body: args.p_body,
      claims: [],
      placeholders: [],
      created_by: args.p_created_by,
    };
    this.rows.nexra_content_draft_versions.push(version);
    draft.current_version = next;
    if (draft.status === "fact-checked" || draft.status === "approved") draft.status = "drafting";
    draft.updated_at = "2026-09-22T12:30:00.000Z";
    return { data: { outcome: "created", draft: { ...draft }, version: { ...version } }, error: null };
  }

  /** @internal */
  failureFor(table: FakeDraftTable, operation: FakeFailure["operation"]): PostgrestError | null {
    const index = this.failures.findIndex((entry) => entry.table === table && entry.operation === operation);
    if (index === -1) return null;
    const [failure] = this.failures.splice(index, 1);
    return failure.error;
  }
}

type Filter = { readonly column: string; readonly value: unknown };
type Result<T> = { data: T; error: PostgrestError | null };

/** The columns the version update guard (20260922120000) freezes: everything but fact_check. */
const VERSION_FROZEN = ["id", "draft_id", "version", "origin", "title", "body", "claims", "placeholders", "created_by", "created_at"] as const;

const VERSION_IMMUTABLE = "nexra_content_draft_versions: a version is immutable; save a new version instead";
const VERSION_NEVER_DELETED = "nexra_content_draft_versions: a version is never deleted; archive the draft instead";

class FakeQuery implements PromiseLike<Result<Row[] | null>> {
  private readonly db: FakeDraftSupabase;
  private readonly table: FakeDraftTable;
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row[] = [];
  private filters: Filter[] = [];
  private orderings: { column: string; ascending: boolean }[] = [];
  private limitTo: number | null = null;

  constructor(db: FakeDraftSupabase, table: FakeDraftTable) {
    this.db = db;
    this.table = table;
  }

  insert(value: Row | Row[]): this {
    this.mode = "insert";
    this.payload = Array.isArray(value) ? value : [value];
    return this;
  }

  update(value: Row): this {
    this.mode = "update";
    this.payload = [value];
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  /** The column list is irrelevant here: the fake returns whole rows. */
  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  /** `is(column, null)`: the one form the store uses. */
  is(column: string, value: null): this {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderings.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.limitTo = count;
    return this;
  }

  private matching(): Row[] {
    return this.db.rows[this.table].filter((row) => this.filters.every((filter) => row[filter.column] === filter.value));
  }

  private run(): Result<Row[] | null> {
    if (this.mode === "insert") {
      const error = this.db.failureFor(this.table, "insert");
      this.db.writes.push({ table: this.table, operation: "insert" });
      if (error) return { data: null, error };
      for (const row of this.payload) {
        for (const key of UNIQUE[this.table]) {
          const clash = this.db.rows[this.table].some((existing) => key.every((column) => existing[column] === row[column]));
          if (clash) {
            return {
              data: null,
              error: postgrestError("23505", `duplicate key value violates unique constraint on (${key.join(", ")})`),
            };
          }
        }
      }
      const written = this.payload.map((row) => ({ id: this.db.mint(), ...DEFAULTS[this.table], ...row }));
      this.db.rows[this.table].push(...written);
      return { data: written, error: null };
    }

    if (this.mode === "update") {
      const error = this.db.failureFor(this.table, "update");
      this.db.writes.push({ table: this.table, operation: "update" });
      if (error) return { data: null, error };
      const [patch] = this.payload;
      const targets = this.matching();
      // The version update guard: a version's identity and text never change.
      if (this.table === "nexra_content_draft_versions") {
        const frozen = VERSION_FROZEN.some((column) => column in patch && targets.some((row) => !sameValue(row[column], patch[column])));
        if (frozen) return { data: null, error: postgrestError("23514", VERSION_IMMUTABLE) };
      }
      for (const row of targets) Object.assign(row, patch);
      // The parent's updated_at trigger.
      if (this.table === "nexra_content_drafts") for (const row of targets) row.updated_at = "2026-09-22T13:00:00.000Z";
      return { data: targets.map((row) => ({ ...row })), error: null };
    }

    if (this.mode === "delete") {
      const error = this.db.failureFor(this.table, "delete");
      this.db.writes.push({ table: this.table, operation: "delete" });
      if (error) return { data: null, error };
      const targets = this.matching();
      // The version delete guard (20260922130100): no version row is ever
      // removed, and the parent's cascade is a delete of version rows too.
      if (this.table === "nexra_content_draft_versions" && targets.length > 0) {
        return { data: null, error: postgrestError("23514", VERSION_NEVER_DELETED) };
      }
      if (this.table === "nexra_content_drafts") {
        const ids = new Set(targets.map((row) => row.id));
        if (this.db.rows.nexra_content_draft_versions.some((row) => ids.has(row.draft_id))) {
          return { data: null, error: postgrestError("23514", VERSION_NEVER_DELETED) };
        }
      }
      this.db.rows[this.table] = this.db.rows[this.table].filter((row) => !targets.includes(row));
      return { data: targets, error: null };
    }

    const error = this.db.failureFor(this.table, "select");
    if (error) return { data: null, error };
    let rows = [...this.matching()];
    for (const ordering of [...this.orderings].reverse()) {
      rows.sort((a, b) => {
        const left = a[ordering.column] as number | string;
        const right = b[ordering.column] as number | string;
        const compared = left < right ? -1 : left > right ? 1 : 0;
        return ordering.ascending ? compared : -compared;
      });
    }
    if (this.limitTo !== null) rows = rows.slice(0, this.limitTo);
    return { data: rows, error: null };
  }

  async single(): Promise<Result<Row>> {
    const { data, error } = this.run();
    if (error) return { data: null as unknown as Row, error };
    const rows = data ?? [];
    if (rows.length !== 1) return { data: null as unknown as Row, error: postgrestError("PGRST116", "expected exactly one row") };
    return { data: rows[0], error: null };
  }

  async maybeSingle(): Promise<Result<Row | null>> {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    const rows = data ?? [];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = Result<Row[] | null>, TResult2 = never>(
    onfulfilled?: ((value: Result<Row[] | null>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The fake, typed as the client the store expects; the cast is confined to this line. */
export function asDraftClient(fake: FakeDraftSupabase): Parameters<
  typeof import("@/lib/content/drafts/supabase/store").createSupabaseDraftStore
>[0] {
  return fake as unknown as Parameters<typeof import("@/lib/content/drafts/supabase/store").createSupabaseDraftStore>[0];
}
