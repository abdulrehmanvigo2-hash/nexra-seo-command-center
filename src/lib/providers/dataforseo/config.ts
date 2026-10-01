import "server-only";

import {
  DAILY_CAP_VARIABLE,
  LOGIN_VARIABLE,
  MODE_VARIABLE,
  PASSWORD_VARIABLE,
  parseDailyCap,
  resolveMode,
  type ProviderMode,
} from "@/lib/providers/dataforseo/constants";

/**
 * DataForSEO settings, read from the server environment (F0, §2 and §7).
 *
 * Two credentials (Basic auth: the account's login and API password — secrets,
 * never with a `NEXT_PUBLIC_` prefix), the mode and the daily cap. With both
 * credentials empty the provider is simply not configured. One of the two
 * alone is a configuration error, reported by variable name, never its value.
 * The config object never leaves the server: nothing serialises it into a
 * response, a log or an error.
 */

export type ProviderCredentials = {
  readonly login: string;
  readonly password: string;
};

export type DataForSeoConfig =
  | { readonly status: "unconfigured"; readonly mode: ProviderMode }
  | {
      readonly status: "configured";
      readonly mode: ProviderMode;
      readonly credentials: ProviderCredentials;
      /** The daily cap in US dollars, or why every run is refused. */
      readonly dailyCap: ReturnType<typeof parseDailyCap>;
    };

export class DataForSeoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataForSeoConfigurationError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

export function readDataForSeoConfig(env: Environment): DataForSeoConfig {
  const exposed = Object.keys(env).filter((name) => name.startsWith("NEXT_PUBLIC_") && /DATAFORSEO/i.test(name) && Boolean(env[name]?.trim()));
  if (exposed.length > 0) {
    throw new DataForSeoConfigurationError(`${exposed.join(", ")} would be bundled into the browser. DataForSEO settings are server-only.`);
  }

  const mode = resolveMode(env[MODE_VARIABLE]?.trim());
  const login = env[LOGIN_VARIABLE]?.trim() ?? "";
  const password = env[PASSWORD_VARIABLE] ?? "";

  if (!login && !password) return { status: "unconfigured", mode };
  if (!login || !password) {
    throw new DataForSeoConfigurationError(`DataForSEO is partly configured: ${login ? PASSWORD_VARIABLE : LOGIN_VARIABLE} is not set.`);
  }
  if (/[\r\n:]/.test(login) || /[\r\n]/.test(password)) {
    throw new DataForSeoConfigurationError(`${LOGIN_VARIABLE} or ${PASSWORD_VARIABLE} holds a character Basic auth cannot carry.`);
  }

  return { status: "configured", mode, credentials: { login, password }, dailyCap: parseDailyCap(env[DAILY_CAP_VARIABLE]) };
}

/** The daily cap's refusal, in words naming the variable, never the value. */
export function describeCapRefusal(reason: "not-a-number" | "negative" | "above-ceiling"): string {
  switch (reason) {
    case "not-a-number":
      return `${DAILY_CAP_VARIABLE} is not a dollar amount; every run is refused until it is corrected.`;
    case "negative":
      return `${DAILY_CAP_VARIABLE} is negative; every run is refused until it is corrected.`;
    case "above-ceiling":
      return `${DAILY_CAP_VARIABLE} is above the $5.00 ceiling; every run is refused until it is lowered.`;
  }
}
