import { registerHooks } from "node:module";

/**
 * Lets the test runner load the application's own modules.
 *
 * The product is built by Next, which resolves the `@/…` alias from
 * `tsconfig.json` and supplies the `server-only` marker. Node knows neither, so
 * running a source file directly under `node --test` fails on the first import.
 * Two resolve hooks are enough to close that gap, and they are the whole of the
 * test harness: no bundler, no transform step, no dependency.
 *
 *   * `@/x` becomes `<repo>/src/x`, with `.ts` appended when the specifier has
 *     no extension, which is how the codebase writes every internal import.
 *   * `server-only` becomes an empty module. It exists to fail a build that
 *     imports server code into a client bundle; under the test runner there is
 *     no bundle and no client, and the real package throws on sight.
 *
 * Node strips the types itself (`--experimental-strip-types`), so what runs is
 * the same source the application ships, not a copy of it.
 */

/**
 * Where `@/…` resolves to, as a URL.
 *
 * `import.meta.url` is already a `file:` URL, so `new URL` is the whole job.
 * Taking `.pathname` off it and handing that back to `pathToFileURL` — which
 * is what this did — is a round-trip that is a no-op on POSIX and wrong on
 * Windows: the pathname of `file:///D:/repo/src/` is `/D:/repo/src/`, and
 * Windows reads a leading slash before a drive letter as drive-relative, so
 * it resolves against the working directory and yields `D:\D:\repo\src\`.
 * Every `@/…` import then fails to resolve.
 */
const SRC = new URL("../src/", import.meta.url).href;
const EMPTY = "data:text/javascript,export {};";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only" || specifier === "client-only") {
      return { url: EMPTY, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const path = specifier.slice(2);
      // Only a real source extension counts: a specifier such as
      // "…/page-fetcher.test" ends in a dot-word but is still a .ts file.
      const resolved = /\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/i.test(path) ? path : `${path}.ts`;
      return nextResolve(new URL(resolved, SRC).href, context);
    }
    return nextResolve(specifier, context);
  },
});
