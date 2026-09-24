import "server-only";

import {
  readSearchConsoleConfig,
  SearchConsoleConfigurationError,
} from "@/lib/search-console/config";
import { createSearchConsoleClient } from "@/lib/search-console/google-client";
import {
  createMisconfiguredProvider,
  createSearchConsoleProvider,
  type SearchConsoleProvider,
} from "@/lib/search-console/provider";

/**
 * The server's Search Console provider and property mapping, chosen once per
 * process from the environment: not configured, configured, or
 * misconfigured. One instance, so its token and caches are shared by every
 * request. The mapping (project id → property) is exposed for the snapshot
 * capture, which must verify that a provider answer was for the project's
 * own property; it is the server's private configuration and never comes
 * from a request. Unconfigured or misconfigured, the mapping is empty.
 */
type Selected = {
  readonly provider: SearchConsoleProvider;
  readonly properties: ReadonlyMap<string, string>;
};

function select(): Selected {
  try {
    const config = readSearchConsoleConfig(process.env);
    return {
      provider: createSearchConsoleProvider({
        config,
        client:
          config.status === "configured"
            ? createSearchConsoleClient({ credentials: config.credentials })
            : null,
      }),
      properties: config.status === "configured" ? config.properties : new Map(),
    };
  } catch (error) {
    if (!(error instanceof SearchConsoleConfigurationError)) throw error;
    console.error(`search-console: ${error.message}`);
    return { provider: createMisconfiguredProvider(), properties: new Map() };
  }
}

let selected: Selected | null = null;

export function searchConsoleProvider(): SearchConsoleProvider {
  selected ??= select();
  return selected.provider;
}

/** Project id → Search Console property, from the server's own configuration. */
export function searchConsoleProperties(): ReadonlyMap<string, string> {
  selected ??= select();
  return selected.properties;
}

export { getSearchConsoleReport } from "@/lib/search-console/provider";
