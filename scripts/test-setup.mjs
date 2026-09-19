import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

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

const SRC = pathToFileURL(new URL("../src/", import.meta.url).pathname).href;
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
