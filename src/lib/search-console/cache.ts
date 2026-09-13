/**
 * A small time-based cache for provider results, held in server memory.
 *
 * A value is fresh for `freshMs` and served without asking the provider. After
 * that the next read refreshes it; if the refresh fails, the old value is
 * served — marked stale — until `staleMs` after it was fetched, and then the
 * failure is passed on. Concurrent reads of a missing key share one load.
 *
 * Failures are never cached, so a timeout is retried on the next read rather
 * than remembered for an hour. Like the rate limiter, this is per process:
 * several server instances each keep their own copy.
 */

export type CacheRead<T> = {
  readonly value: T;
  readonly stale: boolean;
};

export type ProviderCache = {
  read<T>(key: string, load: () => Promise<T>): Promise<CacheRead<T>>;
  clear(): void;
};

export function createProviderCache(options: {
  readonly freshMs: number;
  readonly staleMs: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}): ProviderCache {
  const { freshMs, staleMs, maxEntries = 500, now = Date.now } = options;
  const entries = new Map<string, { value: unknown; storedAt: number }>();
  const pending = new Map<string, Promise<unknown>>();

  const store = (key: string, value: unknown) => {
    entries.delete(key);
    entries.set(key, { value, storedAt: now() });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    async read<T>(key: string, load: () => Promise<T>): Promise<CacheRead<T>> {
      const cached = entries.get(key);
      const age = cached ? now() - cached.storedAt : Infinity;
      if (cached && age < freshMs) return { value: cached.value as T, stale: false };

      let loading = pending.get(key) as Promise<T> | undefined;
      if (!loading) {
        loading = load();
        pending.set(key, loading);
        loading.then(
          (value) => {
            store(key, value);
            pending.delete(key);
          },
          () => pending.delete(key),
        );
      }

      try {
        return { value: await loading, stale: false };
      } catch (error) {
        if (cached && age < staleMs) return { value: cached.value as T, stale: true };
        throw error;
      }
    },

    clear() {
      entries.clear();
      pending.clear();
    },
  };
}
