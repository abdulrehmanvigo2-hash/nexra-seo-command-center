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
 * The server's Search Console provider, chosen once per process from the
 * environment: not configured, configured, or misconfigured. One instance, so
 * its token and caches are shared by every request.
 */
function selectProvider(): SearchConsoleProvider {
  try {
    const config = readSearchConsoleConfig(process.env);
    return createSearchConsoleProvider({
      config,
      client:
        config.status === "configured"
          ? createSearchConsoleClient({ credentials: config.credentials })
          : null,
    });
  } catch (error) {
    if (!(error instanceof SearchConsoleConfigurationError)) throw error;
    console.error(`search-console: ${error.message}`);
    return createMisconfiguredProvider();
  }
}

let provider: SearchConsoleProvider | null = null;

export function searchConsoleProvider(): SearchConsoleProvider {
  provider ??= selectProvider();
  return provider;
}

export { getSearchConsoleReport } from "@/lib/search-console/provider";
