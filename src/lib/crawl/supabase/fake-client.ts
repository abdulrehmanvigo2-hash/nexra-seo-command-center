import type { PostgrestError } from "@supabase/supabase-js";
import type { CrawlsDatabase } from "@/lib/crawl/supabase/schema";

/**
 * An in-memory stand-in for the Supabase client, for testing the crawl store
 * without a database.
 *
 * It implements only the call shapes `../supabase/store.ts` actually uses, and
 * deliberately no more: a fake that accepted anything would let the store call
 * something the real client does not support and still pass.
 *
 * What it does *not* do is enforce the table's constraints — those live in
 * Postgres and a fake cannot stand in for them. `store.test.ts` checks the
 * rows the store produces against the migration's documented bounds
 * separately, so a row that Postgres would reject is caught here rather than
 * on the first real crawl.
 *
 * Test-only. It is kept beside the store rather than in the test file because
 * both the store tests and the service tests need it.
 */

export type FakeTable = "nexra_crawls" | "nexra_crawl_pages" | "nexra_crawl_links" | "nexra_crawl_page_texts";

type Row = Record<string, unknown>;

export type FakeFailure = {
  readonly table: FakeTable;
  readonly operation: "insert" | "update" | "select";
  readonly error: PostgrestError;
};

export function postgrestError(code: string, message: string, details = ""): PostgrestError {
  return { code, message, details, hint: "", name: "PostgrestError" } as PostgrestError;
}

export class FakeSupabase {
  readonly rows: Record<FakeTable, Row[]> = {
    nexra_crawls: [],
    nexra_crawl_pages: [],
    nexra_crawl_links: [],
    nexra_crawl_page_texts: [],
  };

  /** Every insert the store issued, in order, so batching can be asserted. */
  readonly insertBatches: { readonly table: FakeTable; readonly count: number }[] = [];

  /** Queued failures, consumed one per matching call. */
  private failures: FakeFailure[] = [];

  private nextId = 1;

  failNext(failure: FakeFailure): void {
    this.failures.push(failure);
  }

  private takeFailure(table: FakeTable, operation: FakeFailure["operation"]): PostgrestError | null {
    const index = this.failures.findIndex(
      (entry) => entry.table === table && entry.operation === operation,
    );
    if (index === -1) return null;
    const [failure] = this.failures.splice(index, 1);
    return failure.error;
  }

  from(table: FakeTable): FakeQuery {
    return new FakeQuery(this, table);
  }

  /** Assigns the surrogate key Postgres would. */
  mint(): string {
    const value = this.nextId.toString(16).padStart(12, "0");
    this.nextId += 1;
    return `00000000-0000-4000-8000-${value}`;
  }

  /** @internal */
  failureFor(table: FakeTable, operation: FakeFailure["operation"]): PostgrestError | null {
    return this.takeFailure(table, operation);
  }
}

/**
 * The column defaults the migration declares.
 *
 * Without these an inserted row comes back missing everything the database
 * would have filled in, and the mapper rejects it — which would be a fault of
 * the fake, not of the store.
 */
const DEFAULTS: Record<FakeTable, Row> = {
  nexra_crawls: {
    status: "running",
    stop_reason: null,
    robots_state: "unavailable",
    sitemap_state: "unavailable",
    pages_discovered: 0,
    pages_fetched: 0,
    pages_failed: 0,
    error_code: null,
    error_message: null,
    started_at: "2026-09-20T00:00:00.000Z",
    finished_at: null,
  },
  nexra_crawl_pages: {
    redirect_hops: 0,
    redirect_chain: [],
    schema_types: [],
    schema_blocks: 0,
    schema_parse_failed: false,
    internal_links_in: 0,
    internal_links_out: 0,
  },
  nexra_crawl_links: { discovered_at: "2026-09-20T00:00:00.000Z" },
  nexra_crawl_page_texts: { recorded_at: "2026-09-20T00:00:00.000Z" },
};

type Filter = { readonly column: string; readonly value: unknown };

type Result<T> = { data: T; error: PostgrestError | null };

/**
 * The subset of the query builder the store uses. Every method returns `this`
 * so the chain works, and the object is awaitable for the calls that end
 * without `.single()`/`.maybeSingle()`.
 */
class FakeQuery implements PromiseLike<Result<Row[] | null>> {
  // Written out rather than declared as constructor parameters: Node's
  // type-stripping runs the tests, and it does not support parameter
  // properties.
  private readonly db: FakeSupabase;
  private readonly table: FakeTable;
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row[] = [];
  private filters: Filter[] = [];
  private patch: Row = {};
  private limitTo: number | null = null;
  private orderings: { column: string; ascending: boolean }[] = [];

  constructor(db: FakeSupabase, table: FakeTable) {
    this.db = db;
    this.table = table;
  }

  insert(value: Row | Row[]): this {
    this.mode = "insert";
    this.payload = Array.isArray(value) ? value : [value];
    this.db.insertBatches.push({ table: this.table, count: this.payload.length });
    return this;
  }

  update(patch: Row): this {
    this.mode = "update";
    this.patch = patch;
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

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderings.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.limitTo = count;
    return this;
  }

  private matching(): Row[] {
    return this.db.rows[this.table].filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value),
    );
  }

  private run(): Result<Row[] | null> {
    if (this.mode === "insert") {
      const error = this.db.failureFor(this.table, "insert");
      if (error) return { data: null, error };
      const written = this.payload.map((row) => ({
        id: this.db.mint(),
        ...DEFAULTS[this.table],
        ...row,
      }));
      this.db.rows[this.table].push(...written);
      return { data: written, error: null };
    }

    if (this.mode === "update") {
      const error = this.db.failureFor(this.table, "update");
      if (error) return { data: null, error };
      const targets = this.matching();
      for (const row of targets) Object.assign(row, this.patch);
      return { data: targets, error: null };
    }

    const error = this.db.failureFor(this.table, "select");
    if (error) return { data: null, error };

    let rows = [...this.matching()];
    for (const ordering of [...this.orderings].reverse()) {
      rows.sort((a, b) => {
        const left = String(a[ordering.column] ?? "");
        const right = String(b[ordering.column] ?? "");
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
    if (rows.length !== 1) {
      return {
        data: null as unknown as Row,
        error: postgrestError("PGRST116", "expected exactly one row"),
      };
    }
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

/**
 * The fake, typed as the client the store expects.
 *
 * The cast is confined to this one line so the store under test is exercised
 * through its real type, not a loosened one.
 */
export function asSupabaseClient(fake: FakeSupabase): Parameters<
  typeof import("@/lib/crawl/supabase/store").createSupabaseCrawlStore
>[0] {
  return fake as unknown as Parameters<
    typeof import("@/lib/crawl/supabase/store").createSupabaseCrawlStore
  >[0];
}

export type { CrawlsDatabase };
