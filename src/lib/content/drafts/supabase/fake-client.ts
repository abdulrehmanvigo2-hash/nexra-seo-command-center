import type { PostgrestError } from "@supabase/supabase-js";

/**
 * An in-memory stand-in for the Supabase client, for testing the draft store
 * without a database.
 *
 * It implements only the call shapes `./store.ts` uses, and enforces the two
 * unique keys the migration declares — one draft per Writer run, one row per
 * (draft, version) — because those are what the store's idempotency rests
 * on. Every other constraint lives in Postgres; `store.test.ts` checks the
 * rows the store emits against the migration's bounds separately.
 *
 * Test-only.
 */

export type FakeDraftTable = "nexra_content_drafts" | "nexra_content_draft_versions";

type Row = Record<string, unknown>;

export type FakeFailure = {
  readonly table: FakeDraftTable;
  readonly operation: "insert" | "select" | "delete";
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
  readonly writes: { readonly table: FakeDraftTable; readonly operation: "insert" | "delete" }[] = [];

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

class FakeQuery implements PromiseLike<Result<Row[] | null>> {
  private readonly db: FakeDraftSupabase;
  private readonly table: FakeDraftTable;
  private mode: "select" | "insert" | "delete" = "select";
  private payload: Row[] = [];
  private filters: Filter[] = [];

  constructor(db: FakeDraftSupabase, table: FakeDraftTable) {
    this.db = db;
    this.table = table;
  }

  insert(value: Row | Row[]): this {
    this.mode = "insert";
    this.payload = Array.isArray(value) ? value : [value];
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

    if (this.mode === "delete") {
      const error = this.db.failureFor(this.table, "delete");
      this.db.writes.push({ table: this.table, operation: "delete" });
      if (error) return { data: null, error };
      const targets = this.matching();
      this.db.rows[this.table] = this.db.rows[this.table].filter((row) => !targets.includes(row));
      // Cascade, as the foreign key does.
      if (this.table === "nexra_content_drafts") {
        const ids = new Set(targets.map((row) => row.id));
        this.db.rows.nexra_content_draft_versions = this.db.rows.nexra_content_draft_versions.filter(
          (row) => !ids.has(row.draft_id),
        );
      }
      return { data: targets, error: null };
    }

    const error = this.db.failureFor(this.table, "select");
    if (error) return { data: null, error };
    return { data: [...this.matching()], error: null };
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

/** The fake, typed as the client the store expects; the cast is confined to this line. */
export function asDraftClient(fake: FakeDraftSupabase): Parameters<
  typeof import("@/lib/content/drafts/supabase/store").createSupabaseDraftStore
>[0] {
  return fake as unknown as Parameters<typeof import("@/lib/content/drafts/supabase/store").createSupabaseDraftStore>[0];
}
