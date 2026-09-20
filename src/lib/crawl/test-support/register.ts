/**
 * Makes the server-only crawl modules loadable by `node --test`.
 *
 * `server-only` is not a package on disk — Next.js resolves the specifier at
 * build time, and importing it from a Client Component is what makes the build
 * fail. Node knows nothing about that alias, so `node --test` cannot load any
 * module carrying the guard, which is every module that touches the database.
 *
 * The alternative would have been to drop `import "server-only"` from those
 * modules so the tests could reach them. That trades a real protection — the
 * thing that stops the service-role client ever being bundled for a browser —
 * for test convenience, which is the wrong way round. So the guard stays in
 * the source exactly as it ships, and this hook satisfies it with a no-op for
 * the test process only.
 *
 * It also resolves the `@/*` path alias, which is declared in `tsconfig.json`
 * and understood by the bundler but not by Node. The mapping here is the same
 * one `tsconfig.json` declares (`@/*` → `./src/*`); it is not a second
 * convention, and application code is unchanged by it.
 *
 * Nothing here is imported by application code. It is loaded through
 * `--import` in the `test` script and has no effect on `next build`, which
 * resolves both of these itself.
 */

import { existsSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * `module.registerHooks` arrived in Node 22.15; the `@types/node` this project
 * pins is older and does not declare it. Typed here rather than by moving the
 * dependency, since nothing but this file needs it.
 */
type ResolveResult = { url: string; format?: string; shortCircuit?: boolean };
type ResolveContext = { parentURL?: string; conditions?: readonly string[] };
type ResolveHook = (
  specifier: string,
  context: ResolveContext,
  nextResolve: (specifier: string, context: ResolveContext) => ResolveResult,
) => ResolveResult;

const registerHooks = (nodeModule as unknown as {
  registerHooks: (hooks: { resolve: ResolveHook }) => void;
}).registerHooks;

const SERVER_ONLY = "server-only";

/** An empty module: importing it must succeed and do nothing. */
const EMPTY_MODULE = "data:text/javascript,export{}";

/** The repository root, four levels above this file. */
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** `@/lib/x` → `<root>/src/lib/x.ts`, matching tsconfig's `paths`. */
function resolveAlias(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const base = resolvePath(ROOT, "src", specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolvePath(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === SERVER_ONLY) {
      return { url: EMPTY_MODULE, shortCircuit: true };
    }
    const aliased = resolveAlias(specifier);
    if (aliased !== null) {
      // No `format`: declaring one would tell Node the file is plain
      // JavaScript and skip the type stripping that runs these tests.
      return { url: aliased, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
